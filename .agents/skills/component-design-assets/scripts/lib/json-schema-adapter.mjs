const DESIGN_KINDS = new Set(['width', 'height', 'x', 'y', 'spacing', 'radius', 'color', 'image', 'visibility'])

export function isJsonSchemaDocument(value) {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) &&
    (value.$schema || value.type === 'object' || value.properties) &&
    !Array.isArray(value.props),
  )
}

export function adaptComponentInput(value) {
  if (isJsonSchemaDocument(value)) return adaptJsonSchemaToComponent(value)
  return adaptJsonSchemaToComponent(propsComponentToJsonSchema(value))
}

export function adaptJsonSchemaToComponent(schema) {
  if (!isJsonSchemaDocument(schema)) return schema
  const resolved = resolveSchema(schema, schema, new Set())
  const name = String(
    schema['x-component-name'] || schema['x-design']?.componentName || schema.title || schema.$id || 'SchemaComponent',
  ).split('/').at(-1).replace(/[^A-Za-z0-9_-]/g, '') || 'SchemaComponent'
  const properties = resolved.properties && typeof resolved.properties === 'object' ? resolved.properties : {}
  const component = {
    name,
    label: schema['x-component-label'] || schema.title || name,
    thumbnail: schema['x-thumbnail'] || schema['x-design']?.thumbnail,
    props: Object.entries(properties).map(([propertyName, property]) => schemaPropertyToComponentProp(propertyName, property)),
  }
  Object.defineProperty(component, '__schemaMeta', {
    value: {
      sourceFormat: 'json-schema',
      schemaVersion: schema.$schema || 'draft-07',
      repeaters: collectRepeaters(resolved, ''),
    },
    enumerable: false,
  })
  return component
}

// Component packs may still publish the historical props[] wire shape. Convert it
// once at the boundary so the contract engine only sees JSON Schema semantics.
function propsComponentToJsonSchema(component) {
  const source = component && typeof component === 'object' ? component : {}
  return {
    '$schema': 'https://json-schema.org/draft/2020-12/schema',
    title: source.label || source.name || 'Component',
    'x-component-name': source.name,
    'x-component-label': source.label,
    'x-thumbnail': source.thumbnail,
    properties: Object.fromEntries((Array.isArray(source.props) ? source.props : []).map((prop) => [
      prop.name,
      propsFieldToSchema(prop),
    ])),
  }
}

function propsFieldToSchema(prop) {
  const children = Array.isArray(prop?.objectChildrenShape) ? prop.objectChildrenShape : []
  const editor = Object.values(prop?.valueTypeMap || {})[0] || {}
  const editorName = String(editor.name || editor.valueType || '').toLowerCase()
  const kind = editorName === 'color' ? 'color'
    : editorName === 'image' ? 'image'
      : editorName === 'edge' ? 'spacing'
        : undefined
  const schema = children.length
    ? {
        type: 'object',
        properties: Object.fromEntries(children.map((child) => [child.name, propsFieldToSchema(child)])),
      }
    : {
        type: editor.valueType || (editorName === 'switch' ? 'boolean' : editorName === 'numberInput' ? 'number' : 'string'),
      }
  if (kind) schema['x-design-kind'] = kind
  if (prop?.useCustomFormController) {
    schema['x-design'] = {
      role: 'repeat-list',
      itemRole: 'list-item',
      controller: prop.useCustomFormController,
    }
  }
  if (prop?.defaultValue !== undefined) schema.default = prop.defaultValue
  if (prop?.label) schema.title = prop.label
  if (prop?.visibleInfo?.visible === false) schema['x-design'] = { ...(schema['x-design'] || {}), visible: false }
  return schema
}

function schemaPropertyToComponentProp(name, schema) {
  const value = schema && typeof schema === 'object' ? schema : {}
  const design = value['x-design'] && typeof value['x-design'] === 'object' ? value['x-design'] : {}
  const children = value.type === 'object' || value.properties
    ? Object.entries(value.properties || {}).map(([childName, child]) => schemaPropertyToComponentProp(childName, child))
    : []
  const kind = value['x-design-kind'] || design.kind || inferDesignKind(name, value, design)
  const editor = editorFor(kind, value, { ...design, role: value['x-design-role'] || design.role })
  const prop = {
    name,
    label: value.title || design.label || name,
    ...(children.length ? { objectChildrenShape: children } : {}),
    ...(editor ? { valueTypeMap: { [valueTypeKey(value)]: editor } } : {}),
    ...(value.default !== undefined ? { defaultValue: value.default } : {}),
    ...(design.default !== undefined ? { defaultValue: design.default } : {}),
    ...(design.visible === false ? { visibleInfo: { visible: false } } : {}),
  }
  if (design.profile) prop.profile = design.profile
  return prop
}

function inferDesignKind(name, schema, design) {
  if (DESIGN_KINDS.has(design.kind)) return design.kind
  const semantic = `${name} ${schema.title || ''}`.toLowerCase()
  if (schema.format === 'color' || /color|colour|颜色|背景|文字颜色/.test(semantic)) return 'color'
  if (schema.format === 'image' || design.role === 'image' || /image|icon|picture|图片|图标/.test(semantic)) return 'image'
  if (schema.type === 'boolean' && /show|visible|enable|显示|展示|开启/.test(semantic)) return 'visibility'
  if (/width|宽度/.test(semantic)) return 'width'
  if (/height|高度/.test(semantic)) return 'height'
  if (/radius|圆角/.test(semantic)) return 'radius'
  if (/padding|margin|spacing|gap|间距|内边距/.test(semantic)) return 'spacing'
  if (/^x$|left|横坐标|左偏移/.test(semantic)) return 'x'
  if (/^y$|top|纵坐标|上偏移/.test(semantic)) return 'y'
  return undefined
}

function editorFor(kind, schema, design) {
  const valueType = valueTypeKey(schema)
  const editorName = {
    color: 'color',
    image: 'image',
    visibility: 'switch',
    radius: 'edge',
    spacing: 'edge',
  }[kind]
  if (editorName) return { name: editorName, valueType: kind === 'radius' || kind === 'spacing' ? 'array' : valueType }
  if (kind && DESIGN_KINDS.has(kind)) return { name: valueType === 'number' ? 'numberInput' : valueType, valueType }
  if (design.editor) return { name: design.editor, valueType }
  if (valueType === 'number' || valueType === 'boolean') {
    return { name: valueType === 'number' ? 'numberInput' : 'switch', valueType }
  }
  return undefined
}

function valueTypeKey(schema) {
  if (schema.type === 'array') return 'array'
  if (Array.isArray(schema.type)) return schema.type.find((type) => type !== 'null') || 'string'
  return schema.type || (schema.enum ? 'string' : 'string')
}

function resolveSchema(schema, root, stack) {
  if (!schema || typeof schema !== 'object') return {}
  if (typeof schema.$ref === 'string') {
    const target = resolveRef(schema.$ref, root)
    if (!target || stack.has(schema.$ref)) return {}
    return resolveSchema(target, root, new Set([...stack, schema.$ref]))
  }
  const allOf = Array.isArray(schema.allOf) ? schema.allOf : []
  const merged = allOf.reduce((result, item) => mergeSchema(result, resolveSchema(item, root, stack)), {})
  return mergeSchema(merged, {
    ...schema,
    ...(schema.properties ? { properties: Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, resolveSchema(value, root, stack)])) } : {}),
  })
}

function mergeSchema(left, right) {
  return {
    ...left,
    ...right,
    properties: { ...(left.properties || {}), ...(right.properties || {}) },
  }
}

function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) return undefined
  return ref.slice(2).split('/').reduce((value, key) => value?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], root)
}

function collectRepeaters(schema, parentPath) {
  const result = []
  const design = schema?.['x-design'] && typeof schema['x-design'] === 'object' ? schema['x-design'] : {}
  if (schema?.type === 'array' || schema?.items || design.role === 'repeat-list') {
    result.push({
      path: parentPath,
      role: design.role || 'repeat-list',
      itemRole: design.itemRole || 'list-item',
      controller: design.controller,
      minItems: Number.isFinite(schema.minItems) ? schema.minItems : undefined,
      maxItems: Number.isFinite(schema.maxItems) ? schema.maxItems : undefined,
    })
    if (schema.items?.type === 'object') {
      for (const [name, child] of Object.entries(schema.items.properties || {})) {
        result.push(...collectRepeaters(child, `${parentPath}[]${name}`))
      }
    }
  }
  for (const [name, child] of Object.entries(schema?.properties || {})) {
    result.push(...collectRepeaters(child, parentPath ? `${parentPath}.${name}` : name))
  }
  return result
}
