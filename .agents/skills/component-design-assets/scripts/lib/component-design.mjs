import crypto from 'node:crypto'

const DESIGN_KINDS = new Set(['width', 'height', 'x', 'y', 'spacing', 'radius', 'color', 'image'])
const GENERIC_TOKENS = new Set([
  'style', 'config', 'free', 'normal', 'component', 'image', 'pic', 'asset', 'static',
  'button', 'btn', 'open', 'show', 'visible', 'enable',
  '样式', '配置', '组件', '图片', '按钮', '展示', '显示', '开启',
])

export function extractComponentFacts(component, source = JSON.stringify(component), options = {}) {
  const nodes = []
  const leaves = []
  const valueSource = options.valueSource ?? 'component-default'
  const sourceName = options.sourceName ?? component.name
  for (const prop of component.props ?? []) walkProp(prop, '', 0, nodes, leaves, { valueSource, sourceName })
  return {
    componentName: component.name,
    label: component.label,
    thumbnail: component.thumbnail,
    sourceHash: crypto.createHash('sha256').update(source).digest('hex'),
    nodes,
    leaves,
  }
}

export function composeComponentFacts(factLayers) {
  if (!factLayers.length) throw new Error('缺少可组合的组件事实。')
  const nodeMap = new Map()
  const leafMap = new Map()
  for (const facts of factLayers) {
    for (const node of facts.nodes) nodeMap.set(node.path, node)
    for (const leaf of facts.leaves) leafMap.set(leaf.path, leaf)
  }
  const current = factLayers.at(-1)
  return {
    componentName: current.componentName,
    label: current.label,
    thumbnail: current.thumbnail,
    sourceHash: crypto.createHash('sha256').update(factLayers.map((facts) => facts.sourceHash).join(':')).digest('hex'),
    nodes: Array.from(nodeMap.values()),
    leaves: Array.from(leafMap.values()),
    layers: factLayers.map((facts) => ({ componentName: facts.componentName, sourceHash: facts.sourceHash })),
  }
}

export function createRuleRegistry(extraRules = []) {
  const rules = [...extraRules, ...createGenericRules()].sort((left, right) => right.priority - left.priority)
  return {
    classify(fact) {
      const matches = rules
        .map((rule) => ({ rule, result: rule.match(fact) }))
        .filter((item) => item.result)
        .map(({ rule, result }) => ({
          ruleId: rule.id,
          kind: result.kind,
          confidence: result.confidence,
          evidence: result.evidence,
        }))
        .sort((left, right) => right.confidence - left.confidence)
      return { selected: matches[0], candidates: matches }
    },
  }
}

export function resolveDesignContract(component, facts, options = {}) {
  const adapters = (options.adapters ?? []).filter((adapter) => adapter?.supports?.(component, facts) !== false)
  const adapterRules = adapters.flatMap((adapter) => adapter.rules ?? [])
  const registry = createRuleRegistry(adapterRules)
  const designProperties = []
  const structuralControls = []
  const passthroughProps = []
  const unresolved = []
  const diagnostics = []

  for (const fact of facts.leaves) {
    const classification = registry.classify(fact)
    if (!classification.selected) {
      if (isDesignCandidate(fact)) {
        unresolved.push({
          path: fact.path,
          reason: '存在设计类型线索，但无法确定具体设计语义。',
          editorTypes: fact.editorTypes,
          valueTypes: fact.valueTypes,
        })
      } else {
        passthroughProps.push(fact.path)
      }
      continue
    }
    const property = {
      path: fact.path,
      parentPath: fact.parentPath,
      name: fact.name,
      label: fact.label,
      kind: classification.selected.kind,
      defaultValue: fact.defaultValue,
      hidden: fact.hidden,
      source: fact.valueSource ?? 'component-default',
      sourceName: fact.sourceName,
      confidence: classification.selected.confidence,
      evidence: classification.selected.evidence,
    }
    if (property.kind === 'visibility') structuralControls.push(property)
    else designProperties.push(property)
  }

  const profiles = inferProfiles(facts, designProperties, structuralControls)
  assignProfiles(designProperties, structuralControls, profiles)
  const slotResult = createSlots(designProperties, structuralControls, profiles)
  unresolved.push(...slotResult.unresolved)

  let contract = {
    componentName: component.name,
    label: component.label,
    sourceFormat: 'json-schema',
    schemaVersion: component.__schemaMeta?.schemaVersion,
    repeaters: component.__schemaMeta?.repeaters || [],
    thumbnail: component.thumbnail,
    sourceHash: facts.sourceHash,
    profiles,
    designProperties,
    structuralControls,
    slots: slotResult.slots,
    passthroughProps: Array.from(new Set(passthroughProps)).sort(),
    unresolved,
    diagnostics,
    appliedAdapters: adapters.map((adapter) => adapter.name).filter(Boolean),
  }

  for (const adapter of adapters) {
    if (typeof adapter.refineContract === 'function') {
      contract = adapter.refineContract(contract, { component, facts }) ?? contract
    }
  }
  return contract
}

function walkProp(prop, parentPath, depth, nodes, leaves, sourceInfo) {
  if (!prop || typeof prop !== 'object' || !prop.name) return
  const propPath = parentPath ? `${parentPath}.${prop.name}` : prop.name
  const children = Array.isArray(prop.objectChildrenShape) ? prop.objectChildrenShape : []
  const node = {
    path: propPath,
    parentPath,
    depth,
    name: prop.name,
    label: prop.label,
    childPaths: children.map((child) => `${propPath}.${child.name}`),
    customController: prop.useCustomFormController,
    ...sourceInfo,
  }
  nodes.push(node)
  if (children.length) {
    for (const child of children) walkProp(child, propPath, depth + 1, nodes, leaves, sourceInfo)
    return
  }
  const valueTypeMap = prop.valueTypeMap ?? {}
  const editors = Object.values(valueTypeMap).filter(Boolean)
  leaves.push({
    ...node,
    valueTypes: Object.keys(valueTypeMap).map((value) => value.toLowerCase()),
    editorTypes: editors.map((value) => String(value.name || value.valueType || '').toLowerCase()),
    defaultValue: readDefaultValue(prop, editors),
    hidden: prop.visibleInfo?.visible === false,
  })
}

function createGenericRules() {
  return [
    exactEditorRule('editor-image', 'image', 'image', 1),
    exactEditorRule('editor-color', 'color', 'color', 1),
    semanticRule('semantic-width', 'width', /width|宽度/, ['number', 'array'], 0.94),
    semanticRule('semantic-height', 'height', /height|高度/, ['number', 'array'], 0.94),
    semanticRule('semantic-x', 'x', /(?:^|\W)(?:x|left)(?:\W|$)|positionx|横向|横坐标|左偏移/, ['number'], 0.9),
    semanticRule('semantic-y', 'y', /(?:^|\W)(?:y|top)(?:\W|$)|positiony|纵向|纵坐标|上偏移/, ['number'], 0.9),
    semanticRule('semantic-spacing', 'spacing', /padding|margin|spacing|gap|间距|内边距|外边距/, ['number', 'array'], 0.9),
    semanticRule('semantic-radius', 'radius', /radius|圆角/, ['number', 'array'], 0.9),
    semanticRule('semantic-visibility', 'visibility', /open|show|visible|enable|开启|展示|显示|是否/, ['boolean'], 0.88),
  ]
}

function exactEditorRule(id, editor, kind, confidence) {
  return {
    id,
    priority: 100,
    match(fact) {
      if (!fact.editorTypes.includes(editor)) return null
      return { kind, confidence, evidence: [`编辑器类型为 ${editor}`] }
    },
  }
}

function semanticRule(id, kind, pattern, requiredValueTypes, confidence) {
  return {
    id,
    priority: 50,
    match(fact) {
      if (!requiredValueTypes.some((type) => fact.valueTypes.includes(type))) return null
      const semantic = `${splitIdentifier(fact.name)} ${fact.label || ''}`.toLowerCase()
      if (!pattern.test(semantic)) return null
      return {
        kind,
        confidence,
        evidence: [`值类型包含 ${requiredValueTypes.join('/')}`, `字段语义匹配 ${id}`],
      }
    },
  }
}

function inferProfiles(facts, designProperties, structuralControls) {
  const allProperties = [...designProperties, ...structuralControls]
  const rootGroups = new Map()
  for (const property of allProperties) {
    const rootPath = property.path.split('.')[0]
    const group = rootGroups.get(rootPath) ?? []
    group.push(property)
    rootGroups.set(rootPath, group)
  }

  const selectors = facts.leaves.filter((fact) => fact.valueTypes.includes('boolean') && fact.depth === 0)
  const profiles = []
  for (const [rootPath, properties] of rootGroups) {
    const kinds = new Set(properties.map((property) => property.kind))
    if (properties.length < 2 || !Array.from(kinds).some((kind) => DESIGN_KINDS.has(kind))) continue
    const rootTokens = semanticTokens(rootPath)
    const selector = selectors
      .map((fact) => ({ fact, score: tokenOverlap(rootTokens, semanticTokens(`${fact.name} ${fact.label || ''}`)) }))
      .sort((left, right) => right.score - left.score)[0]
    profiles.push({
      id: slugify(rootPath),
      rootPath,
      confidence: selector?.score > 0 ? 0.82 : 0.7,
      evidence: selector?.score > 0
        ? [`根对象包含 ${properties.length} 个设计属性`, `与开关 ${selector.fact.path} 存在语义关联`]
        : [`根对象包含 ${properties.length} 个设计属性`],
      activeWhen: selector?.score > 0 ? { prop: selector.fact.path, equals: true } : undefined,
    })
  }
  return profiles
}

function assignProfiles(designProperties, structuralControls, profiles) {
  for (const property of [...designProperties, ...structuralControls]) {
    const profile = profiles.find((item) => property.path === item.rootPath || property.path.startsWith(`${item.rootPath}.`))
    if (profile) property.profile = profile.id
  }
}

function createSlots(designProperties, structuralControls, profiles) {
  const imageProperties = designProperties.filter((property) => property.kind === 'image')
  const slots = []
  const unresolved = []
  for (const image of imageProperties) {
    const siblingProperties = designProperties.filter((property) => property.parentPath === image.parentPath)
    const profileRoot = profiles.find((profile) => profile.id === image.profile)?.rootPath
    const hasDedicatedSlotObject = Boolean(image.parentPath && image.parentPath !== profileRoot)
    const siblingImages = imageProperties.filter((property) => property.parentPath === image.parentPath)
    const isFallback = /static|fallback|兜底|默认/.test(`${image.name} ${image.label || ''}`.toLowerCase())
    const primary = isFallback
      ? siblingImages.find((property) => property.path !== image.path && !/static|fallback|兜底|默认/.test(`${property.name} ${property.label || ''}`.toLowerCase()))
      : undefined
    const fallback = !isFallback
      ? siblingImages.find((property) => /static|fallback|兜底|默认/.test(`${property.name} ${property.label || ''}`.toLowerCase()))
      : undefined
    const semantic = relationTokens(image, profileRoot)
    const x = findBestRelated(designProperties, image, semantic, 'x', profileRoot)
    const y = findBestRelated(designProperties, image, semantic, 'y', profileRoot)
    const visible = findBestRelated(structuralControls, image, semantic, 'visibility', profileRoot)
    const bindings = compact({
      width: hasDedicatedSlotObject ? siblingProperties.find((property) => property.kind === 'width')?.path : undefined,
      height: hasDedicatedSlotObject ? siblingProperties.find((property) => property.kind === 'height')?.path : undefined,
      x: x?.confidence >= 0.72 ? x.path : undefined,
      y: y?.confidence >= 0.72 ? y.path : undefined,
      image: image.path,
      fallbackImage: fallback?.path,
      visible: visible?.confidence >= 0.72 ? visible.path : undefined,
    })
    const relationEvidence = [x, y, visible].filter((relation) => relation?.confidence >= 0.72).flatMap((relation) => relation.evidence)
    const confidence = Math.min(1, 0.78 + (bindings.width ? 0.05 : 0) + (bindings.height ? 0.05 : 0) + relationEvidence.length * 0.02)
    slots.push({
      id: slugify(image.path),
      label: image.label || image.name,
      role: inferSlotRole(semantic, `${image.path} ${image.label || ''}`),
      profile: image.profile,
      variantOf: primary?.path,
      generationPolicy: isFallback ? 'reuse-or-generate' : 'generate',
      bindings,
      confidence,
      evidence: [`图片属性 ${image.path}`, ...relationEvidence],
    })
    for (const relation of [x, y, visible]) {
      if (relation && relation.confidence > 0 && relation.confidence < 0.72) {
        unresolved.push({
          path: image.path,
          relation: relation.kind,
          candidatePath: relation.path,
          confidence: relation.confidence,
          reason: '候选绑定置信度不足，等待 Adapter、thumbnail 或用户确认。',
        })
      }
    }
  }
  return { slots, unresolved }
}

function findBestRelated(properties, image, imageTokens, kind, profileRoot) {
  const candidates = properties
    .filter((property) => property.kind === kind && property.profile === image.profile)
    .map((property) => {
      const score = tokenOverlap(imageTokens, relationTokens(property, profileRoot))
      return {
        kind,
        path: property.path,
        confidence: score === 0 ? 0 : Math.min(0.9, 0.58 + score * 0.14),
        evidence: score ? [`${image.path} 与 ${property.path} 共享 ${score} 个语义标记`] : [],
      }
    })
    .filter((candidate) => candidate.confidence > 0)
    .sort((left, right) => right.confidence - left.confidence)
  return candidates[0]
}

function relationTokens(property, profileRoot) {
  const parentName = property.parentPath && property.parentPath !== profileRoot
    ? property.parentPath.split('.').at(-1)
    : ''
  return semanticTokens(`${property.name} ${property.label || ''} ${parentName}`)
}

function inferSlotRole(tokens, rawSemantic) {
  if (hasAny(tokens, ['button', 'btn', '按钮'])) return 'button'
  if (/button|btn|按钮/i.test(rawSemantic)) return 'button'
  if (hasAny(tokens, ['background', 'bg', '背景'])) return 'background'
  if (hasAny(tokens, ['animation', '动效'])) return 'animation'
  if (hasAny(tokens, ['thanks', 'decorate', 'decoration', '谢谢', '装饰'])) return 'decoration'
  return 'content-image'
}

function isDesignCandidate(fact) {
  return fact.editorTypes.some((editor) => ['image', 'color', 'numberinput', 'edge', 'switch'].includes(editor)) ||
    fact.valueTypes.some((type) => ['number', 'array', 'boolean'].includes(type))
}

function readDefaultValue(prop, editors) {
  if (prop.defaultValue !== undefined) return prop.defaultValue
  return editors.find((value) => value.defaultValue !== undefined)?.defaultValue
}

function semanticTokens(value) {
  const normalized = splitIdentifier(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
  return Array.from(new Set(normalized.split(/\s+/).filter((token) => token.length > 1 && !GENERIC_TOKENS.has(token))))
}

function splitIdentifier(value) {
  return String(value).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_./-]+/g, ' ')
}

function tokenOverlap(left, right) {
  const rightSet = new Set(right)
  return left.filter((token) => rightSet.has(token)).length
}

function hasAny(values, expected) {
  return expected.some((item) => values.includes(item))
}

function slugify(value) {
  return splitIdentifier(value).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}
