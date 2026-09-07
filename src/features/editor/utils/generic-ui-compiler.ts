import type {
  Artboard,
  DesignBlock,
  DesignBreakpoint,
  DesignBreakpointId,
  DesignElement,
  DesignSpec,
} from '../types'

interface CompileOptions {
  artboard: Artboard
  includeBlockIds?: ReadonlySet<string>
  /** @deprecated DesignSpec 节点现在始终使用稳定 ID。 */
  createId?: (prefix: string) => string
}
const TRANSPARENT_IMAGE_PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg=='
type IdFactory = (token: string) => string
interface Bounds {
  x: number
  y: number
  width: number
  height: number
}
interface Palette {
  surface: string
  background: string
  text: string
  primary: string
  border: string
  muted: string
  sidebar: string
  sidebarText: string
  subtle: string
  primarySoft: string
}
interface DesignLayout {
  contentHeight: number
  blockBounds: Map<string, Bounds>
}

export const DEFAULT_DESIGN_BREAKPOINTS: DesignBreakpoint[] = [
  { id: 'mobile', label: '移动端', viewport: { width: 375, height: 812 }, maxWidth: 599 },
  {
    id: 'tablet',
    label: '平板',
    viewport: { width: 768, height: 900 },
    minWidth: 600,
    maxWidth: 1023,
  },
  { id: 'desktop', label: '桌面端', viewport: { width: 1440, height: 900 }, minWidth: 1024 },
]

export function resolveDesignSpecBreakpoint(schema: DesignSpec, breakpointId?: DesignBreakpointId) {
  if (!breakpointId) return schema
  const breakpoint =
    schema.responsive?.breakpoints.find((item) => item.id === breakpointId) ??
    DEFAULT_DESIGN_BREAKPOINTS.find((item) => item.id === breakpointId)
  if (!breakpoint) return schema
  return {
    ...schema,
    surfaceKind:
      breakpointId === 'mobile'
        ? ('mobile' as const)
        : schema.surfaceKind === 'mobile'
          ? ('desktop-web' as const)
          : schema.surfaceKind,
    viewport: { ...breakpoint.viewport },
    theme: { ...schema.theme, ...breakpoint.overrides?.theme },
    layout: { ...schema.layout, ...breakpoint.overrides?.layout },
    blocks: breakpoint.overrides?.layout?.hiddenBlockIds?.length
      ? schema.blocks.filter(
          (block) => !breakpoint.overrides?.layout?.hiddenBlockIds?.includes(block.id),
        )
      : schema.blocks,
  }
}

export function stableDesignId(artboardId: string, scope: string, token: string) {
  const source = `${artboardId}:${scope}:${token}`
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `design-${scope.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40)}-${(hash >>> 0).toString(36)}`
}

export function compileDesignSpecShell(schema: DesignSpec, options: CompileOptions) {
  const { artboard } = options
  const layout = calculateLayout(schema, artboard)
  const rootId = stableDesignId(artboard.id, 'root', 'section')
  const backgroundId = stableDesignId(artboard.id, 'shell', 'background')
  const root: DesignElement = {
    id: rootId,
    artboardId: artboard.id,
    type: 'section',
    name: schema.title,
    label: `${schema.surfaceKind} / ${schema.title}`,
    x: artboard.x,
    y: artboard.y,
    width: schema.viewport.width,
    height: layout.contentHeight,
    zIndex: 1,
    clipContent: true,
    designRole: 'container',
    layoutConstraints: { horizontal: 'stretch', vertical: 'stretch' },
  }
  const background: DesignElement = {
    id: backgroundId,
    artboardId: artboard.id,
    parentId: rootId,
    type: 'shape',
    name: '页面背景',
    x: artboard.x,
    y: artboard.y,
    width: schema.viewport.width,
    height: layout.contentHeight,
    zIndex: 2,
    shape: 'rect',
    fill: resolvePalette(schema).background,
    borderRadius: 0,
    layoutConstraints: { horizontal: 'stretch', vertical: 'stretch' },
  }
  return { rootId, backgroundId, elements: [root, background], contentHeight: layout.contentHeight }
}

export function compileDesignSpecBlock(
  schema: DesignSpec,
  blockIndex: number,
  options: CompileOptions,
) {
  const { artboard } = options
  const block = schema.blocks[blockIndex]
  if (!block) throw new Error(`DesignSpec Block 不存在：${blockIndex}`)
  const layout = calculateLayout(schema, artboard)
  const bounds = layout.blockBounds.get(block.id)
  if (!bounds) throw new Error(`DesignSpec Block 缺少布局：${block.id}`)
  const rootId = stableDesignId(artboard.id, 'root', 'section')
  const blockRootId = stableDesignId(artboard.id, `block-${block.id}`, 'root')
  const elements: DesignElement[] = [
    {
      id: blockRootId,
      artboardId: artboard.id,
      parentId: rootId,
      type: 'section',
      name: block.label,
      label: `${block.kind} / ${block.label}`,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      zIndex: 3,
      designRole: 'design-block',
      designBlockId: block.id,
      layoutConstraints: blockConstraints(block.kind),
      ...(block.kind === 'sidebar' && bounds.width === 0 ? { visible: false } : {}),
    },
  ]
  const createId = createStableFactory(artboard.id, block.id)
  const palette = resolvePalette(schema)
  if (block.kind === 'sidebar') {
    if (bounds.width > 0)
      compileSidebar(elements, createId, blockRootId, artboard, block, bounds, schema, palette)
  } else if (block.kind === 'header') {
    compileHeader(
      elements,
      createId,
      blockRootId,
      artboard,
      block,
      bounds.x - artboard.x,
      bounds.height,
      schema,
      palette,
    )
  } else if (block.kind === 'footer') {
    compileFooter(elements, createId, blockRootId, artboard.id, block, bounds, schema, palette)
  } else {
    compileContentBlock(
      elements,
      createId,
      blockRootId,
      artboard.id,
      block,
      bounds,
      schema,
      palette,
    )
  }
  for (const element of elements) element.designBlockId = block.id
  return { rootId, blockRootId, block, elements, bounds, contentHeight: layout.contentHeight }
}

export function compileDesignSpec(schema: DesignSpec, options: CompileOptions) {
  assertUniqueBlockIds(schema)
  const shell = compileDesignSpecShell(schema, options)
  const blocks = schema.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => !options.includeBlockIds || options.includeBlockIds.has(block.id))
    .map(({ index }) => compileDesignSpecBlock(schema, index, options))
  return {
    rootId: shell.rootId,
    elements: [...shell.elements, ...blocks.flatMap((block) => block.elements)],
    contentHeight: shell.contentHeight,
  }
}

function calculateLayout(schema: DesignSpec, artboard: Artboard): DesignLayout {
  assertUniqueBlockIds(schema)
  const sidebar = schema.blocks.find((block) => block.kind === 'sidebar')
  const header = schema.blocks.find((block) => block.kind === 'header')
  const footer = schema.blocks.find((block) => block.kind === 'footer')
  const viewportWidth = schema.viewport.width
  const sidebarVisible =
    schema.layout?.sidebarMode === 'expanded' ||
    (schema.layout?.sidebarMode !== 'collapsed' &&
      viewportWidth >= 1024 &&
      schema.surfaceKind !== 'mobile')
  const sidebarWidth = sidebar && sidebarVisible ? 224 : 0
  const headerHeight = header ? 64 : 0
  const defaultPadding = viewportWidth < 600 ? 16 : viewportWidth < 1024 ? 20 : 24
  const padding = clampLayoutValue(schema.layout?.contentPadding, defaultPadding, 0, 96)
  const gap = clampLayoutValue(
    schema.layout?.blockGap,
    schema.theme.density === 'compact' ? 12 : 16,
    0,
    64,
  )
  const contentX = artboard.x + sidebarWidth + padding
  const contentWidth = schema.viewport.width - sidebarWidth - padding * 2
  const blockBounds = new Map<string, Bounds>()
  let cursorY = artboard.y + headerHeight + padding

  for (const block of schema.blocks) {
    if (block.kind === 'sidebar' || block.kind === 'header' || block.kind === 'footer') continue
    const height = blockHeight(block, schema, contentWidth)
    blockBounds.set(block.id, { x: contentX, y: cursorY, width: contentWidth, height })
    cursorY += height + gap
  }
  if (footer) {
    blockBounds.set(footer.id, { x: contentX, y: cursorY, width: contentWidth, height: 64 })
    cursorY += 64 + padding
  }
  const contentHeight = Math.max(
    schema.viewport.height,
    cursorY - artboard.y + (footer ? 0 : padding),
  )
  if (sidebar)
    blockBounds.set(sidebar.id, {
      x: artboard.x,
      y: artboard.y,
      width: sidebarWidth,
      height: contentHeight,
    })
  if (header)
    blockBounds.set(header.id, {
      x: artboard.x + sidebarWidth,
      y: artboard.y,
      width: schema.viewport.width - sidebarWidth,
      height: 64,
    })
  return { contentHeight, blockBounds }
}

function assertUniqueBlockIds(schema: DesignSpec) {
  const ids = new Set<string>()
  for (const block of schema.blocks) {
    if (ids.has(block.id)) throw new Error(`DesignSpec Block ID 重复：${block.id}`)
    ids.add(block.id)
  }
}

function createStableFactory(artboardId: string, blockId: string): IdFactory {
  const counters = new Map<string, number>()
  return (token) => {
    const index = counters.get(token) ?? 0
    counters.set(token, index + 1)
    return stableDesignId(artboardId, `block-${blockId}`, `${token}-${index}`)
  }
}

function blockConstraints(
  kind: DesignBlock['kind'],
): NonNullable<DesignElement['layoutConstraints']> {
  if (kind === 'sidebar') return { horizontal: 'left', vertical: 'stretch' }
  if (kind === 'header') return { horizontal: 'stretch', vertical: 'top' }
  if (kind === 'footer') return { horizontal: 'stretch', vertical: 'bottom' }
  return { horizontal: 'stretch', vertical: 'top' }
}

function compileSidebar(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboard: Artboard,
  block: DesignBlock,
  bounds: Bounds,
  schema: DesignSpec,
  palette: Palette,
) {
  const width = bounds.width
  addShape(
    elements,
    createId,
    parentId,
    artboard.id,
    block.label,
    artboard.x,
    artboard.y,
    width,
    bounds.height,
    3,
    palette.sidebar,
    0,
  )
  addText(
    elements,
    createId,
    parentId,
    artboard.id,
    schema.title,
    artboard.x + 20,
    artboard.y + 18,
    width - 40,
    32,
    4,
    palette.sidebarText,
    18,
    700,
  )
  const items = block.items.length ? block.items : ['概览', '业务管理', '数据中心', '系统设置']
  items.forEach((item, index) => {
    const y = artboard.y + 76 + index * 44
    if (index === 0)
      addShape(
        elements,
        createId,
        parentId,
        artboard.id,
        `${item} 选中态`,
        artboard.x + 12,
        y,
        width - 24,
        36,
        4,
        palette.primarySoft,
        schema.theme.radius,
      )
    addText(
      elements,
      createId,
      parentId,
      artboard.id,
      item,
      artboard.x + 28,
      y + 8,
      width - 48,
      20,
      5,
      index === 0 ? palette.primary : palette.sidebarText,
      14,
      index === 0 ? 600 : 400,
    )
  })
}

function compileHeader(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboard: Artboard,
  block: DesignBlock,
  sidebarWidth: number,
  height: number,
  schema: DesignSpec,
  palette: Palette,
) {
  const x = artboard.x + sidebarWidth
  const width = schema.viewport.width - sidebarWidth
  addShape(
    elements,
    createId,
    parentId,
    artboard.id,
    block.label,
    x,
    artboard.y,
    width,
    height,
    3,
    palette.surface,
    0,
    palette.border,
  )
  addText(
    elements,
    createId,
    parentId,
    artboard.id,
    block.title || schema.title,
    x + 24,
    artboard.y + 18,
    Math.max(180, width - 360),
    28,
    4,
    palette.text,
    20,
    700,
  )
  let actionX = x + width - 24
  ;[...block.actions].reverse().forEach((action, index) => {
    const buttonWidth = Math.max(72, action.length * 14 + 28)
    actionX -= buttonWidth
    addButton(
      elements,
      createId,
      parentId,
      artboard.id,
      action,
      actionX,
      artboard.y + 14,
      buttonWidth,
      36,
      5,
      index === 0 ? palette.primary : palette.surface,
      index === 0 ? '#ffffff' : palette.text,
      schema.theme.radius,
    )
    actionX -= 10
  })
}

function compileSectionHeader(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboardId: string,
  block: DesignBlock,
  bounds: Bounds,
  schema: DesignSpec,
  palette: Palette,
) {
  addText(
    elements,
    createId,
    parentId,
    artboardId,
    block.title || block.label,
    bounds.x,
    bounds.y + 15,
    Math.max(120, bounds.width * 0.6),
    26,
    4,
    palette.text,
    18,
    700,
  )
  let actionX = bounds.x + bounds.width
  ;[...block.actions].reverse().forEach((action) => {
    const buttonWidth = Math.max(72, action.length * 14 + 28)
    actionX -= buttonWidth
    addButton(
      elements,
      createId,
      parentId,
      artboardId,
      action,
      actionX,
      bounds.y + 10,
      buttonWidth,
      36,
      5,
      palette.surface,
      palette.primary,
      schema.theme.radius,
    )
    actionX -= 10
  })
}

function compileFooter(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboardId: string,
  block: DesignBlock,
  bounds: Bounds,
  schema: DesignSpec,
  palette: Palette,
) {
  addShape(
    elements,
    createId,
    parentId,
    artboardId,
    block.label,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    4,
    palette.surface,
    schema.theme.radius,
    palette.border,
  )
  addText(
    elements,
    createId,
    parentId,
    artboardId,
    block.title || block.items.join(' · ') || block.label,
    bounds.x + 16,
    bounds.y + 22,
    bounds.width - 32,
    20,
    5,
    palette.muted,
    12,
    400,
  )
}

function compileContentBlock(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboardId: string,
  block: DesignBlock,
  bounds: Bounds,
  schema: DesignSpec,
  palette: Palette,
) {
  if (['container', 'stack', 'grid'].includes(block.kind))
    return compileContainerBlock(
      elements,
      createId,
      parentId,
      artboardId,
      block,
      bounds,
      schema,
      palette,
    )
  if (block.kind === 'hero')
    return compileHero(elements, createId, parentId, artboardId, block, bounds, schema, palette)
  if (block.kind === 'section-header')
    return compileSectionHeader(
      elements,
      createId,
      parentId,
      artboardId,
      block,
      bounds,
      schema,
      palette,
    )
  if (block.kind === 'text')
    return compileTextBlock(elements, createId, parentId, artboardId, block, bounds, palette)
  if (block.kind === 'image' || block.kind === 'map')
    return compileMediaBlock(
      elements,
      createId,
      parentId,
      artboardId,
      block,
      bounds,
      schema,
      palette,
    )
  if (block.kind === 'button-group')
    return compileButtonGroup(
      elements,
      createId,
      parentId,
      artboardId,
      block,
      bounds,
      schema,
      palette,
    )
  if (block.kind === 'divider')
    return addShape(
      elements,
      createId,
      parentId,
      artboardId,
      block.label,
      bounds.x,
      bounds.y + bounds.height / 2,
      bounds.width,
      1,
      4,
      palette.border,
      0,
    )
  if (block.kind === 'spacer') return
  if (block.kind === 'stats')
    return compileStats(elements, createId, parentId, artboardId, block, bounds, schema, palette)
  if (block.kind === 'filter-bar')
    return compileFilterBar(
      elements,
      createId,
      parentId,
      artboardId,
      block,
      bounds,
      schema,
      palette,
    )
  if (block.kind === 'data-table')
    return compileTable(elements, createId, parentId, artboardId, block, bounds, schema, palette)
  if (block.kind === 'tabs' || block.kind === 'pagination')
    return compilePills(elements, createId, parentId, artboardId, block, bounds, schema, palette)
  return compileCards(elements, createId, parentId, artboardId, block, bounds, schema, palette)
}

function compileContainerBlock(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboardId: string,
  block: DesignBlock,
  bounds: Bounds,
  schema: DesignSpec,
  palette: Palette,
) {
  const padding = block.layout?.padding ?? 16
  const gap = block.layout?.gap ?? 12
  const children = block.children?.length
    ? block.children
    : block.items.map((item, index) => ({
        ...block,
        id: `${block.id}-item-${index + 1}`,
        kind: 'text' as const,
        label: item,
        title: item,
        children: [],
      }))
  addShape(
    elements,
    createId,
    parentId,
    artboardId,
    block.label,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    4,
    palette.surface,
    schema.theme.radius,
    palette.border,
  )
  if (!children.length) return
  const horizontal = block.kind === 'grid' || block.layout?.direction === 'horizontal'
  const columns =
    block.kind === 'grid'
      ? Math.max(1, Math.min(children.length, block.layout?.columns ?? 2))
      : horizontal
        ? children.length
        : 1
  const rows = Math.ceil(children.length / columns)
  const childWidth = (bounds.width - padding * 2 - gap * (columns - 1)) / columns
  const childHeight = (bounds.height - padding * 2 - gap * (rows - 1)) / rows
  children.forEach((child, index) => {
    const childBounds = {
      x: bounds.x + padding + (index % columns) * (childWidth + gap),
      y: bounds.y + padding + Math.floor(index / columns) * (childHeight + gap),
      width: childWidth,
      height: childHeight,
    }
    addShape(
      elements,
      createId,
      parentId,
      artboardId,
      child.label,
      childBounds.x,
      childBounds.y,
      childBounds.width,
      childBounds.height,
      5,
      palette.subtle,
      schema.theme.radius,
      palette.border,
      child.id,
    )
    addText(
      elements,
      createId,
      parentId,
      artboardId,
      child.title || child.label,
      childBounds.x + 12,
      childBounds.y + 12,
      childBounds.width - 24,
      24,
      6,
      palette.text,
      14,
      600,
      child.id,
    )
  })
}

function compileHero(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboardId: string,
  block: DesignBlock,
  bounds: Bounds,
  schema: DesignSpec,
  palette: Palette,
) {
  addShape(
    elements,
    createId,
    parentId,
    artboardId,
    block.label,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    4,
    palette.subtle,
    schema.theme.radius,
    palette.border,
  )
  // Hero 始终保留一个真实可编辑 Image Slot。即使当前尚未生成 KV，后续
  // “给这个模块添加图片”也可以直接替换图片，而不必把背景 Shape 当图片处理。
  elements.push({
    id: createId(`image:${block.id}`),
    artboardId,
    parentId,
    type: 'image',
    name: `${block.label} 主视觉`,
    src: block.media?.src || TRANSPARENT_IMAGE_PLACEHOLDER,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    zIndex: 4.5,
    objectFit: 'cover',
    objectPosition: 'center',
    borderRadius: schema.theme.radius,
    designRole: 'component-decoration',
    layoutConstraints: { horizontal: 'stretch', vertical: 'stretch' },
  })
  addText(
    elements,
    createId,
    parentId,
    artboardId,
    block.title || block.label,
    bounds.x + 28,
    bounds.y + 36,
    bounds.width - 56,
    56,
    5,
    palette.text,
    32,
    700,
  )
  if (block.items[0])
    addText(
      elements,
      createId,
      parentId,
      artboardId,
      block.items[0],
      bounds.x + 28,
      bounds.y + 104,
      Math.min(620, bounds.width - 56),
      52,
      5,
      palette.muted,
      16,
      400,
    )
  let x = bounds.x + 28
  block.actions.forEach((action, index) => {
    const width = Math.max(88, action.length * 15 + 32)
    addButton(
      elements,
      createId,
      parentId,
      artboardId,
      action,
      x,
      bounds.y + bounds.height - 64,
      width,
      40,
      6,
      index === 0 ? palette.primary : palette.surface,
      index === 0 ? '#ffffff' : palette.text,
      schema.theme.radius,
    )
    x += width + 10
  })
}

function compileTextBlock(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboardId: string,
  block: DesignBlock,
  bounds: Bounds,
  palette: Palette,
) {
  addText(
    elements,
    createId,
    parentId,
    artboardId,
    block.title || block.label,
    bounds.x,
    bounds.y,
    bounds.width,
    32,
    4,
    palette.text,
    22,
    700,
  )
  if (block.items.length)
    addText(
      elements,
      createId,
      parentId,
      artboardId,
      block.items.join('\n'),
      bounds.x,
      bounds.y + 42,
      bounds.width,
      Math.max(24, bounds.height - 42),
      4,
      palette.muted,
      14,
      400,
    )
}

function compileMediaBlock(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboardId: string,
  block: DesignBlock,
  bounds: Bounds,
  schema: DesignSpec,
  palette: Palette,
) {
  if (block.media?.src) {
    elements.push({
      id: createId(`image:${block.id}`),
      artboardId,
      parentId,
      type: 'image',
      name: block.media.alt || block.label,
      src: block.media.src,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      zIndex: 4,
      objectFit: 'cover',
      borderRadius: schema.theme.radius,
    })
    return
  }
  addShape(
    elements,
    createId,
    parentId,
    artboardId,
    block.label,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    4,
    palette.subtle,
    schema.theme.radius,
    palette.border,
  )
  addText(
    elements,
    createId,
    parentId,
    artboardId,
    block.media?.alt || block.title || block.label,
    bounds.x + 16,
    bounds.y + bounds.height / 2 - 12,
    bounds.width - 32,
    24,
    5,
    palette.muted,
    14,
    500,
  )
}

function compileButtonGroup(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboardId: string,
  block: DesignBlock,
  bounds: Bounds,
  schema: DesignSpec,
  palette: Palette,
) {
  let x = bounds.x
  block.actions.forEach((action, index) => {
    const width = Math.max(80, action.length * 14 + 28)
    addButton(
      elements,
      createId,
      parentId,
      artboardId,
      action,
      x,
      bounds.y + Math.max(0, (bounds.height - 40) / 2),
      width,
      40,
      5,
      index === 0 ? palette.primary : palette.surface,
      index === 0 ? '#ffffff' : palette.text,
      schema.theme.radius,
    )
    x += width + 10
  })
}

function compileStats(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboardId: string,
  block: DesignBlock,
  bounds: Bounds,
  schema: DesignSpec,
  palette: Palette,
) {
  const items = block.items.length
    ? block.items
    : ['总数量 1,284', '今日新增 36', '处理中 18', '完成率 92%']
  const gap = 12
  const columns = resolveDesignBlockColumns(block, schema, items.length)
  const width = (bounds.width - gap * (columns - 1)) / columns
  const rows = Math.ceil(items.length / columns)
  const height = (bounds.height - gap * (rows - 1)) / rows
  items.forEach((item, index) => {
    const [label, value = ''] = splitMetric(item)
    const x = bounds.x + (index % columns) * (width + gap)
    const y = bounds.y + Math.floor(index / columns) * (height + gap)
    addShape(
      elements,
      createId,
      parentId,
      artboardId,
      label,
      x,
      y,
      width,
      height,
      4,
      palette.surface,
      schema.theme.radius,
      palette.border,
    )
    addText(
      elements,
      createId,
      parentId,
      artboardId,
      label,
      x + 16,
      y + 18,
      width - 32,
      20,
      5,
      palette.muted,
      13,
      400,
    )
    addText(
      elements,
      createId,
      parentId,
      artboardId,
      value,
      x + 16,
      y + 48,
      width - 32,
      32,
      5,
      palette.text,
      24,
      700,
    )
  })
}

function compileFilterBar(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboardId: string,
  block: DesignBlock,
  bounds: Bounds,
  schema: DesignSpec,
  palette: Palette,
) {
  addShape(
    elements,
    createId,
    parentId,
    artboardId,
    block.label,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    4,
    palette.surface,
    schema.theme.radius,
    palette.border,
  )
  if (schema.viewport.width < 600) {
    block.fields.forEach((field, index) => {
      const y = bounds.y + 12 + index * 44
      addShape(
        elements,
        createId,
        parentId,
        artboardId,
        `${field} 输入框`,
        bounds.x + 16,
        y,
        bounds.width - 32,
        36,
        5,
        palette.surface,
        schema.theme.radius,
        palette.border,
      )
      addText(
        elements,
        createId,
        parentId,
        artboardId,
        field,
        bounds.x + 28,
        y + 9,
        bounds.width - 56,
        18,
        6,
        palette.muted,
        13,
        400,
      )
    })
    let actionX = bounds.x + bounds.width - 16
    ;[...block.actions].reverse().forEach((action, index) => {
      actionX -= 72
      addButton(
        elements,
        createId,
        parentId,
        artboardId,
        action,
        actionX,
        bounds.y + bounds.height - 48,
        72,
        36,
        6,
        index === 0 ? palette.primary : palette.surface,
        index === 0 ? '#ffffff' : palette.text,
        schema.theme.radius,
      )
      actionX -= 8
    })
    return
  }
  let x = bounds.x + 16
  for (const field of block.fields) {
    const width = Math.min(180, Math.max(120, field.length * 14 + 72))
    addShape(
      elements,
      createId,
      parentId,
      artboardId,
      `${field} 输入框`,
      x,
      bounds.y + 18,
      width,
      36,
      5,
      palette.surface,
      schema.theme.radius,
      palette.border,
    )
    addText(
      elements,
      createId,
      parentId,
      artboardId,
      field,
      x + 12,
      bounds.y + 27,
      width - 24,
      18,
      6,
      palette.muted,
      13,
      400,
    )
    x += width + 10
  }
  let actionX = bounds.x + bounds.width - 16
  ;[...block.actions].reverse().forEach((action, index) => {
    const width = 72
    actionX -= width
    addButton(
      elements,
      createId,
      parentId,
      artboardId,
      action,
      actionX,
      bounds.y + 18,
      width,
      36,
      6,
      index === 0 ? palette.primary : palette.surface,
      index === 0 ? '#ffffff' : palette.text,
      schema.theme.radius,
    )
    actionX -= 8
  })
}

function compileTable(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboardId: string,
  block: DesignBlock,
  bounds: Bounds,
  schema: DesignSpec,
  palette: Palette,
) {
  addShape(
    elements,
    createId,
    parentId,
    artboardId,
    block.label,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    4,
    palette.surface,
    schema.theme.radius,
    palette.border,
  )
  const columns = block.columns.length
    ? block.columns
    : ['编号', '名称', '状态', '更新时间', '操作']
  const rows = block.rows.length ? block.rows : [['#1001', '示例数据', '进行中', '今天', '查看']]
  if (schema.viewport.width < 600) {
    const rowGap = 10
    const rowHeight = columns.length * 24 + 24
    addShape(
      elements,
      createId,
      parentId,
      artboardId,
      '表头背景',
      bounds.x,
      bounds.y,
      0,
      0,
      5,
      palette.subtle,
      schema.theme.radius,
    )
    elements[elements.length - 1].visible = false
    columns.forEach((column) => {
      addText(
        elements,
        createId,
        parentId,
        artboardId,
        column,
        bounds.x,
        bounds.y,
        0,
        0,
        6,
        palette.muted,
        12,
        600,
      )
      elements[elements.length - 1].visible = false
    })
    rows.forEach((row, rowIndex) => {
      const y = bounds.y + 12 + rowIndex * (rowHeight + rowGap)
      addShape(
        elements,
        createId,
        parentId,
        artboardId,
        `表格行 ${rowIndex + 1}`,
        bounds.x + 12,
        y,
        bounds.width - 24,
        rowHeight,
        5,
        rowIndex % 2 ? palette.subtle : palette.surface,
        schema.theme.radius,
        palette.border,
        `row:${row.join('|')}`,
      )
      columns.forEach((column, columnIndex) => {
        const value = row[columnIndex] || '-'
        addText(
          elements,
          createId,
          parentId,
          artboardId,
          `${column}：${value}`,
          bounds.x + 28,
          y + 12 + columnIndex * 24,
          bounds.width - 56,
          20,
          6,
          columnIndex === columns.length - 1 ? palette.primary : palette.text,
          12,
          columnIndex === 0 ? 600 : 400,
          value,
        )
      })
    })
    return
  }
  const rowHeight = Math.min(48, Math.max(36, (bounds.height - 16) / (rows.length + 1)))
  const columnWidth = (bounds.width - 32) / columns.length
  addShape(
    elements,
    createId,
    parentId,
    artboardId,
    '表头背景',
    bounds.x + 1,
    bounds.y + 1,
    bounds.width - 2,
    rowHeight,
    5,
    palette.subtle,
    schema.theme.radius,
  )
  columns.forEach((column, index) =>
    addText(
      elements,
      createId,
      parentId,
      artboardId,
      column,
      bounds.x + 16 + index * columnWidth,
      bounds.y + 12,
      columnWidth - 12,
      20,
      6,
      palette.muted,
      12,
      600,
    ),
  )
  rows.forEach((row, rowIndex) => {
    const y = bounds.y + rowHeight * (rowIndex + 1)
    addShape(
      elements,
      createId,
      parentId,
      artboardId,
      `表格行 ${rowIndex + 1}`,
      bounds.x + 1,
      y,
      bounds.width - 2,
      rowHeight,
      5,
      rowIndex % 2 ? palette.subtle : palette.surface,
      0,
      undefined,
      `row:${row.join('|')}`,
    )
    columns.forEach((_, columnIndex) =>
      addText(
        elements,
        createId,
        parentId,
        artboardId,
        row[columnIndex] || '-',
        bounds.x + 16 + columnIndex * columnWidth,
        y + 12,
        columnWidth - 12,
        20,
        6,
        columnIndex === columns.length - 1 ? palette.primary : palette.text,
        12,
        400,
      ),
    )
  })
}

function compilePills(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboardId: string,
  block: DesignBlock,
  bounds: Bounds,
  schema: DesignSpec,
  palette: Palette,
) {
  addShape(
    elements,
    createId,
    parentId,
    artboardId,
    block.label,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    4,
    palette.surface,
    schema.theme.radius,
    palette.border,
  )
  let x = block.kind === 'pagination' ? bounds.x + bounds.width - 16 : bounds.x + 16
  const items = block.items.length ? block.items : ['全部', '进行中', '已完成']
  const ordered = block.kind === 'pagination' ? [...items].reverse() : items
  const compact = schema.viewport.width < 600
  const itemGap = compact ? 4 : 8
  ordered.forEach((item, index) => {
    const width = compact
      ? Math.max(30, item.length * 11 + 14)
      : Math.max(36, item.length * 13 + 22)
    if (block.kind === 'pagination') x -= width
    addButton(
      elements,
      createId,
      parentId,
      artboardId,
      item,
      x,
      bounds.y + 10,
      width,
      bounds.height - 20,
      5,
      index === 0 ? palette.primarySoft : palette.surface,
      index === 0 ? palette.primary : palette.text,
      schema.theme.radius,
    )
    x += block.kind === 'pagination' ? -itemGap : width + itemGap
  })
}

function compileCards(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboardId: string,
  block: DesignBlock,
  bounds: Bounds,
  schema: DesignSpec,
  palette: Palette,
) {
  const items = block.items.length
    ? block.items
    : block.fields.length
      ? block.fields
      : [block.title || block.label]
  const columns = resolveDesignBlockColumns(block, schema, items.length)
  const gap = 12
  const width = (bounds.width - gap * (columns - 1)) / columns
  const rows = Math.ceil(items.length / columns)
  const height = (bounds.height - gap * (rows - 1)) / rows
  items.forEach((item, index) => {
    const x = bounds.x + (index % columns) * (width + gap)
    const y = bounds.y + Math.floor(index / columns) * (height + gap)
    addShape(
      elements,
      createId,
      parentId,
      artboardId,
      item,
      x,
      y,
      width,
      height,
      4,
      palette.surface,
      schema.theme.radius,
      palette.border,
    )
    addText(
      elements,
      createId,
      parentId,
      artboardId,
      item,
      x + 16,
      y + 16,
      width - 32,
      24,
      5,
      palette.text,
      14,
      600,
    )
  })
}

function blockHeight(block: DesignBlock, schema: DesignSpec, width: number) {
  if (block.layout?.height) return block.layout.height
  if (block.kind === 'section-header') return 56
  if (block.kind === 'hero') return schema.viewport.width < 600 ? 300 : 360
  if (block.kind === 'text') return Math.max(84, 58 + block.items.length * 24)
  if (block.kind === 'image' || block.kind === 'map') return schema.viewport.width < 600 ? 220 : 320
  if (block.kind === 'button-group') return 64
  if (block.kind === 'divider') return 24
  if (block.kind === 'spacer') return 32
  if (['container', 'stack', 'grid'].includes(block.kind)) {
    const count = Math.max(1, block.children?.length || block.items.length)
    const columns =
      block.kind === 'grid'
        ? Math.max(1, block.layout?.columns ?? 2)
        : block.layout?.direction === 'horizontal'
          ? count
          : 1
    return Math.max(140, Math.ceil(count / columns) * 132)
  }
  if (block.kind === 'stats') {
    const itemCount = Math.max(1, block.items.length || 4)
    const columns = resolveDesignBlockColumns(block, schema, itemCount)
    return Math.ceil(itemCount / columns) * 104 + (Math.ceil(itemCount / columns) - 1) * 12
  }
  if (block.kind === 'filter-bar') {
    return schema.viewport.width < 600 ? Math.max(104, block.fields.length * 44 + 68) : 72
  }
  if (block.kind === 'tabs' || block.kind === 'pagination') return 52
  if (block.kind === 'data-table') {
    if (schema.viewport.width < 600) {
      const rows = Math.max(1, block.rows.length)
      const columns = Math.max(1, block.columns.length || 5)
      return 24 + rows * (columns * 24 + 24) + Math.max(0, rows - 1) * 10
    }
    return Math.max(260, Math.min(420, 58 + block.rows.length * 48))
  }
  if (block.kind === 'form') return 280
  const itemCount = Math.max(1, block.items.length || block.fields.length)
  const columns = resolveDesignBlockColumns(block, schema, itemCount)
  return Math.max(140, Math.ceil(itemCount / columns) * 132 + (width < 600 ? 12 : 0))
}

export function resolveDesignBlockColumns(
  block: DesignBlock,
  schema: DesignSpec,
  itemCount?: number,
) {
  const count = Math.max(1, (itemCount ?? block.items.length) || block.fields.length || 1)
  const override = schema.layout?.blockColumns?.[block.id]
  if (Number.isFinite(override)) return Math.max(1, Math.min(count, Math.round(override!)))
  if (schema.viewport.width < 600) return 1
  if (schema.viewport.width < 1024) return Math.min(2, count)
  return block.kind === 'stats' ? count : Math.min(3, count)
}

function clampLayoutValue(value: number | undefined, fallback: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value!))) : fallback
}

function resolvePalette(schema: DesignSpec): Palette {
  const [
    surface = '#ffffff',
    background = '#f5f7fa',
    text = '#182230',
    primary = '#2563eb',
    border = '#d9dee8',
  ] = schema.theme.colors
  const sidebar =
    schema.theme.mode === 'dark' ? mixHex(primary, '#000000', 0.72) : mixHex(primary, text, 0.66)
  return {
    surface,
    background,
    text,
    primary,
    border,
    muted: withAlpha(text, 0.62),
    sidebar,
    sidebarText: readableTextColor(sidebar),
    subtle: mixHex(surface, primary, schema.theme.mode === 'dark' ? 0.12 : 0.05),
    primarySoft: withAlpha(primary, 0.14),
  }
}

/** @deprecated 使用 compileDesignSpec。 */
export const compileGenericUiSchema = compileDesignSpec

function splitMetric(value: string) {
  const match = value.match(/^(.*?)[：:\s]+([\d,.%+-]+)$/)
  return match ? [match[1], match[2]] : [value, '']
}

function withAlpha(color: string, alpha: number) {
  const match = color.match(/^#([0-9a-f]{6})$/i)
  if (!match) return color
  const value = Number.parseInt(match[1], 16)
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

function mixHex(base: string, overlay: string, overlayWeight: number) {
  const left = parseHex(base)
  const right = parseHex(overlay)
  if (!left || !right) return base
  const weight = Math.max(0, Math.min(1, overlayWeight))
  const mixed = left.map((value, index) => Math.round(value * (1 - weight) + right[index] * weight))
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function readableTextColor(background: string) {
  const rgb = parseHex(background)
  if (!rgb) return '#ffffff'
  const luminance = (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) / 255
  return luminance > 0.6 ? '#241a12' : '#fffaf2'
}

function parseHex(color: string) {
  const match = color.match(/^#([0-9a-f]{6})$/i)
  if (!match) return undefined
  const value = Number.parseInt(match[1], 16)
  return [value >> 16, (value >> 8) & 255, value & 255]
}

function addShape(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboardId: string,
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  zIndex: number,
  fill: string,
  borderRadius: number,
  stroke?: string,
  itemKey = name,
) {
  elements.push({
    id: createId(`shape:${itemKey}`),
    artboardId,
    parentId,
    type: 'shape',
    name,
    x,
    y,
    width,
    height,
    zIndex,
    shape: 'rect',
    fill,
    borderRadius,
    stroke,
    strokeWidth: stroke ? 1 : undefined,
  })
}

function addText(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboardId: string,
  content: string,
  x: number,
  y: number,
  width: number,
  height: number,
  zIndex: number,
  color: string,
  fontSize: number,
  fontWeight: number,
  itemKey = content,
) {
  elements.push({
    id: createId(`text:${itemKey}`),
    artboardId,
    parentId,
    type: 'text',
    name: content,
    content,
    x,
    y,
    width,
    height,
    zIndex,
    style: {
      color,
      fontSize,
      fontWeight,
      lineHeight: 1.35,
      textAlign: 'left',
      overflow: 'ellipsis',
    },
  })
}

function addButton(
  elements: DesignElement[],
  createId: IdFactory,
  parentId: string,
  artboardId: string,
  content: string,
  x: number,
  y: number,
  width: number,
  height: number,
  zIndex: number,
  background: string,
  color: string,
  borderRadius: number,
) {
  elements.push({
    id: createId(`button:${content}`),
    artboardId,
    parentId,
    type: 'button',
    name: content,
    content,
    x,
    y,
    width,
    height,
    zIndex,
    style: { background, color, fontSize: 13, fontWeight: 600, borderRadius },
  })
}
