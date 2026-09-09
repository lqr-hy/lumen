export interface StylePackSummary {
  id: string
  name: string
  version: string
  description: string
  colors: Record<string, string>
  typography?: Record<string, unknown>
  surfaces?: Record<string, unknown>
  imagery?: Record<string, unknown>
  constraints?: string[]
  prompt?: string
  source: 'built-in' | 'user' | 'browser'
  enabled: boolean
}

const PACKS_KEY = 'lumen-style-packs-v1'
const SELECTED_KEY = 'lumen-selected-style-pack-v1'

export async function listAvailableStylePacks(): Promise<StylePackSummary[]> {
  if (window.lumenRuntime) {
    const state = await window.lumenRuntime.getPublicState()
    return state.stylePacks ?? []
  }
  return readBrowserStylePacks()
}

export function getSelectedStylePackId() {
  return window.localStorage.getItem(SELECTED_KEY) ?? ''
}

export function saveSelectedStylePackId(id: string) {
  if (id) window.localStorage.setItem(SELECTED_KEY, id)
  else window.localStorage.removeItem(SELECTED_KEY)
}

export async function importBrowserStylePack(file: File): Promise<StylePackSummary> {
  const value = JSON.parse(await file.text()) as Record<string, unknown>
  const pack = normalizeBrowserStylePack(value)
  const current = readBrowserStylePacks().filter((item) => item.id !== pack.id)
  window.localStorage.setItem(PACKS_KEY, JSON.stringify([...current, pack]))
  return pack
}

export function setBrowserStylePackEnabled(id: string, enabled: boolean) {
  const packs = readBrowserStylePacks().map((pack) =>
    pack.id === id ? { ...pack, enabled } : pack,
  )
  window.localStorage.setItem(PACKS_KEY, JSON.stringify(packs))
}

export function removeBrowserStylePack(id: string) {
  const packs = readBrowserStylePacks().filter((pack) => pack.id !== id)
  window.localStorage.setItem(PACKS_KEY, JSON.stringify(packs))
  if (getSelectedStylePackId() === id) saveSelectedStylePackId('')
}

export function exportBrowserStylePack(pack: StylePackSummary) {
  const payload = { ...pack, source: undefined, enabled: undefined }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${pack.id}.style.json`
  link.click()
  URL.revokeObjectURL(url)
}

function readBrowserStylePacks(): StylePackSummary[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(PACKS_KEY) || '[]')
    return Array.isArray(value) ? value.map(normalizeBrowserStylePack) : []
  } catch {
    return []
  }
}

function normalizeBrowserStylePack(value: Record<string, unknown>): StylePackSummary {
  const id = String(value.id || '').trim()
  const name = String(value.name || '').trim()
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(id) || !name) {
    throw new Error('Style Pack 的 id 或 name 无效。')
  }
  const colors = Object.fromEntries(
    Object.entries(
      value.colors && typeof value.colors === 'object' && !Array.isArray(value.colors)
        ? value.colors
        : {},
    ).filter(
      ([, color]) =>
        typeof color === 'string' && /^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(color),
    ),
  )
  if (Object.keys(colors).length < 2) throw new Error('Style Pack 至少需要两个有效颜色。')
  return {
    id,
    name,
    version: String(value.version || '1.0.0'),
    description: String(value.description || ''),
    colors: colors as Record<string, string>,
    typography: asObject(value.typography),
    surfaces: asObject(value.surfaces),
    imagery: asObject(value.imagery),
    constraints: Array.isArray(value.constraints)
      ? value.constraints.filter((item): item is string => typeof item === 'string').slice(0, 20)
      : [],
    prompt: String(value.prompt || ''),
    source: value.source === 'built-in' || value.source === 'user' ? value.source : 'browser',
    enabled: value.enabled !== false,
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
