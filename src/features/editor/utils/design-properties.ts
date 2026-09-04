import type {
  CornerValues,
  DesignElement,
  EdgeValues,
  ElementLayoutSizing,
  SectionElement,
} from '../types'

export const DEFAULT_EDGE_VALUES: EdgeValues = { top: 16, right: 16, bottom: 16, left: 16 }
export const ZERO_CORNER_VALUES: CornerValues = {
  topLeft: 0,
  topRight: 0,
  bottomRight: 0,
  bottomLeft: 0,
}

export function resolveLayoutSizing(element: DesignElement): ElementLayoutSizing {
  return element.layoutSizing ?? { widthMode: 'fixed', heightMode: 'fixed' }
}

export function resolveCornerRadii(element: DesignElement): CornerValues {
  if (element.cornerRadii) return element.cornerRadii
  const radius =
    element.type === 'button' || element.type === 'input'
      ? (element.style.borderRadius ?? 0)
      : element.type === 'image' || element.type === 'shape'
        ? (element.borderRadius ?? 0)
        : 0
  return { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius }
}

export function cornerRadiiToCss(radii: CornerValues) {
  return `${radii.topLeft}px ${radii.topRight}px ${radii.bottomRight}px ${radii.bottomLeft}px`
}

export function resolveTextLineHeightPixels(fontSize: number, lineHeight?: number) {
  if (!lineHeight) return fontSize * 1.4
  return lineHeight > 4 ? lineHeight : lineHeight * fontSize
}

export function textLineHeightToCss(lineHeight?: number) {
  if (!lineHeight) return undefined
  return lineHeight > 4 ? `${lineHeight}px` : lineHeight
}

export function clampSize(value: number, min?: number, max?: number) {
  const clamped = Math.max(min ?? 1, Math.min(max ?? Number.POSITIVE_INFINITY, value))
  return Math.round(clamped * 100) / 100
}

export function resolveElementIntrinsicSize(element: DesignElement) {
  if (element.type === 'text') {
    const lines = element.content.split('\n')
    const fontSize = element.style.fontSize
    const lineHeight = resolveTextLineHeightPixels(fontSize, element.style.lineHeight)
    return {
      width:
        Math.max(
          fontSize,
          ...lines.map((line) => Math.max(1, Array.from(line).length) * fontSize * 0.58),
        ) + 2,
      height: Math.max(lineHeight, lines.length * lineHeight),
    }
  }
  if (element.type === 'button' || element.type === 'input') {
    return {
      width: Math.max(48, Array.from(element.content).length * element.style.fontSize * 0.62 + 32),
      height: Math.max(32, element.style.fontSize * 1.4 + 16),
    }
  }
  return { width: element.width, height: element.height }
}

export function resolveElementLayoutSize(element: DesignElement) {
  const sizing = resolveLayoutSizing(element)
  const intrinsic = resolveElementIntrinsicSize(element)
  return {
    width: clampSize(
      sizing.widthMode === 'hug' ? intrinsic.width : element.width,
      sizing.minWidth,
      sizing.maxWidth,
    ),
    height: clampSize(
      sizing.heightMode === 'hug' ? intrinsic.height : element.height,
      sizing.minHeight,
      sizing.maxHeight,
    ),
  }
}

export function resolveSectionLayoutSize(section: SectionElement, children: DesignElement[]) {
  const sizing = resolveLayoutSizing(section)
  const layout = section.autoLayout
  if (!layout || !children.length) {
    return {
      width: clampSize(section.width, sizing.minWidth, sizing.maxWidth),
      height: clampSize(section.height, sizing.minHeight, sizing.maxHeight),
    }
  }
  const childSizes = children.map(resolveElementLayoutSize)
  const horizontal = layout.direction === 'horizontal'
  const main =
    childSizes.reduce((total, size) => total + (horizontal ? size.width : size.height), 0) +
    Math.max(0, childSizes.length - 1) * layout.gap
  const cross = Math.max(...childSizes.map((size) => (horizontal ? size.height : size.width)))
  const intrinsicWidth = horizontal
    ? layout.padding.left + main + layout.padding.right
    : layout.padding.left + cross + layout.padding.right
  const intrinsicHeight = horizontal
    ? layout.padding.top + cross + layout.padding.bottom
    : layout.padding.top + main + layout.padding.bottom
  return {
    width: clampSize(
      sizing.widthMode === 'hug' ? intrinsicWidth : section.width,
      sizing.minWidth,
      sizing.maxWidth,
    ),
    height: clampSize(
      sizing.heightMode === 'hug' ? intrinsicHeight : section.height,
      sizing.minHeight,
      sizing.maxHeight,
    ),
  }
}
