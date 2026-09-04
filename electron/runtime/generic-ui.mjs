import { createRuntimeError } from './providers.mjs'
import { DESIGN_BLOCK_REGISTRY, isRegisteredDesignBlock } from './design-block-registry.mjs'
import { resolveSurfacePreset, SURFACE_PRESETS } from './surface-presets.mjs'
const DEFAULT_BREAKPOINTS = [
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

export function normalizeGenericUiSchema(input, goal = '', options = {}) {
  const source = input && typeof input === 'object' ? input : {}
  const surfaceKind = Object.hasOwn(SURFACE_PRESETS, options.surfaceKind)
    ? options.surfaceKind
    : Object.hasOwn(SURFACE_PRESETS, source.surfaceKind)
      ? source.surfaceKind
      : inferSurfaceKind(goal)
  const preset = resolveSurfacePreset(surfaceKind, source.viewport)
  const blocks = Array.isArray(source.blocks)
    ? normalizeStructuralBlocks(
        ensureUniqueBlockIds(source.blocks.map(normalizeDesignBlock).filter(Boolean).slice(0, 24)),
      )
    : []
  const colors = Array.isArray(source.theme?.colors)
    ? source.theme.colors.filter(isCssColor).slice(0, 8)
    : []
  const schema = {
    version: 1,
    surfaceKind,
    title: cleanText(source.title, cleanText(goal, 'AI 设计稿')).slice(0, 80),
    viewport: {
      width: preset.width,
      height: preset.height,
    },
    theme: {
      mode: source.theme?.mode === 'dark' ? 'dark' : 'light',
      colors: colors.length >= 3 ? colors : defaultColors(source.theme?.mode),
      radius: clamp(finiteNumber(source.theme?.radius) ?? 6, 0, 16),
      density: ['compact', 'comfortable'].includes(source.theme?.density)
        ? source.theme.density
        : 'comfortable',
    },
    responsive: normalizeResponsive(source.responsive),
    designArchetype: optionalText(source.designArchetype || options.designArchetype),
    blocks,
  }
  return applyVisualThemeToDesignSpec(schema, options.visualTheme)
}

export function applyVisualThemeToDesignSpec(schema, visualTheme) {
  if (!schema || !visualTheme || typeof visualTheme !== 'object') return schema
  const sourceColors = Array.isArray(visualTheme.colors)
    ? visualTheme.colors.filter(isCssColor).slice(0, 8)
    : []
  if (!sourceColors.length) return schema

  const tokens = new Map(
    (Array.isArray(visualTheme.colorTokens) ? visualTheme.colorTokens : [])
      .filter((token) => token && typeof token.role === 'string' && isCssColor(token.value))
      .map((token) => [token.role, token.value]),
  )
  const surfaceTokens = Array.isArray(visualTheme.surfaces) ? visualTheme.surfaces : []
  const surfaceToken = surfaceTokens.find((token) => token?.role === 'surface') ?? surfaceTokens[0]
  const primary = tokens.get('primary') ?? sourceColors[0]
  const background =
    tokens.get('background') ?? findLightColor(sourceColors) ?? tintColor(primary, 0.9)
  const surface = tokens.get('surface') ?? surfaceToken?.fill ?? tintColor(background, 0.45)
  const text = tokens.get('text') ?? findDarkColor(sourceColors) ?? '#182230'
  const border = surfaceToken?.border ?? tokens.get('secondary') ?? tintColor(primary, 0.68)
  const radius = surfaceTokens
    .map((token) => finiteNumber(token?.radius))
    .find((value) => Number.isFinite(value))
  const density = visualTheme.spacing?.density === 'compact' ? 'compact' : schema.theme.density

  return {
    ...schema,
    theme: {
      ...schema.theme,
      colors: [
        surface,
        background,
        text,
        primary,
        border,
        ...sourceColors.filter(
          (color) => ![surface, background, text, primary, border].includes(color),
        ),
      ]
        .filter(isCssColor)
        .slice(0, 8),
      ...(Number.isFinite(radius) ? { radius: clamp(radius, 0, 16) } : {}),
      density,
    },
  }
}

export function genericUiLogicalSize(surfaceKind) {
  const preset = resolveSurfacePreset(surfaceKind)
  return { width: preset.width, initialHeight: preset.height, autoHeight: preset.autoHeight }
}

export function inspectGenericUiSchema(schema) {
  const issues = []
  if (schema?.version !== 1) issues.push('version 必须为 1')
  if (!Object.hasOwn(SURFACE_PRESETS, schema?.surfaceKind)) issues.push('surfaceKind 无效')
  if (!Number.isFinite(schema?.viewport?.width) || !Number.isFinite(schema?.viewport?.height)) {
    issues.push('viewport 无效')
  }
  if (!Array.isArray(schema?.blocks) || !schema.blocks.length) issues.push('缺少 UI Block')
  for (const block of schema?.blocks ?? []) {
    if (!isRegisteredDesignBlock(block.kind)) issues.push(`不支持的 UI Block：${block.kind}`)
  }
  for (const kind of ['sidebar', 'header', 'footer']) {
    if ((schema?.blocks ?? []).filter((block) => block.kind === kind).length > 1) {
      issues.push(`全局结构 Block ${kind} 只能出现一次`)
    }
  }
  return issues
}

export function assertGenericUiSchema(schema) {
  const issues = inspectGenericUiSchema(schema)
  if (issues.length) {
    throw createRuntimeError(
      'GENERIC_UI_SCHEMA_INVALID',
      `通用 UI Schema 无效：${issues.join('；')}`,
    )
  }
  return schema
}

export function normalizeDesignBlock(value, index = 0) {
  if (!value || !isRegisteredDesignBlock(value.kind)) return undefined
  return {
    id: cleanText(value.id, `block-${index + 1}`).replace(/[^a-z0-9_-]+/gi, '-'),
    kind: value.kind,
    label: cleanText(value.label, blockLabel(value.kind)),
    title: optionalText(value.title),
    items: stringArray(value.items, 12),
    fields: stringArray(value.fields, 12),
    actions: stringArray(value.actions, 8),
    columns: stringArray(value.columns, 12),
    rows: Array.isArray(value.rows)
      ? value.rows.slice(0, 10).map((row) => stringArray(row, 12))
      : [],
    children: Array.isArray(value.children)
      ? ensureUniqueBlockIds(
          value.children
            .slice(0, 12)
            .map((child, childIndex) => normalizeDesignBlock(child, childIndex))
            .filter(Boolean),
        )
      : [],
    media:
      value.media && typeof value.media === 'object'
        ? { src: optionalText(value.media.src), alt: optionalText(value.media.alt) }
        : undefined,
    layout: normalizeBlockLayout(value.layout),
  }
}

function normalizeBlockLayout(value) {
  if (!value || typeof value !== 'object') return undefined
  return {
    direction: ['horizontal', 'vertical'].includes(value.direction) ? value.direction : undefined,
    columns: Number.isFinite(value.columns) ? clamp(Math.round(value.columns), 1, 12) : undefined,
    gap: Number.isFinite(value.gap) ? clamp(value.gap, 0, 64) : undefined,
    padding: Number.isFinite(value.padding) ? clamp(value.padding, 0, 96) : undefined,
    height: Number.isFinite(value.height) ? clamp(value.height, 1, 4000) : undefined,
  }
}

function ensureUniqueBlockIds(blocks) {
  const counts = new Map()
  return blocks.map((block) => {
    const count = counts.get(block.id) ?? 0
    counts.set(block.id, count + 1)
    return count === 0 ? block : { ...block, id: `${block.id}-${count + 1}` }
  })
}

function normalizeStructuralBlocks(blocks) {
  const seen = new Set()
  return blocks.map((block) => {
    if (!['sidebar', 'header', 'footer'].includes(block.kind)) return block
    if (!seen.has(block.kind)) {
      seen.add(block.kind)
      return block
    }
    if (block.kind === 'header') return { ...block, kind: 'section-header' }
    if (block.kind === 'sidebar') return { ...block, kind: 'content-grid' }
    return { ...block, kind: 'text' }
  })
}

function inferSurfaceKind(goal) {
  void goal
  return 'desktop-web'
}

function inferTitle(goal) {
  const clean = String(goal || '')
    .replace(/(?:请|帮我|生成|设计|创建|制作|一个|一套|页面|界面|ui|UI|设计稿)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.slice(0, 32) || '数据管理'
}

function blockLabel(kind) {
  return DESIGN_BLOCK_REGISTRY[kind]?.label || kind
}

function defaultColors(mode) {
  return mode === 'dark'
    ? ['#111827', '#1f2937', '#f9fafb', '#60a5fa', '#374151']
    : ['#ffffff', '#f5f7fa', '#182230', '#2563eb', '#d9dee8']
}

function findLightColor(colors) {
  return colors
    .map((color) => ({ color, luminance: colorLuminance(color) }))
    .filter((item) => Number.isFinite(item.luminance) && item.luminance >= 0.72)
    .sort((a, b) => b.luminance - a.luminance)[0]?.color
}

function findDarkColor(colors) {
  return colors
    .map((color) => ({ color, luminance: colorLuminance(color) }))
    .filter((item) => Number.isFinite(item.luminance) && item.luminance <= 0.38)
    .sort((a, b) => a.luminance - b.luminance)[0]?.color
}

function colorLuminance(color) {
  const rgb = parseHexColor(color)
  if (!rgb) return undefined
  const channels = rgb.map((value) => {
    const normalized = value / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function tintColor(color, amount) {
  const rgb = parseHexColor(color)
  if (!rgb) return color
  const mixed = rgb.map((value) => Math.round(value + (255 - value) * amount))
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function parseHexColor(color) {
  const match = typeof color === 'string' ? color.trim().match(/^#([0-9a-f]{6})$/i) : undefined
  if (!match) return undefined
  const value = Number.parseInt(match[1], 16)
  return [value >> 16, (value >> 8) & 255, value & 255]
}

function normalizeResponsive(value) {
  const source = Array.isArray(value?.breakpoints) ? value.breakpoints : []
  const builtInBreakpoints = DEFAULT_BREAKPOINTS.map((fallback) => {
    const item = source.find((candidate) => candidate?.id === fallback.id)
    if (!item) return { ...fallback, viewport: { ...fallback.viewport } }
    return {
      ...fallback,
      label: cleanText(item.label, fallback.label).slice(0, 40),
      viewport: {
        width: clamp(finitePositive(item.viewport?.width) || fallback.viewport.width, 320, 2560),
        height: clamp(
          finitePositive(item.viewport?.height) || fallback.viewport.height,
          320,
          10000,
        ),
      },
      ...(normalizeBreakpointOverrides(item.overrides)
        ? { overrides: normalizeBreakpointOverrides(item.overrides) }
        : {}),
    }
  })
  const builtInIds = new Set(DEFAULT_BREAKPOINTS.map((item) => item.id))
  const customBreakpoints = source
    .filter((item) => item && typeof item.id === 'string' && !builtInIds.has(item.id))
    .slice(0, 8)
    .map((item, index) => ({
      id: cleanBreakpointId(item.id, index),
      label: cleanText(item.label, `自定义 ${index + 1}`).slice(0, 40),
      viewport: {
        width: clamp(finitePositive(item.viewport?.width) || 1280, 320, 2560),
        height: clamp(finitePositive(item.viewport?.height) || 900, 320, 10000),
      },
      ...(normalizeBreakpointOverrides(item.overrides)
        ? { overrides: normalizeBreakpointOverrides(item.overrides) }
        : {}),
      ...(finitePositive(item.minWidth) ? { minWidth: clamp(item.minWidth, 0, 2560) } : {}),
      ...(finitePositive(item.maxWidth) ? { maxWidth: clamp(item.maxWidth, 320, 2560) } : {}),
    }))
    .filter(
      (item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index,
    )
  return { strategy: 'fluid', breakpoints: [...builtInBreakpoints, ...customBreakpoints] }
}

function normalizeBreakpointOverrides(value) {
  if (!value || typeof value !== 'object') return undefined
  const theme =
    value.theme && typeof value.theme === 'object'
      ? {
          ...(Array.isArray(value.theme.colors)
            ? { colors: value.theme.colors.filter(isCssColor).slice(0, 8) }
            : {}),
          ...(Number.isFinite(Number(value.theme.radius))
            ? { radius: clamp(Number(value.theme.radius), 0, 32) }
            : {}),
          ...(['compact', 'comfortable'].includes(value.theme.density)
            ? { density: value.theme.density }
            : {}),
          ...(['light', 'dark'].includes(value.theme.mode) ? { mode: value.theme.mode } : {}),
        }
      : {}
  const layoutSource = value.layout && typeof value.layout === 'object' ? value.layout : {}
  const layout = {
    ...(Number.isFinite(Number(layoutSource.contentPadding))
      ? { contentPadding: clamp(Number(layoutSource.contentPadding), 0, 96) }
      : {}),
    ...(Number.isFinite(Number(layoutSource.blockGap))
      ? { blockGap: clamp(Number(layoutSource.blockGap), 0, 64) }
      : {}),
    ...(['auto', 'expanded', 'collapsed'].includes(layoutSource.sidebarMode)
      ? { sidebarMode: layoutSource.sidebarMode }
      : {}),
    ...(Array.isArray(layoutSource.hiddenBlockIds)
      ? {
          hiddenBlockIds: layoutSource.hiddenBlockIds
            .filter((item) => typeof item === 'string')
            .slice(0, 24),
        }
      : {}),
    ...(layoutSource.blockColumns && typeof layoutSource.blockColumns === 'object'
      ? {
          blockColumns: Object.fromEntries(
            Object.entries(layoutSource.blockColumns)
              .filter(([, count]) => Number.isFinite(Number(count)))
              .slice(0, 24)
              .map(([id, count]) => [id, clamp(Math.round(Number(count)), 1, 12)]),
          ),
        }
      : {}),
  }
  return Object.keys(theme).length || Object.keys(layout).length
    ? {
        ...(Object.keys(theme).length ? { theme } : {}),
        ...(Object.keys(layout).length ? { layout } : {}),
      }
    : undefined
}

function cleanBreakpointId(value, index) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return normalized || `custom-${index + 1}`
}

function stringArray(value, limit) {
  return Array.isArray(value)
    ? value
        .filter((item) => typeof item === 'string' && item.trim())
        .map((item) => item.trim())
        .slice(0, limit)
    : []
}

function cleanText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function finitePositive(value) {
  const number = finiteNumber(value)
  return number > 0 ? number : undefined
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function isCssColor(value) {
  return typeof value === 'string' && /^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(value.trim())
}
