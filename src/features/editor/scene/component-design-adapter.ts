import type { Artboard, ComponentDesignMeta, DesignElement } from '../types'
import { designElementsToSceneGraph } from './design-element-adapter'
import { compileSceneCommit } from './scene-commit'

export const COMPONENT_DESIGN_ADAPTER_ID = 'campaign-component-design'

/**
 * 区分「倍数行高」与「像素行高」的阈值。
 *
 * 与 `electron/runtime/runtime-dom-adapter.mjs` 的 `normalizeRuntimeLineHeight`
 * 使用同一个值：倍数行高极少超过 4，像素行高极少小于 4。
 */
const LINE_HEIGHT_RATIO_MAX = 4

interface ComponentRasterAsset {
  src: string
  width: number
  height: number
  name: string
}

interface CompileComponentDesignOptions {
  componentDesign: ComponentDesignMeta
  assets: ComponentRasterAsset[]
  artboard: Artboard
  instanceId: string
  rootElementId: string
  pageSectionId?: string
  originX: number
  originY: number
  width: number
  height: number
  scale: number
  baseZIndex: number
  locked: boolean
}

export function compileComponentDesignToSceneCommit(options: CompileComponentDesignOptions) {
  const {
    componentDesign,
    assets,
    artboard,
    instanceId,
    rootElementId,
    pageSectionId,
    originX,
    originY,
    width,
    height,
    scale,
    baseZIndex,
    locked,
  } = options
  const propertyKinds = new Map(
    (componentDesign.properties ?? []).map((property) => [property.path, property.kind]),
  )
  const tasksBySlot = new Map(
    componentDesign.assetTasks.map((task, index) => [task.slotId, { task, image: assets[index] }]),
  )
  const rootBinding = {
    instanceId,
    componentName: componentDesign.componentName,
    profile: componentDesign.profile,
    regionId: 'root',
    renderMode: 'root' as const,
    rootElementId,
    pageSectionId,
    propPaths: [],
    bindings: {},
  }
  const root: DesignElement = {
    id: rootElementId,
    artboardId: artboard.id,
    type: 'section',
    name: `${componentDesign.componentName} 组件`,
    label: `${componentDesign.componentName} / ${componentDesign.profile}`,
    x: originX,
    y: originY,
    width,
    height,
    zIndex: baseZIndex,
    locked,
    componentBinding: rootBinding,
  }
  const usedIds = new Set([rootElementId])
  const orderedRegions = componentDesign.blueprint.regions
    .map((region, sourceIndex) => ({ region, sourceIndex }))
    .sort(
      (left, right) =>
        componentRegionLayerRank(left.region) - componentRegionLayerRank(right.region) ||
        left.sourceIndex - right.sourceIndex,
    )
  const regions = orderedRegions.map(({ region }, index): DesignElement => {
    const slotAsset = region.slotId ? tasksBySlot.get(region.slotId) : undefined
    const bindings = createComponentBindings(
      region.propBindings,
      propertyKinds,
      slotAsset?.task.propPath,
    )
    const id = stableRegionElementId(rootElementId, region.id, usedIds)
    const base = {
      id,
      artboardId: artboard.id,
      parentId: rootElementId,
      name: region.role,
      x: originX + region.bounds.x * scale,
      y: originY + region.bounds.y * scale,
      width: Math.max(1, region.bounds.width * scale),
      height: Math.max(1, region.bounds.height * scale),
      zIndex: baseZIndex + index + 1,
      locked,
      visible: region.visible !== false,
      opacity: typeof region.style?.opacity === 'number' ? region.style.opacity : undefined,
      shadow: readRegionShadow(region.style?.shadow, scale),
      componentBinding: {
        instanceId,
        componentName: componentDesign.componentName,
        profile: componentDesign.profile,
        regionId: region.id,
        slotId: region.slotId,
        repeaterPath: region.repeaterPath,
        repeatIndex: region.repeatIndex,
        templateId: region.templateId,
        renderMode: region.renderMode,
        rootElementId,
        pageSectionId,
        propPaths: region.propBindings,
        bindings,
      },
    }
    if (region.renderMode === 'generated-asset' && slotAsset?.image) {
      return {
        ...base,
        type: 'image',
        src: slotAsset.image.src,
        // 普通素材保持原始比例，避免 150x56 等横幅被拉伸成竖条；
        // 只有明确标记为 designOnly 的装饰背景才需要铺满区域。
        objectFit: slotAsset.task.designOnly ? 'fill' : 'contain',
        designRole: slotAsset.task.designOnly ? 'component-decoration' : undefined,
      }
    }
    if (region.renderMode === 'runtime' && region.assetSource) {
      return {
        ...base,
        type: 'image',
        src: region.assetSource,
        objectFit: 'contain',
      }
    }
    if (region.renderMode === 'color') {
      return {
        ...base,
        type: 'shape',
        shape: 'rect',
        // Hybrid delivery has already mapped Runtime paint to the active
        // visual theme. Props remain bound for export, but must not paint the
        // canvas back to the component's original theme.
        fill:
          typeof region.style?.fill === 'string'
            ? region.style.fill
            : readRegionColor(
                region.propBindings,
                componentDesign.blueprint.propertyValues,
                readThemeColor(componentDesign, 'background', '#e5e7eb'),
              ),
        stroke: typeof region.style?.stroke === 'string' ? region.style.stroke : undefined,
        strokeWidth:
          typeof region.style?.strokeWidth === 'number'
            ? region.style.strokeWidth * scale
            : undefined,
        borderRadius:
          typeof region.style?.radius === 'number'
            ? region.style.radius * scale
            : (componentDesign.blueprint.visualTheme?.surfaces?.[0]?.radius ?? 0),
      }
    }
    if (region.renderMode === 'text') {
      const typography = readThemeTypography(componentDesign, region.styleRole ?? 'body')
      const runtimeFontSize =
        typeof region.style?.fontSize === 'number' ? region.style.fontSize * scale : undefined
      return {
        ...base,
        type: 'text',
        content: region.content || region.role,
        style: {
          fontSize:
            runtimeFontSize ??
            (typeof typography?.size === 'number'
              ? typography.size * scale
              : Math.max(12, Math.min(32, region.bounds.height * scale * 0.42))),
          fontWeight:
            typeof region.style?.fontWeight === 'number'
              ? region.style.fontWeight
              : (typography?.weight ?? 700),
          fontFamily: typography?.family,
          color:
            typeof region.style?.color === 'string'
              ? region.style.color
              : readRegionColor(
                  region.propBindings,
                  componentDesign.blueprint.propertyValues,
                  readThemeColor(componentDesign, 'text', '#111827'),
                ),
          lineHeight: typography?.lineHeight ?? normalizeLineHeight(region.style),
          textAlign: region.textAlign ?? 'center',
        },
      }
    }
    if (region.renderMode === 'button') {
      const fill = readRegionColor(
        region.propBindings,
        componentDesign.blueprint.propertyValues,
        readThemeColor(componentDesign, 'primary', '#2563eb'),
      )
      return {
        ...base,
        type: 'button',
        content: region.content || region.role,
        style: {
          background: typeof region.style?.fill === 'string' ? region.style.fill : fill,
          color:
            typeof region.style?.color === 'string'
              ? region.style.color
              : readThemeColor(componentDesign, 'text', '#ffffff'),
          fontSize: Math.max(12, Math.min(18, region.bounds.height * scale * 0.38)),
          fontWeight: 700,
          borderRadius:
            typeof region.style?.radius === 'number'
              ? region.style.radius * scale
              : (componentDesign.blueprint.visualTheme?.surfaces?.[0]?.radius ?? 8),
        },
      }
    }
    return {
      ...base,
      type: 'runtime-placeholder',
      locked: true,
      label: region.role,
      preview: region.preview,
      textColor: readThemeColor(componentDesign, 'text', '#475569'),
    }
  })
  const graph = designElementsToSceneGraph([root, ...regions], {
    graphId: `scene:${COMPONENT_DESIGN_ADAPTER_ID}:${instanceId}`,
    rootNodeId: rootElementId,
    artboard: { ...artboard, width },
    surfaceKind: 'mobile',
    contentHeight: height,
    adapterId: COMPONENT_DESIGN_ADAPTER_ID,
  })
  graph.surface.originX = originX
  graph.surface.originY = originY
  graph.surface.width = width
  graph.surface.height = height
  graph.tokens = componentDesign.blueprint.visualTheme
    ? { visualTheme: structuredClone(componentDesign.blueprint.visualTheme) }
    : undefined
  return { graph, commit: compileSceneCommit(graph, { artboardId: artboard.id }) }
}

function componentRegionLayerRank(region: ComponentDesignMeta['blueprint']['regions'][number]) {
  if (region.designOnly) return 0
  if (region.renderMode === 'color') return 10
  if (region.renderMode === 'runtime' && !region.assetSource) return 20
  if (region.renderMode === 'runtime' && region.assetSource) return 30
  if (region.renderMode === 'generated-asset') return 40
  if (region.renderMode === 'button') return 45
  if (region.renderMode === 'text') return 50
  return 25
}

/**
 * 把行高归一化为「倍数」。
 *
 * 上游可能已经归一化过（`runtime-dom-adapter` 的 `normalizeRuntimeLineHeight`
 * 会把 `18px / 14px` 换算成 `1.2857`），此处若无条件再除一次字号，就会得到
 * `1.2857 / 14 = 0.0918` —— 行盒高度塌到约 1px，文字墨迹全部溢出并被
 * `overflow: hidden` 裁掉，表现为文案偏上且上下都被切。
 *
 * 判据用「是否已是倍数量级」：CSS 里倍数行高极少超过 4，而像素行高极少小于 4，
 * 与 `normalizeRuntimeLineHeight` 保持同一条阈值，避免两处判据漂移。
 */
function normalizeLineHeight(style: { lineHeight?: unknown; fontSize?: unknown } | undefined) {
  const lineHeight = Number(style?.lineHeight)
  const fontSize = Number(style?.fontSize)
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return 1.3
  // 已是倍数，直接采用。
  if (lineHeight <= LINE_HEIGHT_RATIO_MAX) return lineHeight
  // 像素值需要字号才能换算；缺字号时退回默认值，不能拿像素当倍数用。
  if (!Number.isFinite(fontSize) || fontSize <= 0) return 1.3
  return lineHeight / fontSize
}

function readRegionShadow(value: unknown, scale: number) {
  if (!value || typeof value !== 'object') return undefined
  const shadow = value as Record<string, unknown>
  if (
    ![shadow.x, shadow.y, shadow.blur].every((item) => typeof item === 'number') ||
    typeof shadow.color !== 'string'
  ) {
    return undefined
  }
  return {
    x: (shadow.x as number) * scale,
    y: (shadow.y as number) * scale,
    blur: (shadow.blur as number) * scale,
    spread: typeof shadow.spread === 'number' ? shadow.spread * scale : undefined,
    color: shadow.color,
  }
}

function stableRegionElementId(rootId: string, regionId: string, usedIds: Set<string>) {
  const token =
    String(regionId || 'region')
      .trim()
      .replace(/[^a-z0-9_-]+/gi, '-')
      .replace(/^-|-$/g, '') || 'region'
  let id = `${rootId}:region:${token}`
  let suffix = 2
  while (usedIds.has(id)) id = `${rootId}:region:${token}-${suffix++}`
  usedIds.add(id)
  return id
}

function createComponentBindings(
  propPaths: string[],
  propertyKinds: Map<string, string>,
  imagePath?: string,
) {
  const bindings: NonNullable<DesignElement['componentBinding']>['bindings'] = {}
  for (const path of propPaths) {
    const kind = propertyKinds.get(path)
    if (kind === 'width' || kind === 'height' || kind === 'x' || kind === 'y') bindings[kind] = path
    else if (kind === 'color') bindings.color = path
    else if (kind === 'visibility') bindings.visible = path
  }
  if (imagePath) bindings.image = imagePath
  return bindings
}

function readRegionColor(
  propPaths: string[],
  propertyValues: Record<string, unknown>,
  fallback: string,
) {
  return (
    propPaths
      .map((path) => propertyValues[path])
      .find(
        (value): value is string =>
          typeof value === 'string' && /^(?:#|rgb|hsl|transparent)/i.test(value),
      ) ?? fallback
  )
}

function readThemeColor(
  design: ComponentDesignMeta,
  role: 'primary' | 'secondary' | 'background' | 'surface' | 'text' | 'accent',
  fallback: string,
) {
  const theme = design.blueprint.visualTheme
  const value =
    theme?.colorTokens?.find((token) => token.role === role)?.value ??
    (role === 'text'
      ? theme?.colors[2]
      : role === 'background'
        ? theme?.colors[1]
        : theme?.colors[0]) ??
    fallback
  if (role !== 'text') return value
  const background =
    theme?.colorTokens?.find((token) => token.role === 'background')?.value ?? theme?.colors[1]
  return ensureReadableColor(value, background, fallback)
}

function readThemeTypography(
  design: ComponentDesignMeta,
  role: 'display' | 'heading' | 'body' | 'caption' | 'button',
) {
  const typography = design.blueprint.visualTheme?.typography ?? []
  return typography.find((token) => token.role === role) ?? typography[0]
}

function ensureReadableColor(value: string, background: string | undefined, fallback: string) {
  const foregroundRgb = parseHexRgb(value)
  const backgroundRgb = parseHexRgb(background)
  if (!foregroundRgb || !backgroundRgb || contrastRatio(foregroundRgb, backgroundRgb) >= 4.5)
    return value
  const dark = [31, 41, 55]
  const light = [255, 255, 255]
  return contrastRatio(dark, backgroundRgb) >= contrastRatio(light, backgroundRgb)
    ? '#1f2937'
    : fallback
}

function parseHexRgb(value: string | undefined) {
  const match = String(value || '').match(/^#([0-9a-f]{6})$/i)
  if (!match) return undefined
  const number = Number.parseInt(match[1], 16)
  return [number >> 16, (number >> 8) & 255, number & 255]
}

function contrastRatio(left: number[], right: number[]) {
  const luminance = (rgb: number[]) =>
    rgb.reduce((total, channel, index) => {
      const normalized = channel / 255
      const value =
        normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
      return total + value * [0.2126, 0.7152, 0.0722][index]
    }, 0)
  const a = luminance(left)
  const b = luminance(right)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
