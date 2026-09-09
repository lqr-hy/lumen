const zoomGuardOptions: AddEventListenerOptions = { passive: false, capture: true }
const cleanupKey = '__lumenZoomGuardCleanup__'

declare global {
  interface Window {
    [cleanupKey]?: () => void
  }
}

function isEditingPage() {
  return Boolean(globalThis.document?.querySelector('.editor-page'))
}

function preventBrowserZoom(event: Event) {
  if (event.cancelable) event.preventDefault()
}

function onKeyboard(event: KeyboardEvent) {
  if (!isEditingPage()) return

  if ((event.metaKey || event.ctrlKey) && ['+', '=', '-', '_', '0'].includes(event.key)) {
    preventBrowserZoom(event)
  }
}

function syncVisualViewportScale() {
  const visualViewport = globalThis.visualViewport
  const scale = visualViewport?.scale ?? 1
  const normalizedScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  const isZoomed = Math.abs(normalizedScale - 1) > 0.01
  const root = globalThis.document?.documentElement
  if (!root) return

  root.style.setProperty('--browser-visual-scale', String(normalizedScale))
  root.style.setProperty('--browser-visual-inverse-scale', String(1 / normalizedScale))
  root.classList.toggle('browser-visual-zoomed', isZoomed)
}

export function installBrowserZoomGuard() {
  window[cleanupKey]?.()

  window.addEventListener('keydown', onKeyboard, zoomGuardOptions)

  syncVisualViewportScale()
  globalThis.visualViewport?.addEventListener('resize', syncVisualViewportScale)
  globalThis.visualViewport?.addEventListener('scroll', syncVisualViewportScale)

  window[cleanupKey] = () => {
    window.removeEventListener('keydown', onKeyboard, zoomGuardOptions)
    globalThis.visualViewport?.removeEventListener('resize', syncVisualViewportScale)
    globalThis.visualViewport?.removeEventListener('scroll', syncVisualViewportScale)
  }
}
