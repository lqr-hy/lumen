import type { CSSProperties } from 'react'
import type { Artboard, ComponentBinding, DesignElement } from '../types'
import { resolveCornerRadii } from '../utils/design-properties'
import { flattenElementsForPainting } from '../utils/layer-tree'

/**
 * Render IR：`DesignElement` 到视觉的唯一解释结果。
 *
 * 编辑画布、静态快照、响应式预览和代码导出都消费同一棵 IR，避免同一份设计数据
 * 在不同出口被重复解释。视觉规则只允许写在 `buildRenderBox` 里，SCSS 仅保留
 * 编辑器交互态（选中描边、cursor、contenteditable）。
 */
export interface RenderBox {
  /** 稳定标识。box 层为 element.id，content 层为 `${element.id}::content`。 */
  key: string
  role: 'artboard' | 'box' | 'content'
  tag: RenderTag
  /** 全量 CSS 声明，kebab-case 键、字符串值且已带单位。开放 Record 以免新增属性时静默丢失。 */
  css: Record<string, string>
  classNames: string[]
  attrs?: Record<string, string>
  /** 纯文本内容，与 children 互斥。 */
  text?: string
  children: RenderBox[]
  meta: RenderBoxMeta
}

export type RenderTag =
  | 'main'
  | 'section'
  | 'div'
  | 'span'
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'button'
  | 'input'
  | 'img'

export interface RenderBoxMeta {
  elementId?: string
  elementType?: DesignElement['type']
  /** 元素名，供导出代码生成可读 class。 */
  name?: string
  /**
   * 导出用的唯一 CSS class，由 codegen 的 `assignClassNames` 写入。
   * 画布渲染不消费该字段。
   */
  className?: string
  /** 该 box 是 Runtime Component 实例根节点时存在。 */
  runtime?: {
    instanceId: string
    componentName: string
    componentPackId?: string
    props: Record<string, unknown>
    binding?: ComponentBinding
  }
  /** 编辑器专属能力，静态出口据此跳过事件绑定。 */
  interactive?: {
    editableText?: boolean
    locked?: boolean
  }
}

export type RenderMode = 'canvas' | 'static' | 'export'

export interface RenderDiagnostic {
  code:
    | 'OUT_OF_BOUNDS'
    | 'INVALID_BOUNDS'
    | 'ORPHAN_PROMOTED'
    | 'RUNTIME_PACK_MISSING'
    | 'PLACEHOLDER_DROPPED'
  severity: 'error' | 'warning'
  message: string
  elementId?: string
}

export interface RenderContext {
  mode: RenderMode
  /**
   * 坐标原点。画布传 `{ x: 0, y: 0 }`（元素已是世界坐标），静态与导出传画板原点，
   * 导出嵌套子节点时传父元素左上角。
   */
  origin: { x: number; y: number }
  /** 父元素，用于判定 autoLayout 流式定位。 */
  parent?: DesignElement
  /** page-shell 撑满画板时使用。 */
  surface?: { width: number; height: number }
  diagnostics: RenderDiagnostic[]
}

/** kebab-case CSS 记录转 React 行内样式。IR 的值已带单位，此处只做键名转换。 */
export function toReactStyle(css: Record<string, string>): CSSProperties {
  const style: Record<string, string> = {}
  for (const [property, value] of Object.entries(css)) {
    if (property.startsWith('--')) {
      style[property] = value
      continue
    }
    style[property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value
  }
  return style as CSSProperties
}

/** 统一舍入，避免浮点差异在 CSS 文本 diff 中产生噪声。 */
export function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`
}

/** `> 4` 视为绝对像素，否则视为字号倍数。沿用 design-properties 的既有约定。 */
export function lineHeightValue(value?: number): string | undefined {
  if (!value) return undefined
  return value > 4 ? px(value) : String(value)
}

function cornerRadiiCss(radii: {
  topLeft: number
  topRight: number
  bottomRight: number
  bottomLeft: number
}): string {
  return `${px(radii.topLeft)} ${px(radii.topRight)} ${px(radii.bottomRight)} ${px(radii.bottomLeft)}`
}

function shadowCss(shadow: NonNullable<DesignElement['shadow']>): string {
  return `${px(shadow.x)} ${px(shadow.y)} ${px(shadow.blur)} ${px(shadow.spread ?? 0)} ${shadow.color}`
}

/** 丢弃 undefined 值，保证 css 记录里不出现空声明。 */
function declare(entries: Record<string, string | undefined>): Record<string, string> {
  const css: Record<string, string> = {}
  for (const [property, value] of Object.entries(entries)) {
    if (value !== undefined && value !== '') css[property] = value
  }
  return css
}

/**
 * 展开单个元素为 box + content 两层。
 *
 * 保留双层而非压平：`border-radius: inherit` 语义天然成立，外层 clipContent 与
 * 内层 text overflow 不再互相覆盖，变换与透明度的继承关系与画布一致。
 *
 * 返回 null 表示该元素在当前 mode 下不应渲染。
 */
export function buildRenderBox(element: DesignElement, ctx: RenderContext): RenderBox | null {
  if (element.visible === false) return null
  if (element.type === 'runtime-placeholder') {
    // 占位符是编辑器概念，不进入交付代码。
    if (ctx.mode === 'export') {
      ctx.diagnostics.push({
        code: 'PLACEHOLDER_DROPPED',
        severity: 'warning',
        message: `运行时占位节点 ${element.name} 未导出，需由 Runtime Component 承载。`,
        elementId: element.id,
      })
      return null
    }
    if (!element.preview && ctx.mode === 'static') return null
  }

  if (
    !Number.isFinite(element.x) ||
    !Number.isFinite(element.y) ||
    !(element.width >= 0) ||
    !(element.height >= 0)
  ) {
    ctx.diagnostics.push({
      code: 'INVALID_BOUNDS',
      severity: 'error',
      message: `节点边界非法：${element.id}`,
      elementId: element.id,
    })
    return null
  }

  // page-shell 只有在拿到 surface（静态与导出：外壳是画板容器的子节点）时才铺满画板。
  // 画布模式下元素是世界坐标的平铺兄弟节点，没有画板容器可对齐，必须保留自身坐标，
  // 否则外壳会被钉到世界原点，画板上只剩底色。
  const fillsSurface = element.designRole === 'page-shell' && Boolean(ctx.surface)
  const left = element.x - ctx.origin.x
  const top = element.y - ctx.origin.y
  const width = fillsSurface ? ctx.surface!.width : element.width
  const height = fillsSurface ? ctx.surface!.height : element.height

  if (ctx.surface && (left < 0 || top < 0 || left + width > ctx.surface.width)) {
    // 只诊断不改写；越界拦截由 Scene Commit 负责，渲染层不再各自夹回。
    ctx.diagnostics.push({
      code: 'OUT_OF_BOUNDS',
      severity: 'warning',
      message: `节点 ${element.name} 超出画板边界。`,
      elementId: element.id,
    })
  }

  const rotation = element.rotation ?? 0
  const scaleX = element.flipX ? -1 : 1
  const scaleY = element.flipY ? -1 : 1
  const transform =
    rotation || scaleX !== 1 || scaleY !== 1
      ? `rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`
      : undefined

  const boxCss = declare({
    // 一律绝对定位。autoLayout 是编辑期工具：设置后 editor-store 立即把计算结果
    // 写回子节点的 x/y（`applySectionAutoLayoutToElements`），存量坐标本身就是
    // 排版结果。导出时再让子节点走 flex 流，等于用另一套基准重算一遍布局，
    // 会丢弃画布赖以显示的坐标并造成元素堆叠。
    position: 'absolute',
    left: fillsSurface ? px(0) : px(left),
    top: fillsSurface ? px(0) : px(top),
    width: px(width),
    height: px(height),
    display: 'flex',
    'align-items': 'stretch',
    'justify-content': 'stretch',
    opacity: element.opacity !== undefined && element.opacity !== 1 ? String(element.opacity) : undefined,
    'z-index': String(element.zIndex),
    transform,
    'transform-origin': transform ? 'center' : undefined,
    overflow: element.clipContent ? 'hidden' : undefined,
    'box-shadow': element.shadow ? shadowCss(element.shadow) : undefined,
    'border-radius': cornerRadiiCss(resolveCornerRadii(element)),
  })

  // autoLayout 不产出 flex 容器 CSS：子节点已是绝对定位，写了也不生效，
  // 但 padding/gap 会意外影响 content 层，让画布与导出出现差异。
  // 排版由 editor-store 在设置 autoLayout 时一次性写回坐标完成。

  const content = buildContentBox(element, ctx)
  return {
    key: element.id,
    role: 'box',
    tag: 'div',
    css: boxCss,
    classNames: ['design-element'],
    attrs: { 'data-element-id': element.id },
    children: content ? [content] : [],
    meta: {
      elementId: element.id,
      elementType: element.type,
      name: element.name,
      interactive:
        ctx.mode === 'canvas'
          ? { editableText: element.type === 'text' && !element.locked, locked: element.locked }
          : undefined,
    },
  }
}

/** 内容层：承载排版与填充。尺寸一律 100%，由 box 层定尺。 */
function buildContentBox(element: DesignElement, ctx: RenderContext): RenderBox | null {
  const key = `${element.id}::content`
  const fill = { width: '100%', height: '100%' }

  if (element.type === 'text') {
    const style = element.style
    return {
      key,
      role: 'content',
      tag: 'span',
      css: declare({
        ...fill,
        display: 'flex',
        'align-items': 'flex-start',
        'white-space': 'pre-wrap',
        color: style.color,
        'font-family': style.fontFamily,
        'font-size': px(style.fontSize),
        'font-weight': String(style.fontWeight ?? 400),
        'line-height': lineHeightValue(style.lineHeight),
        'text-align': style.textAlign ?? 'left',
        overflow: style.overflow === 'visible' ? 'visible' : 'hidden',
        'text-overflow': style.overflow === 'ellipsis' ? 'ellipsis' : undefined,
      }),
      classNames: ['text-element'],
      text: element.content,
      children: [],
      meta: { elementId: element.id, elementType: element.type, name: element.name },
    }
  }

  if (element.type === 'image') {
    return {
      key,
      role: 'content',
      tag: 'img',
      css: declare({
        ...fill,
        display: 'block',
        'object-fit': element.objectFit ?? 'cover',
        'object-position': element.objectPosition ?? '50% 50%',
        'border-radius': 'inherit',
      }),
      classNames: ['image-element'],
      // alt 一律留空：图片加载失败时浏览器会把 alt 当可见文本渲染，
      // 占据空间并挤动周围布局，导出与画布因此产生差异。
      // 装饰性图片留空 alt 也符合无障碍规范（有意义的信息由文本节点承载）。
      attrs: { src: element.src, alt: '' },
      children: [],
      meta: { elementId: element.id, elementType: element.type, name: element.name },
    }
  }

  if (element.type === 'button') {
    const style = element.style
    return {
      key,
      role: 'content',
      tag: 'button',
      css: declare({
        ...fill,
        display: 'grid',
        'place-items': 'center',
        border: '0',
        background: style.background,
        color: style.color,
        'font-size': px(style.fontSize),
        'font-weight': String(style.fontWeight ?? 700),
        'text-align': 'center',
        'border-radius': 'inherit',
      }),
      classNames: ['button-element'],
      text: element.content,
      children: [],
      meta: { elementId: element.id, elementType: element.type, name: element.name },
    }
  }

  if (element.type === 'input') {
    const style = element.style
    return {
      key,
      role: 'content',
      // 所有 mode 都用真实 input：换标签会改变浏览器的文本基线与内边距算法，
      // 让画布和导出产生无法对齐的偏差。mode 只允许影响交互，不影响视觉。
      tag: 'input',
      css: declare({
        ...fill,
        display: 'flex',
        'align-items': 'center',
        padding: '0 10px',
        background: style.background,
        color: style.color,
        'font-size': px(style.fontSize),
        'font-weight': String(style.fontWeight ?? 400),
        border: `${px(style.borderWidth ?? 1)} solid ${style.borderColor ?? '#d1d5db'}`,
        'border-radius': 'inherit',
      }),
      // 编辑器内由 box 层统一接管指针事件，交给 class 而非 css 以保持
      // "视觉 CSS 与 mode 无关" 的不变式。
      classNames:
        ctx.mode === 'export' ? ['input-element'] : ['input-element', 'input-element-static'],
      attrs: { value: element.content, 'aria-label': element.name },
      children: [],
      meta: { elementId: element.id, elementType: element.type, name: element.name },
    }
  }

  if (element.type === 'shape') {
    return {
      key,
      role: 'content',
      tag: 'div',
      css: declare({
        ...fill,
        background: element.fill,
        border: element.stroke
          ? `${px(element.strokeWidth ?? 0)} solid ${element.stroke}`
          : undefined,
        'border-radius': element.shape === 'circle' ? '50%' : 'inherit',
      }),
      classNames: element.shape === 'circle' ? ['shape-element', 'circle'] : ['shape-element'],
      children: [],
      meta: { elementId: element.id, elementType: element.type, name: element.name },
    }
  }

  if (element.type === 'section') {
    return {
      key,
      role: 'content',
      tag: 'div',
      css: declare(fill),
      classNames: ['component-section-element'],
      attrs: element.label ? { 'aria-label': element.label } : undefined,
      children: [],
      meta: { elementId: element.id, elementType: element.type, name: element.name },
    }
  }

  return buildPlaceholderContent(element, key)
}

export interface ArtboardRenderTree {
  root: RenderBox
  /** 扁平化的全部 box（含 content 层），供 codegen 生成 CSS 规则。 */
  boxes: RenderBox[]
  diagnostics: RenderDiagnostic[]
  surface: { width: number; height: number }
}

/** 只声明渲染所需的最小结构，便于 codegen 与测试传入精简文档。 */
export interface SceneComponentInstance {
  id: string
  artboardId: string
  rootElementId: string
  componentName: string
  design: { packId?: string; propsPatch: Record<string, unknown> }
}

interface SceneDocument {
  elements: DesignElement[]
  componentInstances?: Record<string, SceneComponentInstance>
}

/**
 * 构建整块画板的 IR。
 *
 * `structure: 'flat'` 对应画布与静态快照：元素按层级树展平，坐标相对画板。
 * `structure: 'nested'` 对应代码导出：按 parentId 嵌套，子节点坐标相对父节点，
 * 使 autoLayout 的 flex 语义和 section 裁剪成立。
 */
export function buildArtboardRenderTree(
  document: SceneDocument,
  artboard: Artboard,
  options: {
    mode: RenderMode
    structure: 'flat' | 'nested'
    /** 仅导出选区时使用，含子树。 */
    selectionIds?: string[]
  },
): ArtboardRenderTree {
  const diagnostics: RenderDiagnostic[] = []
  const hierarchy = flattenElementsForPainting(
    document.elements.filter(
      (element) => (element.artboardId ?? artboard.id) === artboard.id,
    ),
  )

  const instances = Object.values(document.componentInstances ?? {}).filter(
    (item) => item.artboardId === artboard.id,
  )
  const instanceByRoot = new Map(instances.map((item) => [item.rootElementId, item]))
  const instanceIds = new Set(instances.map((item) => item.id))
  // 组件内部节点由 Runtime Component 自行渲染，只保留实例根节点。
  const scopedElements = hierarchy.filter(
    (element) =>
      element.visible !== false &&
      (!element.componentBinding ||
        !instanceIds.has(element.componentBinding.instanceId) ||
        instanceByRoot.get(element.id)?.id === element.componentBinding.instanceId),
  )
  // 平铺出口需要全局且连续的绘制序号，不能直接复用只在同级内有意义的 zIndex。
  const scoped =
    options.structure === 'flat'
      ? scopedElements.map((element, zIndex) =>
          element.zIndex === zIndex
            ? element
            : ({ ...element, zIndex } as DesignElement),
        )
      : scopedElements

  const selection = new Set(options.selectionIds ?? [])
  const byId = new Map(scoped.map((element) => [element.id, element]))
  const inSelection = (element: DesignElement) => {
    if (!selection.size) return true
    let current: DesignElement | undefined = element
    while (current) {
      if (selection.has(current.id)) return true
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    return false
  }
  const elements = scoped.filter(inSelection)

  // 选区导出时把包围盒左上角对齐到原点；整板导出直接用画板原点。
  const bounds = selection.size
    ? {
        x: Math.min(...elements.map((element) => element.x)),
        y: Math.min(...elements.map((element) => element.y)),
        right: Math.max(...elements.map((element) => element.x + element.width)),
        bottom: Math.max(...elements.map((element) => element.y + element.height)),
      }
    : {
        x: artboard.x,
        y: artboard.y,
        right: artboard.x + artboard.width,
        bottom: artboard.y + artboard.height,
      }
  const surface = {
    width: Math.max(1, bounds.right - bounds.x),
    height: Math.max(1, bounds.bottom - bounds.y),
  }

  const ids = new Set(elements.map((element) => element.id))
  const byParent = new Map<string | undefined, DesignElement[]>()
  for (const element of elements) {
    let parentId = element.parentId
    if (options.structure === 'flat') parentId = undefined
    else if (parentId && !ids.has(parentId)) {
      diagnostics.push({
        code: 'ORPHAN_PROMOTED',
        severity: 'warning',
        message: `节点 ${element.name} 的父节点不存在，已提升到画板根层。`,
        elementId: element.id,
      })
      parentId = undefined
    }
    const siblings = byParent.get(parentId) ?? []
    siblings.push(element)
    byParent.set(parentId, siblings)
  }

  const root: RenderBox = {
    key: `artboard-${artboard.id}`,
    role: 'artboard',
    tag: 'main',
    css: declare({
      position: 'relative',
      width: px(surface.width),
      height: px(surface.height),
      background: artboard.background,
      'border-radius': artboard.borderRadius ? px(artboard.borderRadius) : undefined,
      overflow: artboard.overflow ?? 'hidden',
      'box-sizing': 'border-box',
      isolation: 'isolate',
    }),
    classNames: ['artboard-surface'],
    attrs: { 'data-artboard-id': artboard.id },
    children: [],
    meta: { name: artboard.name },
  }

  root.children = build(undefined, { x: bounds.x, y: bounds.y }, undefined)
  return { root, boxes: flattenBoxes(root), diagnostics, surface }

  function build(
    parentId: string | undefined,
    origin: { x: number; y: number },
    parent: DesignElement | undefined,
  ): RenderBox[] {
    const siblings = (byParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.zIndex - b.zIndex)
    const result: RenderBox[] = []
    for (const element of siblings) {
      const box = buildRenderBox(element, {
        mode: options.mode,
        origin,
        parent,
        surface,
        diagnostics,
      })
      if (!box) continue
      const instance = instanceByRoot.get(element.id)
      if (instance) {
        if (!instance.design.packId) {
          diagnostics.push({
            code: 'RUNTIME_PACK_MISSING',
            severity: 'warning',
            message: `组件 ${instance.componentName} 未声明 Component Pack，导出需要运行时适配器。`,
            elementId: element.id,
          })
        }
        box.meta.runtime = {
          instanceId: instance.id,
          componentName: instance.componentName,
          componentPackId: instance.design.packId,
          props: structuredClone(instance.design.propsPatch),
          binding: element.componentBinding,
        }
        // Runtime Component 自带内部结构，导出时不保留占位内容层。
        if (options.mode === 'export') box.children = []
        result.push(box)
        continue
      }
      if (options.structure === 'nested') {
        box.children = [
          ...box.children,
          ...build(element.id, { x: element.x, y: element.y }, element),
        ]
      }
      result.push(box)
    }
    return result
  }
}

function flattenBoxes(box: RenderBox): RenderBox[] {
  return [box, ...box.children.flatMap(flattenBoxes)]
}

/** 占位符预览。原先依赖 SCSS 的 `:has()`，改为构建时按 preview 是否存在直接产出。 */
function buildPlaceholderContent(
  element: Extract<DesignElement, { type: 'runtime-placeholder' }>,
  key: string,
): RenderBox {
  const preview = element.preview
  const base = declare({
    width: '100%',
    height: '100%',
    color: element.textColor || 'rgba(71, 85, 105, 0.72)',
    'font-size': px(11),
    'text-align': 'center',
  })
  if (!preview) {
    return {
      key,
      role: 'content',
      tag: 'div',
      css: {
        ...base,
        display: 'grid',
        'place-items': 'center',
        border: '1px dashed rgba(100, 116, 139, 0.42)',
        'border-radius': px(6),
        background: 'rgba(255, 255, 255, 0.08)',
      },
      classNames: ['runtime-placeholder-element'],
      attrs: { 'aria-hidden': 'true' },
      text: element.label,
      children: [],
      meta: { elementId: element.id, elementType: element.type, name: element.name },
    }
  }
  const cards = preview.variant === 'cards'
  const items: RenderBox[] = preview.items.map((item, index) => ({
    key: `${key}::item-${index}`,
    role: 'content',
    tag: 'div',
    css: cards
      ? declare({
          display: 'grid',
          'min-width': '0',
          'place-items': 'end center',
          padding: `${px(8)} ${px(2)}`,
          border: '1px solid currentColor',
          'border-radius': px(6),
          background: 'rgba(255, 255, 255, 0.08)',
          'font-size': px(10),
          'text-align': 'center',
        })
      : declare({
          overflow: 'hidden',
          padding: `${px(2)} ${px(4)}`,
          'font-size': px(10),
          'line-height': '1.35',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
        }),
    classNames: ['runtime-preview-item'],
    text: item,
    children: [],
    meta: {},
  }))
  return {
    key,
    role: 'content',
    tag: 'div',
    css: { ...base, display: 'block', 'border-color': 'transparent', background: 'transparent' },
    classNames: ['runtime-placeholder-element', `runtime-placeholder-${preview.variant}`],
    attrs: { 'aria-hidden': 'true' },
    children: [
      {
        key: `${key}::preview`,
        role: 'content',
        tag: 'div',
        css: declare({
          display: 'grid',
          width: '100%',
          height: '100%',
          gap: px(6),
          'grid-template-columns': cards ? 'repeat(4, minmax(0, 1fr))' : undefined,
          'align-content': cards ? undefined : 'start',
        }),
        classNames: ['runtime-preview-content'],
        children: items,
        meta: {},
      },
    ],
    meta: { elementId: element.id, elementType: element.type, name: element.name },
  }
}
