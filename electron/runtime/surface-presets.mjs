export const SURFACE_PRESETS = Object.freeze({
  'desktop-admin': Object.freeze({ width: 1440, height: 900, autoHeight: false }),
  'desktop-web': Object.freeze({ width: 1440, height: 960, autoHeight: true }),
  mobile: Object.freeze({ width: 375, height: 812, autoHeight: true }),
})

export function resolveSurfacePreset(surfaceKind = 'desktop-web', viewport) {
  const kind = Object.hasOwn(SURFACE_PRESETS, surfaceKind) ? surfaceKind : 'desktop-web'
  const preset = SURFACE_PRESETS[kind]
  const width = finitePositive(viewport?.width) || preset.width
  const height = finitePositive(viewport?.height) || preset.height
  return { kind, width, height: Math.max(preset.height, height), autoHeight: preset.autoHeight }
}

function finitePositive(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}
