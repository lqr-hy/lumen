import type { Artboard, DesignDocument, DesignElement } from '../types'

export interface VariantComparisonSummary {
  source: { nodeCount: number; imageCount: number; height: number; palette: string[] }
  variant: { nodeCount: number; imageCount: number; height: number; palette: string[] }
  text: {
    sourceCount: number
    preservedCount: number
    retentionRate: number
    missing: string[]
  }
}

export function compareArtboardVersions(
  document: DesignDocument,
  sourceArtboard: Artboard,
  variantArtboard: Artboard,
): VariantComparisonSummary {
  const sourceElements = visibleArtboardElements(document, sourceArtboard.id)
  const variantElements = visibleArtboardElements(document, variantArtboard.id)
  const sourceTexts = sourceElements.map(readElementText).filter(Boolean)
  const variantTextCounts = countValues(variantElements.map(readElementText).filter(Boolean))
  const missing: string[] = []
  let preservedCount = 0

  for (const text of sourceTexts) {
    const count = variantTextCounts.get(text) ?? 0
    if (count > 0) {
      preservedCount += 1
      variantTextCounts.set(text, count - 1)
    } else if (!missing.includes(text)) {
      missing.push(text)
    }
  }

  return {
    source: summarizeArtboard(sourceArtboard, sourceElements),
    variant: summarizeArtboard(variantArtboard, variantElements),
    text: {
      sourceCount: sourceTexts.length,
      preservedCount,
      retentionRate: sourceTexts.length ? preservedCount / sourceTexts.length : 1,
      missing: missing.slice(0, 6),
    },
  }
}

function visibleArtboardElements(document: DesignDocument, artboardId: string) {
  return document.elements.filter(
    (element) => element.artboardId === artboardId && element.visible !== false,
  )
}

function summarizeArtboard(artboard: Artboard, elements: DesignElement[]) {
  return {
    nodeCount: elements.length,
    imageCount: elements.filter((element) => element.type === 'image').length,
    height: Math.round(artboard.height),
    palette: collectPalette(artboard, elements),
  }
}

function readElementText(element: DesignElement) {
  if (element.type === 'text' || element.type === 'button' || element.type === 'input') {
    return normalizeText(element.content)
  }
  return ''
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function countValues(values: string[]) {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

function collectPalette(artboard: Artboard, elements: DesignElement[]) {
  const colors = [artboard.background]
  for (const element of elements) {
    if (element.type === 'text') colors.push(element.style.color)
    if (element.type === 'shape') colors.push(element.fill, element.stroke ?? '')
    if (element.type === 'button') colors.push(element.style.background, element.style.color)
    if (element.type === 'input') {
      colors.push(element.style.background, element.style.color, element.style.borderColor ?? '')
    }
    if (element.type === 'runtime-placeholder') colors.push(element.textColor ?? '')
    if (element.shadow?.color) colors.push(element.shadow.color)
  }
  return Array.from(new Set(colors.map(normalizeColor).filter(Boolean))).slice(0, 6)
}

function normalizeColor(value: string) {
  const color = value.trim().toLowerCase()
  if (!color || color === 'transparent') return ''
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color
  if (/^(?:rgb|hsl)a?\([^)]*\)$/i.test(color)) return color
  return ''
}
