import { createRuntimeError } from '../providers.mjs'

export function normalizeComponentBlueprint(input) {
  const source = input && typeof input === 'object' ? input : {}
  const sourceRegions = Array.isArray(source.regions) ? source.regions : []
  const regions = sourceRegions.map((region, index) => {
    const bounds = region?.bounds && typeof region.bounds === 'object' ? region.bounds : {}
    let x = readFiniteNumber(bounds.x)
    let y = readFiniteNumber(bounds.y)
    let width = readFiniteNumber(bounds.width)
    let height = readFiniteNumber(bounds.height)
    if (Number.isFinite(x) && x < 0 && Number.isFinite(width)) {
      width = Math.max(1, width + x)
      x = 0
    }
    if (Number.isFinite(y) && y < 0 && Number.isFinite(height)) {
      height = Math.max(1, height + y)
      y = 0
    }
    return {
      ...region,
      id: typeof region?.id === 'string' && region.id.trim() ? region.id : `region-${index + 1}`,
      role:
        typeof region?.role === 'string' && region.role.trim()
          ? region.role
          : typeof region?.id === 'string' && region.id.trim()
            ? region.id
            : `组件区域 ${index + 1}`,
      content:
        typeof region?.content === 'string' && region.content.trim()
          ? region.content.trim()
          : undefined,
      bounds: { x, y, width, height },
      propBindings: Array.isArray(region?.propBindings)
        ? region.propBindings.filter((item) => typeof item === 'string' && item.trim())
        : [],
      renderMode: ['runtime', 'text', 'color', 'button', 'generated-asset'].includes(
        region?.renderMode,
      )
        ? region.renderMode
        : region?.slotId
          ? 'generated-asset'
          : 'runtime',
      confidence: readFiniteNumber(region?.confidence) ?? (region?.slotId ? 0.8 : 0.5),
      visible: region?.visible !== false,
      styleRole: ['heading', 'body', 'caption', 'button'].includes(region?.styleRole)
        ? region.styleRole
        : undefined,
      textAlign: ['left', 'center', 'right'].includes(region?.textAlign)
        ? region.textAlign
        : undefined,
      preview: normalizeRegionPreview(region?.preview),
    }
  })
  const maxRight = Math.max(
    0,
    ...regions.map((region) =>
      Number.isFinite(region.bounds.x) && Number.isFinite(region.bounds.width)
        ? region.bounds.x + region.bounds.width
        : 0,
    ),
  )
  const maxBottom = Math.max(
    0,
    ...regions.map((region) =>
      Number.isFinite(region.bounds.y) && Number.isFinite(region.bounds.height)
        ? region.bounds.y + region.bounds.height
        : 0,
    ),
  )
  const sourceWidth = readFiniteNumber(source.width)
  const sourceHeight = readFiniteNumber(source.height)
  return {
    ...source,
    version: readFiniteNumber(source.version),
    width: Math.max(Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : 375, maxRight),
    height: Math.max(
      Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : maxBottom,
      maxBottom,
    ),
    visualTheme: normalizeVisualTheme(source.visualTheme),
    regions,
    propertyValues:
      source.propertyValues &&
      typeof source.propertyValues === 'object' &&
      !Array.isArray(source.propertyValues)
        ? source.propertyValues
        : {},
    diagnostics: Array.isArray(source.diagnostics) ? source.diagnostics : [],
  }
}

function normalizeRegionPreview(value) {
  if (!value || typeof value !== 'object') return undefined
  const items = Array.isArray(value.items)
    ? value.items.filter((item) => typeof item === 'string' && item.trim()).slice(0, 12)
    : []
  if (!items.length) return undefined
  return {
    variant: ['cards', 'list', 'plain'].includes(value.variant) ? value.variant : 'plain',
    items,
  }
}

export function normalizeVisualTheme(value) {
  if (!value || typeof value !== 'object') return undefined
  const sourceValue =
    value.visualTheme && typeof value.visualTheme === 'object'
      ? value.visualTheme
      : value.theme && typeof value.theme === 'object'
        ? value.theme
        : value
  const rawColorTokens = normalizeRawColorTokens(sourceValue.colorTokens ?? sourceValue.tokens)
  const rawColors = [
    ...(Array.isArray(sourceValue.colors) ? sourceValue.colors : []),
    ...objectColorValues(sourceValue.colors),
    ...(Array.isArray(sourceValue.palette) ? sourceValue.palette : []),
    ...objectColorValues(sourceValue.palette),
    ...(Array.isArray(sourceValue.dominantColors) ? sourceValue.dominantColors : []),
    ...rawColorTokens.map((token) => token.value),
    sourceValue.primaryColor,
    sourceValue.backgroundColor,
    sourceValue.surfaceColor,
    sourceValue.textColor,
  ].filter((color) => typeof color === 'string' && isCssColor(color))
  const colors = expandThemeColors(Array.from(new Set(rawColors)).slice(0, 8))
  if (!colors.length) return undefined
  const visualStyle =
    firstText(
      sourceValue.visualStyle,
      sourceValue.style,
      sourceValue.mood,
      sourceValue.description,
    ) || 'reference-derived'
  const source = ['kv', 'visual', 'prompt', 'thumbnail', 'style-pack'].includes(sourceValue.source)
    ? sourceValue.source
    : 'prompt'
  const referenceImageIndex = readFiniteNumber(sourceValue.referenceImageIndex)
  const colorTokens = normalizeColorTokens(rawColorTokens, colors)
  return {
    source,
    ...(Number.isFinite(referenceImageIndex) ? { referenceImageIndex } : {}),
    colors,
    colorTokens,
    typography: normalizeTypographyTokens(sourceValue.typography),
    surfaces: normalizeSurfaceTokens(sourceValue.surfaces, colors, colorTokens),
    effects: normalizeEffectTokens(sourceValue.effects),
    imagery: normalizeImageryToken(sourceValue.imagery),
    decoration: normalizeDecorationToken(sourceValue.decoration),
    spacing: normalizeSpacingToken(sourceValue.spacing),
    visualStyle,
    confidence: clamp01(readFiniteNumber(sourceValue.confidence) ?? 0.7),
    ...(normalizeThemeEvidence(sourceValue.evidence)
      ? {
          evidence: normalizeThemeEvidence(sourceValue.evidence),
        }
      : {}),
  }
}

function normalizeThemeEvidence(value) {
  if (!value || typeof value !== 'object') return undefined
  const colors = Array.isArray(value.colors)
    ? value.colors.filter((color) => typeof color === 'string' && isCssColor(color)).slice(0, 8)
    : []
  if (!colors.length) return undefined
  return {
    method: typeof value.method === 'string' ? value.method : 'unknown',
    referenceName: typeof value.referenceName === 'string' ? value.referenceName : undefined,
    colors,
    modelAffinity: clamp01(readFiniteNumber(value.modelAffinity) ?? 0),
    calibrated: value.calibrated === true,
  }
}

function objectColorValues(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return []
  return Object.values(value).map((item) => (typeof item === 'string' ? item : item?.value))
}

function normalizeRawColorTokens(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).map(([role, token]) => ({
    role,
    value: typeof token === 'string' ? token : token?.value,
  }))
}

function expandThemeColors(colors) {
  if (!colors.length) return []
  if (colors.length >= 3) return colors
  const primary = colors[0]
  const rgb = parseHexColor(primary)
  if (!rgb) return colors
  const tint = (amount) =>
    `#${rgb
      .map((channel) =>
        Math.round(channel + (255 - channel) * amount)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`
  const shade = (amount) =>
    `#${rgb
      .map((channel) =>
        Math.round(channel * (1 - amount))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`
  return Array.from(new Set([...colors, tint(0.88), shade(0.68)])).slice(0, 8)
}

function parseHexColor(value) {
  const match = typeof value === 'string' ? value.trim().match(/^#([0-9a-f]{6})$/i) : undefined
  if (!match) return undefined
  const number = Number.parseInt(match[1], 16)
  return [number >> 16, (number >> 8) & 255, number & 255]
}

function firstText(...values) {
  return values.find((item) => typeof item === 'string' && item.trim())?.trim()
}

export function inspectComponentBlueprint(blueprint) {
  const renderModes = new Set(['runtime', 'text', 'color', 'button', 'generated-asset'])
  const issues = []
  if (blueprint?.version !== 1) issues.push('version 必须为 1')
  if (typeof blueprint?.componentName !== 'string' || !blueprint.componentName.trim())
    issues.push('缺少 componentName')
  if (typeof blueprint?.profile !== 'string' || !blueprint.profile.trim())
    issues.push('缺少 profile')
  if (!Number.isFinite(blueprint?.width) || blueprint.width <= 0 || blueprint.width > 1500)
    issues.push('width 必须在 0 到 1500 之间')
  if (!Number.isFinite(blueprint?.height) || blueprint.height <= 0 || blueprint.height > 10000)
    issues.push('height 必须在 0 到 10000 之间')
  if (
    !Array.isArray(blueprint?.regions) ||
    !blueprint.regions.length ||
    blueprint.regions.length > 64
  ) {
    issues.push('regions 数量必须在 1 到 64 之间')
    return issues
  }
  blueprint.regions.forEach((region, index) => {
    const prefix = `regions[${index}]`
    const bounds = region?.bounds
    if (typeof region?.id !== 'string' || !region.id.trim()) issues.push(`${prefix} 缺少 id`)
    if (typeof region?.role !== 'string' || !region.role.trim()) issues.push(`${prefix} 缺少 role`)
    if (!Number.isFinite(bounds?.x) || bounds.x < 0) issues.push(`${prefix}.bounds.x 无效`)
    if (!Number.isFinite(bounds?.y) || bounds.y < 0) issues.push(`${prefix}.bounds.y 无效`)
    if (!Number.isFinite(bounds?.width) || bounds.width <= 0)
      issues.push(`${prefix}.bounds.width 无效`)
    if (!Number.isFinite(bounds?.height) || bounds.height <= 0)
      issues.push(`${prefix}.bounds.height 无效`)
    if (!renderModes.has(region?.renderMode)) issues.push(`${prefix}.renderMode 无效`)
    if (!Number.isFinite(region?.confidence) || region.confidence < 0 || region.confidence > 1) {
      issues.push(`${prefix}.confidence 必须在 0 到 1 之间`)
    }
  })
  return issues
}

function normalizeColorTokens(value, colors) {
  const roles = new Set(['primary', 'secondary', 'background', 'surface', 'text', 'accent'])
  const tokens = Array.isArray(value)
    ? value
        .filter(
          (token) =>
            token &&
            roles.has(token.role) &&
            typeof token.value === 'string' &&
            isCssColor(token.value),
        )
        .slice(0, 12)
        .map((token) => ({ role: token.role, value: token.value }))
    : []
  if (tokens.length) return tokens
  const defaults = ['primary', 'secondary', 'background', 'text', 'accent', 'surface']
  return colors.map((color, index) => ({ role: defaults[index] ?? 'accent', value: color }))
}

function normalizeTypographyTokens(value) {
  const roles = new Set(['display', 'heading', 'body', 'caption', 'button'])
  const tokens = Array.isArray(value)
    ? value
        .filter(
          (token) =>
            token && roles.has(token.role) && Number.isFinite(readFiniteNumber(token.weight)),
        )
        .slice(0, 8)
        .map((token) => ({
          role: token.role,
          ...(typeof token.family === 'string' && token.family.trim()
            ? { family: token.family.trim() }
            : {}),
          weight: Math.max(100, Math.min(900, readFiniteNumber(token.weight))),
          ...(Number.isFinite(readFiniteNumber(token.size))
            ? { size: Math.max(8, readFiniteNumber(token.size)) }
            : {}),
          ...(Number.isFinite(readFiniteNumber(token.lineHeight))
            ? { lineHeight: Math.max(1, readFiniteNumber(token.lineHeight)) }
            : {}),
        }))
    : []
  return tokens.length
    ? tokens
    : [
        { role: 'heading', weight: 700 },
        { role: 'body', weight: 400 },
        { role: 'button', weight: 700 },
      ]
}

function normalizeSurfaceTokens(value, colors, colorTokens) {
  const tokens = Array.isArray(value)
    ? value
        .filter(
          (token) =>
            token &&
            typeof token.role === 'string' &&
            typeof token.fill === 'string' &&
            isCssColor(token.fill),
        )
        .slice(0, 8)
        .map((token) => ({
          role: token.role.trim(),
          fill: token.fill,
          radius: Math.max(0, readFiniteNumber(token.radius) ?? 0),
          ...(typeof token.border === 'string' && isCssColor(token.border)
            ? { border: token.border }
            : {}),
        }))
    : []
  const fallbackFill =
    colorTokens.find((token) => token.role === 'surface')?.value ??
    colorTokens.find((token) => token.role === 'background')?.value ??
    colors[2] ??
    colors[1] ??
    colors[0]
  return tokens.length ? tokens : [{ role: 'component', fill: fallbackFill, radius: 8 }]
}

function normalizeEffectTokens(value) {
  const types = new Set(['shadow', 'glow', 'gradient', 'texture'])
  return Array.isArray(value)
    ? value
        .filter(
          (token) =>
            token && types.has(token.type) && typeof token.value === 'string' && token.value.trim(),
        )
        .slice(0, 12)
        .map((token) => ({ type: token.type, value: token.value.trim() }))
    : []
}

function normalizeImageryToken(value) {
  return {
    style: typeof value?.style === 'string' && value.style.trim() ? value.style.trim() : 'vector',
    rendering:
      typeof value?.rendering === 'string' && value.rendering.trim()
        ? value.rendering.trim()
        : 'flat',
    keywords: Array.isArray(value?.keywords)
      ? value.keywords.filter((item) => typeof item === 'string' && item.trim()).slice(0, 12)
      : [],
  }
}

function normalizeDecorationToken(value) {
  return {
    language:
      typeof value?.language === 'string' && value.language.trim()
        ? value.language.trim()
        : 'minimal',
    motifs: Array.isArray(value?.motifs)
      ? value.motifs.filter((item) => typeof item === 'string' && item.trim()).slice(0, 12)
      : [],
    density: ['low', 'medium', 'high'].includes(value?.density) ? value.density : 'medium',
  }
}

function normalizeSpacingToken(value) {
  const scale = Array.isArray(value?.scale)
    ? value.scale
        .map(readFiniteNumber)
        .filter((item) => Number.isFinite(item) && item > 0)
        .slice(0, 10)
    : []
  return {
    base: Math.max(1, readFiniteNumber(value?.base) ?? 4),
    scale: scale.length ? scale : [4, 8, 12, 16, 24, 32],
    density: ['compact', 'comfortable', 'spacious'].includes(value?.density)
      ? value.density
      : 'comfortable',
  }
}

function readFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function isCssColor(value) {
  return /^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\(|transparent$)/i.test(value.trim())
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}
