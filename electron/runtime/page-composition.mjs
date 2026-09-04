/**
 * 页面布局度量。组件真实高度量测需要在 Blueprint 之前就知道 Section 宽度，
 * 因此这里抽成共享函数，避免量测与排版各算一套导致高度对不上。
 */
export function resolvePageLayoutMetrics(componentCount, surface = {}, options = {}) {
  const width = Math.max(1, finiteOr(surface.viewport?.width, 375))
  const initialHeight = Math.max(1, finiteOr(surface.viewport?.height, 812))
  const gap = Math.max(0, finiteOr(options.gap, surface.layout?.gap ?? 24))
  const padding = Math.max(0, finiteOr(options.padding, surface.layout?.padding ?? 16))
  const direction = ['vertical', 'horizontal', 'grid'].includes(surface.layout?.direction)
    ? surface.layout.direction
    : 'vertical'
  const count = Math.max(1, Number(componentCount) || 1)
  const columnCount =
    direction === 'horizontal'
      ? count
      : direction === 'grid'
        ? Math.max(1, Math.min(count, finiteOr(surface.layout?.columns, 2)))
        : 1
  const sectionWidth = (width - padding * 2 - gap * (columnCount - 1)) / columnCount
  return { width, initialHeight, gap, padding, direction, columnCount, sectionWidth }
}

export function createPageCompositionBlueprint(components, visualTheme, options = {}) {
  const surface = options.surface ?? {}
  const { width, initialHeight, gap, padding, direction, columnCount, sectionWidth } =
    resolvePageLayoutMetrics(components.length, surface, options)
  // KV/主视觉必须占据页面顶部的真实垂直空间。之前 Section 从 padding 起排，
  // 页面外壳里的 KV 会被组件完全盖住，页面看起来只是组件堆叠。
  const heroHeight = Math.max(0, Math.round(finiteOr(options.heroHeight, 0)))
  const contentTop = heroHeight > 0 ? heroHeight + gap : padding
  const heights = components.map((component) =>
    Math.max(120, Math.round(Number(component.estimatedHeight) || 520)),
  )
  const rowHeights = Array.from({ length: Math.ceil(components.length / columnCount) }, (_, row) =>
    Math.max(...heights.slice(row * columnCount, (row + 1) * columnCount)),
  )
  const rowOffsets = rowHeights.map(
    (_, row) => contentTop + rowHeights.slice(0, row).reduce((sum, height) => sum + height + gap, 0),
  )
  const heroSections =
    heroHeight > 0
      ? [
          {
            id: 'page-hero-1',
            role: '页面主视觉 KV',
            kind: 'page-hero',
            bounds: { x: 0, y: 0, width, height: heroHeight },
            source: 'page-shell',
          },
        ]
      : []
  const componentSections = components.map((component, index) => {
    const estimatedHeight = heights[index]
    const column = index % columnCount
    const row = Math.floor(index / columnCount)
    const section = {
      id: `component-section-${index + 1}`,
      role: component.label || component.componentName,
      kind: 'component-instance',
      bounds: {
        x: padding + column * (sectionWidth + gap),
        y: rowOffsets[row],
        width: sectionWidth,
        height: estimatedHeight,
      },
      source: 'component-thumbnail',
      component: {
        componentName: component.componentName,
        ...(component.profile ? { profile: component.profile } : {}),
      },
    }
    return section
  })
  const sections = [...heroSections, ...componentSections]
  const contentHeight =
    contentTop +
    padding +
    rowHeights.reduce((sum, height) => sum + height, 0) +
    gap * Math.max(0, rowHeights.length - 1)
  const estimatedHeight = Math.max(initialHeight, contentHeight)
  return {
    version: 1,
    width,
    estimatedHeight,
    visualTheme,
    surface: {
      kind: surface.kind || 'mobile',
      autoHeight: surface.autoHeight !== false,
      layout: { direction, columns: columnCount, padding, gap, ...(heroHeight ? { heroHeight } : {}) },
    },
    ...(options.pageRoot ? { pageRoot: options.pageRoot } : {}),
    ...(Array.isArray(options.containers) && options.containers.length
      ? {
          containers: options.containers.map((container) => ({
            ...container,
            bounds: container.bounds ?? { x: 0, y: 0, width, height: estimatedHeight },
          })),
        }
      : {}),
    sections,
    // 间距约束只描述组件之间的流式关系；hero 是外壳独占的预留区，不参与组件流。
    constraints: componentSections.flatMap((section, index) =>
      index
        ? [
            {
              type: direction === 'vertical' ? 'vertical-gap' : 'flow-gap',
              from: componentSections[index - 1].id,
              to: section.id,
              value: gap,
            },
          ]
        : [],
    ),
  }
}

function finiteOr(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function validatePageCompositionBlueprint(blueprint) {
  const issues = []
  if (blueprint?.version !== 1) issues.push('version 必须为 1')
  if (!Number.isFinite(blueprint?.width) || blueprint.width <= 0)
    issues.push('页面逻辑宽度必须为正数')
  if (!Number.isFinite(blueprint?.estimatedHeight) || blueprint.estimatedHeight <= 0) {
    issues.push('estimatedHeight 必须为正数')
  }
  if (!Array.isArray(blueprint?.sections) || !blueprint.sections.length) {
    issues.push('页面必须包含至少一个 Section')
    return issues
  }
  if (!blueprint.sections.some((section) => section?.kind === 'component-instance')) {
    issues.push('页面必须包含至少一个组件 Section')
    return issues
  }
  const ids = new Set()
  for (const section of blueprint.sections) {
    if (!section?.id || ids.has(section.id)) issues.push('Section ID 缺失或重复')
    ids.add(section?.id)
    const bounds = section?.bounds
    if (
      !bounds ||
      bounds.x < 0 ||
      bounds.y < 0 ||
      bounds.width <= 0 ||
      bounds.height <= 0 ||
      bounds.x + bounds.width > blueprint.width
    )
      issues.push(`Section ${section?.id || 'unknown'} 越界`)
    if (section?.kind === 'component-instance' && !section.component?.componentName) {
      issues.push(`Section ${section.id} 缺少组件引用`)
    }
  }
  return issues
}
