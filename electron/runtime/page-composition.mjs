export function createPageCompositionBlueprint(components, visualTheme, options = {}) {
  const width = 375
  const gap = Math.max(0, finiteOr(options.gap, 24))
  const padding = Math.max(0, finiteOr(options.padding, 16))
  let cursorY = padding
  const sections = components.map((component, index) => {
    const estimatedHeight = Math.max(120, Number(component.estimatedHeight) || 520)
    const section = {
      id: `component-section-${index + 1}`,
      role: component.label || component.componentName,
      kind: 'component-instance',
      bounds: {
        x: padding,
        y: cursorY,
        width: width - padding * 2,
        height: estimatedHeight,
      },
      source: 'component-thumbnail',
      component: {
        componentName: component.componentName,
        ...(component.profile ? { profile: component.profile } : {}),
      },
    }
    cursorY += estimatedHeight + gap
    return section
  })
  const estimatedHeight = Math.max(812, cursorY - gap + padding)
  return {
    version: 1,
    width,
    estimatedHeight,
    visualTheme,
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
    constraints: sections.flatMap((section, index) => index ? [{
      type: 'vertical-gap',
      from: sections[index - 1].id,
      to: section.id,
      value: gap,
    }] : []),
  }
}

function finiteOr(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function validatePageCompositionBlueprint(blueprint) {
  const issues = []
  if (blueprint?.version !== 1) issues.push('version 必须为 1')
  if (blueprint?.width !== 375) issues.push('页面逻辑宽度必须为 375')
  if (!Number.isFinite(blueprint?.estimatedHeight) || blueprint.estimatedHeight <= 0) {
    issues.push('estimatedHeight 必须为正数')
  }
  if (!Array.isArray(blueprint?.sections) || !blueprint.sections.length) {
    issues.push('页面必须包含至少一个 Section')
    return issues
  }
  const ids = new Set()
  for (const section of blueprint.sections) {
    if (!section?.id || ids.has(section.id)) issues.push('Section ID 缺失或重复')
    ids.add(section?.id)
    const bounds = section?.bounds
    if (
      !bounds || bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0 ||
      bounds.x + bounds.width > blueprint.width
    ) issues.push(`Section ${section?.id || 'unknown'} 越界`)
    if (section?.kind === 'component-instance' && !section.component?.componentName) {
      issues.push(`Section ${section.id} 缺少组件引用`)
    }
  }
  return issues
}
