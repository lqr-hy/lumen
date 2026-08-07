const adapters = new Map()

export function registerComponentRuntimeAdapter(adapter) {
  if (!adapter?.id || typeof adapter.supports !== 'function' || typeof adapter.render !== 'function') {
    throw new TypeError('Component Runtime Adapter 必须提供 id、supports 和 render。')
  }
  adapters.set(adapter.id, adapter)
  return () => adapters.delete(adapter.id)
}

export function listComponentRuntimeAdapters() {
  return Array.from(adapters.values()).map((adapter) => ({ id: adapter.id, mode: adapter.mode ?? 'custom' }))
}

export function registerHtmlBundleRuntimeAdapter(options) {
  if (!options?.id || typeof options.supports !== 'function' || typeof options.createHtml !== 'function') {
    throw new TypeError('HTML Bundle Adapter 必须提供 id、supports 和 createHtml。')
  }
  return registerComponentRuntimeAdapter({
    id: options.id,
    mode: 'electron-sandbox',
    supports: options.supports,
    render: (input) => renderHtmlBundleInSandbox(options, input),
  })
}

export async function validateComponentRuntime(input) {
  const adapter = Array.from(adapters.values()).find((candidate) => (
    candidate.supports(input.componentName, input.sourceHash)
  ))
  if (!adapter) {
    return {
      status: 'unsupported',
      consoleErrors: [],
      unknownProps: [],
      missingAssets: [],
      message: `未找到支持 ${input.componentName} / ${input.sourceHash} 的真实组件 Runtime Adapter。`,
    }
  }

  try {
    const result = await adapter.render(input)
    return normalizeRuntimeResult(result, adapter.id, input.designSnapshot)
  } catch (error) {
    return {
      status: 'failed',
      adapterId: adapter.id,
      consoleErrors: [error instanceof Error ? error.message : String(error)],
      unknownProps: [],
      missingAssets: [],
      message: '真实组件 Runtime 渲染失败。',
    }
  }
}

function normalizeRuntimeResult(result, adapterId, designSnapshot) {
  const consoleErrors = stringArray(result?.consoleErrors)
  const unknownProps = stringArray(result?.unknownProps)
  const missingAssets = stringArray(result?.missingAssets)
  const failed = result?.status === 'failed' || consoleErrors.length || missingAssets.length
  const comparison = designSnapshot && result?.layout
    ? compareRuntimeLayout(designSnapshot, result.layout, result.appliedProps)
    : undefined
  return {
    status: failed ? 'failed' : 'passed',
    adapterId,
    ...(typeof result?.screenshot === 'string' ? { screenshot: result.screenshot } : {}),
    consoleErrors,
    unknownProps,
    missingAssets,
    ...(comparison ? { comparison } : {}),
    message: typeof result?.message === 'string' && result.message.trim()
      ? result.message
      : failed
        ? '组件 Runtime 验证发现错误。'
        : '组件 Runtime 验证通过。',
  }
}

export function compareRuntimeLayout(design, runtime, appliedProps = []) {
  const size = dimensionSimilarity(design, runtime)
  const designRegions = Array.isArray(design?.regions) ? design.regions : []
  const runtimeRegions = new Map(
    (Array.isArray(runtime?.regions) ? runtime.regions : []).map((region) => [region.id, region.bounds]),
  )
  const regionScores = designRegions.map((region) => rectangleSimilarity(
    region.bounds,
    runtimeRegions.get(region.id),
  ))
  const structure = regionScores.length
    ? regionScores.reduce((total, score) => total + score, 0) / regionScores.length
    : 0
  const expectedProps = Array.isArray(design?.propPaths) ? design.propPaths : []
  const applied = new Set(Array.isArray(appliedProps) ? appliedProps : [])
  const props = expectedProps.length
    ? expectedProps.filter((path) => applied.has(path)).length / expectedProps.length
    : 1
  const issues = []
  if (size < 0.9) issues.push('Runtime 尺寸与设计稿明显不一致。')
  if (structure < 0.8) issues.push('Runtime Region 布局与设计稿不一致。')
  if (props < 1) issues.push('部分 Props Patch 未在 Runtime 中生效。')
  return {
    passed: !issues.length,
    scores: { size: round(size), structure: round(structure), props: round(props) },
    issues,
  }
}

function dimensionSimilarity(design, runtime) {
  if (!design?.width || !design?.height || !runtime?.width || !runtime?.height) return 0
  return Math.min(design.width, runtime.width) / Math.max(design.width, runtime.width) *
    Math.min(design.height, runtime.height) / Math.max(design.height, runtime.height)
}

function rectangleSimilarity(left, right) {
  if (!left || !right) return 0
  const intersectionWidth = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x))
  const intersectionHeight = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y))
  const intersection = intersectionWidth * intersectionHeight
  const union = left.width * left.height + right.width * right.height - intersection
  return union > 0 ? intersection / union : 0
}

function round(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
}

async function renderHtmlBundleInSandbox(options, input) {
  const { BrowserWindow } = await import('electron')
  const width = Math.max(1, Math.round(input.designSnapshot?.width || options.width || 375))
  const height = Math.max(1, Math.round(input.designSnapshot?.height || options.height || 812))
  const window = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  const consoleErrors = []
  window.webContents.on('console-message', (_event, details) => {
    if (details.level === 'error') consoleErrors.push(details.message)
  })
  try {
    const html = await options.createHtml(input)
    if (typeof html !== 'string' || !html.includes('<')) throw new Error('Adapter 没有返回有效 HTML。')
    await withSandboxTimeout(
      window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`),
      options.timeoutMs ?? 15_000,
    )
    const runtime = await window.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('[data-component-root]') || document.body
      const bounds = root.getBoundingClientRect()
      return {
        ...(window.__COMPONENT_RUNTIME_RESULT__ || {}),
        layout: window.__COMPONENT_RUNTIME_RESULT__?.layout || {
          width: bounds.width,
          height: bounds.height,
          regions: Array.from(document.querySelectorAll('[data-region-id]')).map((element) => {
            const rect = element.getBoundingClientRect()
            return { id: element.dataset.regionId, bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
          }),
        },
      }
    })()`)
    const screenshot = (await window.webContents.capturePage()).toDataURL()
    return {
      ...runtime,
      screenshot,
      consoleErrors: [...consoleErrors, ...stringArray(runtime.consoleErrors)],
      status: consoleErrors.length ? 'failed' : runtime.status,
      message: runtime.message || 'Electron Sandbox 已完成真实组件渲染。',
    }
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}

function withSandboxTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`组件 Sandbox 超过 ${timeoutMs}ms。`)), timeoutMs)),
  ])
}
