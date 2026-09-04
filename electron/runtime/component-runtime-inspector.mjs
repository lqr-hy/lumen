import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const bundleCache = new Map()
const MAX_SCRIPT_BYTES = 4 * 1024 * 1024
const MAX_STYLE_BYTES = 2 * 1024 * 1024
const MAX_RUNTIME_IMAGE_BYTES = 6 * 1024 * 1024
const MAX_STATIC_HTML_BYTES = 512 * 1024
const MAX_STATIC_CSS_BYTES = 512 * 1024
const DEFAULT_TIMEOUT_MS = 12_000

export async function inspectRemoteComponentRuntime(input, options = {}) {
  const component = input?.component
  if (!component?.componentJs || !component?.componentCss) {
    return unsupported('组件没有声明 componentJs/componentCss。')
  }
  return inspectRuntimeDomSource(
    {
      id: component.name,
      name: component.name,
      framework: component.framework,
      scriptUrl: component.componentJs,
      styleUrl: component.componentCss,
      props: extractDefaultProps(component),
      width: input.width,
      height: input.height,
    },
    options,
  )
}

export async function inspectRuntimeDomSource(input, options = {}) {
  if (!input?.scriptUrl || !input?.styleUrl) {
    return unsupported('Runtime Source 没有声明 scriptUrl/styleUrl。')
  }
  const framework = normalizeFramework(input.framework)
  if (!['vue2', 'react18', 'react19'].includes(framework))
    return unsupported(`暂不支持 Runtime 框架：${input.framework || 'unknown'}。`)
  if (!process.versions.electron)
    return unsupported('Runtime DOM Inspect 仅在 Electron 应用中执行。')

  const componentJs = assertPublicHttpsUrl(input.scriptUrl, 'scriptUrl')
  const componentCss = assertPublicHttpsUrl(input.styleUrl, 'styleUrl')
  const timeoutMs = clamp(options.timeoutMs, DEFAULT_TIMEOUT_MS, 3_000, 30_000)
  try {
    const [bundle, style, frameworkRuntime] = await Promise.all([
      fetchTextAsset(componentJs, MAX_SCRIPT_BYTES, timeoutMs),
      fetchTextAsset(componentCss, MAX_STYLE_BYTES, timeoutMs),
      loadFrameworkRuntime(framework),
    ])
    const rendered = await renderRemoteComponent({
      source: input,
      framework,
      bundle,
      style,
      frameworkRuntime,
      width: clamp(input.width, 375, 1, 1500),
      height: clamp(input.height, 812, 1, 10_000),
      timeoutMs,
      capturePath: options.capturePath,
    })
    if (!rendered?.designTree) return rendered
    return {
      ...rendered,
      designTree: await inlineRuntimeImageSources(rendered.designTree, { timeoutMs }),
    }
  } catch (error) {
    return {
      status: 'failed',
      designTree: undefined,
      diagnostics: [
        {
          code: 'RUNTIME_INSPECT_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    }
  }
}

export async function inspectStaticHtmlRuntime(input, options = {}) {
  if (!process.versions.electron)
    return unsupported('Static HTML Runtime Inspect 仅在 Electron 应用中执行。')
  const { html, css } = validateStaticUiRuntimeDraft(input)
  const width = clamp(input?.width, 1440, 320, 2560)
  const height = clamp(input?.height, 960, 320, 10_000)
  const timeoutMs = clamp(options.timeoutMs, DEFAULT_TIMEOUT_MS, 3_000, 30_000)
  const name = String(input?.name || 'AI Runtime UI').slice(0, 120)
  return renderStaticInspector({
    name,
    html,
    css,
    width,
    height,
    timeoutMs,
    capturePath: options.capturePath,
    captureSnapshot: options.captureSnapshot !== false,
  })
}

export function validateStaticUiRuntimeDraft(input) {
  return {
    html: assertSafeStaticSource(input?.html, 'html', MAX_STATIC_HTML_BYTES),
    css: assertSafeStaticSource(input?.css, 'css', MAX_STATIC_CSS_BYTES),
  }
}

export async function createRemoteComponentInspectorDocument(component, options = {}) {
  if (!component?.componentJs || !component?.componentCss)
    throw new Error('组件没有声明 componentJs/componentCss。')
  const framework = normalizeFramework(component.framework)
  if (!['vue2', 'react18', 'react19'].includes(framework))
    throw new Error(`暂不支持 Runtime 框架：${component.framework || 'unknown'}。`)
  const timeoutMs = clamp(options.timeoutMs, DEFAULT_TIMEOUT_MS, 3_000, 30_000)
  const [bundle, style, frameworkRuntime] = await Promise.all([
    fetchTextAsset(
      assertPublicHttpsUrl(component.componentJs, 'componentJs'),
      MAX_SCRIPT_BYTES,
      timeoutMs,
    ),
    fetchTextAsset(
      assertPublicHttpsUrl(component.componentCss, 'componentCss'),
      MAX_STYLE_BYTES,
      timeoutMs,
    ),
    loadFrameworkRuntime(framework),
  ])
  return createInspectorHtml({
    componentName: component.name,
    framework,
    frameworkRuntime,
    bundle,
    style,
    props: extractDefaultProps(component),
    width: clamp(options.width, 375, 1, 1500),
  })
}

export async function inlineRuntimeImageSources(designTree, options = {}) {
  if (!designTree?.nodes?.length) return designTree
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = clamp(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 30_000)
  const sources = Array.from(
    new Set(
      designTree.nodes
        .map((node) => node.assetSource)
        .filter((source) => typeof source === 'string' && isPublicHttpsUrl(source)),
    ),
  ).slice(0, 24)
  const entries = await Promise.all(
    sources.map(async (source) => {
      try {
        const asset = await fetchBinaryImageAsset(
          source,
          MAX_RUNTIME_IMAGE_BYTES,
          timeoutMs,
          fetchImpl,
        )
        return [source, asset]
      } catch {
        return [source, undefined]
      }
    }),
  )
  const inlined = new Map(entries.filter((entry) => entry[1]))
  return {
    ...designTree,
    nodes: designTree.nodes.map((node) => ({
      ...node,
      ...(inlined.has(node.assetSource) ? { assetSource: inlined.get(node.assetSource) } : {}),
    })),
    diagnostics: [
      ...(designTree.diagnostics ?? []),
      ...(sources.length > inlined.size
        ? [
            {
              code: 'RUNTIME_IMAGE_INLINE_PARTIAL',
              message: `${sources.length - inlined.size} 个 Runtime 远程图片未能内联，将保留原地址。`,
            },
          ]
        : []),
    ],
  }
}

async function renderRemoteComponent({
  source,
  framework,
  bundle,
  style,
  frameworkRuntime,
  width,
  height,
  timeoutMs,
  capturePath,
}) {
  const { BrowserWindow, session } = await import('electron')
  if (typeof BrowserWindow !== 'function' || !session?.fromPartition)
    return unsupported('Electron Sandbox 不可用。')
  const partition = `runtime-inspect-${crypto.randomUUID()}`
  const sandboxSession = session.fromPartition(partition, { cache: false })
  sandboxSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const staticResource = ['image', 'media', 'font'].includes(details.resourceType)
    callback({ cancel: !staticResource || !isPublicHttpsUrl(details.url) })
  })
  const window = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    webPreferences: {
      session: sandboxSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })
  let documentDirectory
  let documentUrl
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!documentUrl || String(url) !== documentUrl) event.preventDefault()
  })
  const consoleErrors = []
  window.webContents.on('console-message', (_event, details, legacyMessage) => {
    const level = typeof details === 'object' ? details?.level : details
    const message = typeof details === 'object' ? details?.message : legacyMessage
    if (level === 'error' || level === 3) consoleErrors.push(String(message).slice(0, 500))
  })
  try {
    const html = createInspectorHtml({
      componentName: source.name,
      framework,
      frameworkRuntime,
      bundle,
      style,
      props: source.props ?? {},
      width,
    })
    documentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'component-runtime-inspector-'))
    const documentPath = path.join(documentDirectory, 'index.html')
    documentUrl = pathToFileURL(documentPath).href
    await fs.writeFile(documentPath, html, { encoding: 'utf8', mode: 0o600 })
    await withTimeout(window.loadFile(documentPath), timeoutMs)
    await withTimeout(waitForRuntime(window.webContents), timeoutMs)
    await withTimeout(waitForVisualStability(window.webContents), timeoutMs)
    const designTree = await window.webContents.executeJavaScript(
      createDomTreeExtractionScript(source.name, width, height),
    )
    if (!designTree?.nodes?.length) throw new Error('组件 Runtime 没有生成可见 DOM 节点。')
    const snapshot = await captureRuntimeSnapshot(window, designTree, source.name)
    if (capturePath) {
      await fs.mkdir(path.dirname(capturePath), { recursive: true })
      await fs.writeFile(capturePath, snapshot.buffer)
    }
    return {
      status: consoleErrors.length ? 'partial' : 'passed',
      designTree,
      runtimeSnapshot: snapshot.upload,
      consoleErrors,
      diagnostics: consoleErrors.map((message) => ({ code: 'RUNTIME_CONSOLE_ERROR', message })),
    }
  } catch (error) {
    if (capturePath && !window.isDestroyed()) await captureRuntimePage(window, capturePath)
    const message = error instanceof Error ? error.message : String(error)
    return {
      status: 'failed',
      designTree: undefined,
      consoleErrors,
      diagnostics: [
        { code: 'RUNTIME_RENDER_FAILED', message },
        ...consoleErrors.map((item) => ({ code: 'RUNTIME_CONSOLE_ERROR', message: item })),
      ],
    }
  } finally {
    if (!window.isDestroyed()) window.destroy()
    if (documentDirectory) await fs.rm(documentDirectory, { recursive: true, force: true })
  }
}

async function renderStaticInspector({
  name,
  html,
  css,
  width,
  height,
  timeoutMs,
  capturePath,
  captureSnapshot,
}) {
  const { BrowserWindow, session } = await import('electron')
  if (typeof BrowserWindow !== 'function' || !session?.fromPartition)
    return unsupported('Electron Sandbox 不可用。')
  const partition = `runtime-ui-${crypto.randomUUID()}`
  const sandboxSession = session.fromPartition(partition, { cache: false })
  sandboxSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    const staticResource = ['image', 'media', 'font'].includes(details.resourceType)
    callback({ cancel: !staticResource || !isPublicHttpsUrl(details.url) })
  })
  const window = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    webPreferences: {
      session: sandboxSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })
  let documentDirectory
  let documentUrl
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!documentUrl || String(url) !== documentUrl) event.preventDefault()
  })
  try {
    documentDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'generic-ui-runtime-'))
    const documentPath = path.join(documentDirectory, 'index.html')
    documentUrl = pathToFileURL(documentPath).href
    await fs.writeFile(documentPath, createStaticHtmlDocument(width, html, css), {
      encoding: 'utf8',
      mode: 0o600,
    })
    await withTimeout(window.loadFile(documentPath), timeoutMs)
    await withTimeout(waitForVisualStability(window.webContents), timeoutMs)
    await withTimeout(
      window.webContents.executeJavaScript(
        'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      ),
      timeoutMs,
    )
    const designTree = await withTimeout(
      window.webContents.executeJavaScript(createDomTreeExtractionScript(name, width, height)),
      timeoutMs,
    )
    if (!designTree?.nodes?.length) throw new Error('Runtime Draft 没有生成可见 DOM 节点。')
    const snapshot =
      captureSnapshot || capturePath
        ? await withTimeout(captureRuntimeSnapshot(window, designTree, name), timeoutMs)
        : undefined
    if (capturePath && snapshot) {
      await fs.mkdir(path.dirname(capturePath), { recursive: true })
      await fs.writeFile(capturePath, snapshot.buffer)
    }
    return {
      status: 'passed',
      designTree,
      runtimeSnapshot: snapshot?.upload,
      consoleErrors: [],
      diagnostics: [],
    }
  } catch (error) {
    return {
      status: 'failed',
      designTree: undefined,
      diagnostics: [
        {
          code: 'STATIC_RUNTIME_RENDER_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    }
  } finally {
    if (!window.isDestroyed()) window.destroy()
    if (documentDirectory) await fs.rm(documentDirectory, { recursive: true, force: true })
  }
}

async function captureRuntimePage(window, capturePath) {
  const image = await window.webContents.capturePage()
  await fs.mkdir(path.dirname(capturePath), { recursive: true })
  await fs.writeFile(capturePath, image.toPNG())
}

async function captureRuntimeSnapshot(window, designTree, componentName) {
  const width = Math.max(1, Math.ceil(Math.min(designTree.width || 375, 1500)))
  const height = Math.max(1, Math.ceil(Math.min(designTree.height || 812, 10000)))
  const image = await window.webContents.capturePage({ x: 0, y: 0, width, height })
  const buffer = image.toPNG()
  return {
    buffer,
    upload: {
      type: 'file',
      name: `${componentName || 'component'}-runtime.png`,
      mime: 'image/png',
      role: 'prototype',
      data: `data:image/png;base64,${buffer.toString('base64')}`,
    },
  }
}

async function waitForVisualStability(webContents) {
  // 采集前统一缩放，并等待字体、图片解码和两帧布局完成，避免首次渲染的
  // fallback 字体/未解码图片把真实 DOM 的尺寸传成错误值。
  await webContents.setZoomFactor(1)
  await webContents.executeJavaScript(`(async()=>{
    if (document.fonts?.ready) await document.fonts.ready.catch(()=>{})
    const images = Array.from(document.images || [])
    await Promise.all(images.map((image) => image.decode ? image.decode().catch(()=>{}) : Promise.resolve()))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })()`)
}

function createInspectorHtml(input) {
  return input.framework.startsWith('react')
    ? createReactInspectorHtml(input)
    : createVue2InspectorHtml(input)
}

function createVue2InspectorHtml({ componentName, frameworkRuntime, bundle, style, props, width }) {
  const safeName = JSON.stringify(componentName)
  const safeProps = JSON.stringify(props).replaceAll('<', '\\u003c')
  const remValue = resolveInspectorRemValue(width)
  return createHtmlDocument(width, style, [
    frameworkRuntime.vue,
    `window.$eva=window.$eva||{inExample:true,remBase:${remValue},remValue:${remValue}}`,
    bundle,
    `(()=>{const name=${safeName};const component=window[name];if(!component)throw new Error('组件 Bundle 未导出全局 '+name);const props=${safeProps};new window.Vue({render:h=>h(component,{props})}).$mount('#app');window.Vue.nextTick(()=>{window.__RUNTIME_INSPECT_READY__=true})})()`,
  ])
}

function createReactInspectorHtml({
  componentName,
  frameworkRuntime,
  bundle,
  style,
  props,
  width,
}) {
  const safeName = JSON.stringify(componentName)
  const safeProps = JSON.stringify(props).replaceAll('<', '\\u003c')
  const runtimeSources = JSON.stringify(frameworkRuntime).replaceAll('<', '\\u003c')
  const remValue = resolveInspectorRemValue(width)
  const bootstrap = `(()=>{
    const sources=${runtimeSources};const modules={};
    const load=(name)=>{if(modules[name])return modules[name];const module={exports:{}};const localRequire=(id)=>{if(!modules[id])throw new Error('React Runtime 缺少模块 '+id);return modules[id]};new Function('module','exports','require','process',sources[name])(module,module.exports,localRequire,{env:{NODE_ENV:'production'}});modules[name]=module.exports;return module.exports};
    window.React=load('react');load('scheduler');window.ReactDOM=load('react-dom');window.ReactDOMClient=load('react-dom/client');
    const jsx=(type,config,key)=>{const props=Object.assign({},config||{});if(key!==undefined)props.key=key;return window.React.createElement(type,props)};
    window.jsxRuntime={Fragment:window.React.Fragment,jsx,jsxs:jsx,jsxDEV:jsx};
    window.$eva=window.$eva||{inExample:true,remBase:${remValue},remValue:${remValue}};
  })()`
  const mount = `(()=>{const name=${safeName};const component=window[name];if(!component)throw new Error('组件 Bundle 未导出全局 '+name);const props=${safeProps};const root=window.ReactDOMClient.createRoot(document.getElementById('app'));root.render(window.React.createElement(component,props));requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__RUNTIME_INSPECT_READY__=true}))})()`
  return createHtmlDocument(width, style, [bootstrap, bundle, mount])
}

function createHtmlDocument(width, style, scripts) {
  const tags = scripts.map((source) => `<script>${escapeScript(source)}</script>`).join('')
  const remValue = resolveInspectorRemValue(width)
  const errorProbe = `<script>(()=>{const report=(value)=>{const message=String(value&&value.stack||value&&value.message||value||'Runtime error').slice(0,1000);if(!document.documentElement.dataset.runtimeError)document.documentElement.dataset.runtimeError=message;console.error(message)};addEventListener('error',(event)=>report(event.error||event.message));addEventListener('unhandledrejection',(event)=>report(event.reason))})()</script>`
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: blob:; media-src https: data: blob:; font-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'"><style>html{font-size:${remValue}px}html,body,#app{margin:0;width:${width}px;min-height:1px;background:transparent}*{box-sizing:border-box}${escapeStyle(style)}</style></head><body><div id="app" data-component-root></div>${errorProbe}${tags}</body></html>`
}

export function createStaticHtmlDocument(width, html, css) {
  const body = normalizeStaticBodyMarkup(html)
  const classAttribute = body.className ? ` class="${escapeHtmlAttribute(body.className)}"` : ''
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: blob:; media-src https: data: blob:; font-src https: data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; frame-src 'none'"><style>html,body,#app{margin:0;width:${width}px;min-height:1px;background:transparent}*{box-sizing:border-box}${escapeStyle(css)}</style></head><body><div id="app" data-component-root${classAttribute}>${body.html}</div></body></html>`
}

export function normalizeStaticBodyMarkup(html) {
  const source = String(html || '').trim()
  const body = source.match(/<body\b([^>]*)>([\s\S]*?)<\/body\s*>/iu)
  if (!body) return { html: source, className: '' }
  const className = body[1].match(/\bclass\s*=\s*(["'])(.*?)\1/iu)?.[2] ?? ''
  return { html: body[2].trim(), className }
}

function assertSafeStaticSource(value, field, maxBytes) {
  const source = String(value || '')
  if (!source.trim()) throw new Error(`Runtime Draft 缺少 ${field}。`)
  if (Buffer.byteLength(source) > maxBytes)
    throw new Error(`Runtime Draft ${field} 超过 ${maxBytes} bytes。`)
  const unsafe =
    field === 'html'
      ? /<(?:script|iframe|object|embed|link|base|meta)\b|\son[a-z]+\s*=|javascript\s*:/iu
      : /@import\b|expression\s*\(|javascript\s*:/iu
  if (unsafe.test(source)) throw new Error(`Runtime Draft ${field} 包含不允许的动态内容。`)
  return source
}

export function resolveInspectorRemValue(width) {
  return Math.round((clamp(width, 375, 1, 3000) / 7.5) * 10000) / 10000
}

function createDomTreeExtractionScript(componentName, width, fallbackHeight) {
  return `(() => {
    const host = document.querySelector('[data-component-root]') || document.body
    const topLevel = Array.from(host.children).filter((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0.5 && rect.height > 0.5
    })
    const root = topLevel.length === 1 ? topLevel[0] : host
    const rootRect = root.getBoundingClientRect()
    const directText = (element) => Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join(' ').replace(/\\s+/g, ' ').trim().slice(0, 180)
    const domPath = (element) => {
      const parts = []
      let current = element
      while (current && current !== host && current.nodeType === Node.ELEMENT_NODE) {
        const tag = current.tagName.toLowerCase()
        const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((item) => item.tagName === current.tagName) : []
        parts.unshift(siblings.length > 1 ? tag + ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')' : tag)
        current = current.parentElement
      }
      return parts.join(' > ')
    }
    const imageSource = (element, style) => {
      if (element.tagName.toLowerCase() === 'img') return element.currentSrc || element.src || undefined
      const match = String(style.backgroundImage || '').match(/url\\(\\s*(["']?)(.*?)\\1\\s*\\)/)
      return match?.[2]
    }
    const nodeType = (element, style) => {
      const tag = element.tagName.toLowerCase()
      const role = element.getAttribute('role')
      if (tag === 'button' || role === 'button') return 'button'
      if (tag === 'img' || imageSource(element, style)) return 'image'
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'input'
      if (tag === 'ul' || tag === 'ol' || role === 'list') return 'list'
      if (tag === 'li' || role === 'listitem') return 'list-item'
      if (/^h[1-6]$/.test(tag)) return 'heading'
      if (tag === 'progress' || role === 'progressbar') return 'progress'
      if (directText(element) && !Array.from(element.children).some((child) => directText(child))) return 'text'
      const painted = style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.borderStyle !== 'none' || style.boxShadow !== 'none'
      return painted ? 'surface' : 'container'
    }
    const visible = Array.from(root.querySelectorAll('*')).filter((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0.5 && rect.height > 0.5
    })
    const visibleSet = new Set(visible)
    const candidates = visible.filter((element) => {
      const style = getComputedStyle(element)
      const type = nodeType(element, style)
      if (type !== 'container') return true
      const visibleChildren = Array.from(element.children).filter((child) => visibleSet.has(child))
      return ['flex', 'grid', 'inline-flex', 'inline-grid'].includes(style.display) && visibleChildren.length > 1
    }).slice(0, 600)
    if (!candidates.includes(root)) candidates.unshift(root)
    const accepted = new Set(candidates)
    const ids = new Map()
    const slug = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
    candidates.forEach((element, index) => ids.set(element, slug(element.dataset.regionId || element.id || element.classList[0] || element.tagName) + '-' + (index + 1)))
    const nodes = candidates.map((element, index) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      let parent = element.parentElement
      while (parent && !accepted.has(parent)) parent = parent.parentElement
      const type = nodeType(element, style)
      const content = ['text','heading','button','input','image'].includes(type) ? (directText(element) || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '') : ''
      const fill = style.backgroundColor !== 'rgba(0, 0, 0, 0)' ? style.backgroundColor : undefined
      return {
        id: ids.get(element) || 'runtime-node-' + (index + 1),
        type,
        role: element.getAttribute('aria-label') || element.dataset.role || type,
        parentId: parent ? ids.get(parent) : undefined,
        bounds: { x: Math.max(0, rect.x - rootRect.x), y: Math.max(0, rect.y - rootRect.y), width: rect.width, height: rect.height },
        content: content || undefined,
        domPath: domPath(element),
        assetSource: imageSource(element, style),
        bindingStatus: 'visual-only', source: 'runtime-inspect', confidence: 0.98, editable: true,
        style: {
          fill,
          color: style.color,
          radius: parseFloat(style.borderRadius) || 0,
          fontSize: parseFloat(style.fontSize) || undefined,
          fontWeight: parseFloat(style.fontWeight) || undefined,
          lineHeight: parseFloat(style.lineHeight) || undefined,
          textAlign: style.textAlign,
          stroke: style.borderStyle !== 'none' ? style.borderColor : undefined,
          strokeWidth: style.borderStyle !== 'none' ? parseFloat(style.borderWidth) || undefined : undefined,
          shadow: style.boxShadow !== 'none' ? style.boxShadow : undefined
        }
      }
    })
    return { version: 1, componentName: ${JSON.stringify(componentName)}, width: Math.max(${width}, rootRect.width), height: Math.max(1, rootRect.height || ${fallbackHeight}), nodes, diagnostics: [] }
  })()`
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

async function waitForRuntime(webContents) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ready = await webContents.executeJavaScript('Boolean(window.__RUNTIME_INSPECT_READY__)')
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('组件 Runtime 挂载超时。')
}

function extractDefaultProps(component) {
  return Object.fromEntries(
    (component.props ?? [])
      .map((prop) => [prop.name, defaultPropValue(prop)])
      .filter((entry) => entry[1] !== undefined),
  )
}

function defaultPropValue(prop) {
  if (prop?.defaultValue !== undefined) return prop.defaultValue
  const editors = Object.values(prop?.valueTypeMap || {})
  const editorDefault = editors.find((editor) => editor?.defaultValue !== undefined)?.defaultValue
  if (editorDefault !== undefined) return editorDefault
  const children = Array.isArray(prop?.objectChildrenShape) ? prop.objectChildrenShape : []
  if (children.length) {
    const value = Object.fromEntries(
      children
        .map((child) => [child.name, defaultPropValue(child)])
        .filter((entry) => entry[1] !== undefined),
    )
    return Object.keys(value).length ? value : undefined
  }
  return undefined
}

async function loadFrameworkRuntime(framework) {
  if (framework === 'vue2') {
    return { vue: await fs.readFile(require.resolve('vue/dist/vue.runtime.min.js'), 'utf8') }
  }
  const legacy = framework === 'react18'
  const reactRoot = path.dirname(require.resolve(`${legacy ? 'react18' : 'react'}/package.json`))
  const reactDomRoot = path.dirname(
    require.resolve(`${legacy ? 'react-dom18' : 'react-dom'}/package.json`),
  )
  const schedulerRoot = path.dirname(
    require.resolve(`${legacy ? 'scheduler18' : 'scheduler'}/package.json`),
  )
  const productionFile = (root, modernName, legacyName) =>
    path.join(root, 'cjs', legacy ? legacyName : modernName)
  const [react, scheduler, reactDom, reactDomClient] = await Promise.all([
    fs.readFile(
      productionFile(reactRoot, 'react.production.js', 'react.production.min.js'),
      'utf8',
    ),
    fs.readFile(
      productionFile(schedulerRoot, 'scheduler.production.js', 'scheduler.production.min.js'),
      'utf8',
    ),
    fs.readFile(
      productionFile(reactDomRoot, 'react-dom.production.js', 'react-dom.production.min.js'),
      'utf8',
    ),
    legacy
      ? Promise.resolve(
          `const ReactDOM=require('react-dom');module.exports={createRoot:ReactDOM.createRoot,hydrateRoot:ReactDOM.hydrateRoot}`,
        )
      : fs.readFile(path.join(reactDomRoot, 'cjs/react-dom-client.production.js'), 'utf8'),
  ])
  return { react, scheduler, 'react-dom': reactDom, 'react-dom/client': reactDomClient }
}

async function fetchTextAsset(url, maxBytes, timeoutMs) {
  const cached = bundleCache.get(url)
  if (cached) return cached
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) throw new Error(`下载组件资源失败：HTTP ${response.status}`)
    if (!isPublicHttpsUrl(response.url)) throw new Error('组件资源重定向到了不可信地址。')
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes)
      throw new Error(`组件资源超过 ${maxBytes} bytes。`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) throw new Error(`组件资源超过 ${maxBytes} bytes。`)
    const value = buffer.toString('utf8')
    bundleCache.set(url, value)
    return value
  } finally {
    clearTimeout(timer)
  }
}

async function fetchBinaryImageAsset(url, maxBytes, timeoutMs, fetchImpl) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) throw new Error(`下载 Runtime 图片失败：HTTP ${response.status}`)
    if (response.url && !isPublicHttpsUrl(response.url))
      throw new Error('Runtime 图片重定向到了不可信地址。')
    const mime = String(response.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    if (!mime.startsWith('image/')) throw new Error('Runtime 图片响应类型无效。')
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes)
      throw new Error(`Runtime 图片超过 ${maxBytes} bytes。`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (!buffer.length || buffer.length > maxBytes)
      throw new Error(`Runtime 图片为空或超过 ${maxBytes} bytes。`)
    return `data:${mime};base64,${buffer.toString('base64')}`
  } finally {
    clearTimeout(timer)
  }
}

function normalizeFramework(value) {
  const framework = String(value || '').trim()
  if (/^vue@?2(?:\.|$)/i.test(framework)) return 'vue2'
  const react = framework.match(/^react(?:@?(\d+)(?:\.\d+)*)?$/i)
  if (react) return react[1] && Number(react[1]) <= 18 ? 'react18' : 'react19'
  return 'unknown'
}

function assertPublicHttpsUrl(value, field) {
  if (!isPublicHttpsUrl(value)) throw new Error(`${field} 必须是公网 HTTPS URL。`)
  return String(value)
}

function isPublicHttpsUrl(value) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !['localhost', '0.0.0.0', '127.0.0.1', '::1'].includes(url.hostname) &&
      !/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)
    )
  } catch {
    return false
  }
}

function escapeScript(value) {
  return String(value).replace(/<\/script/gi, '<\\/script')
}

function escapeStyle(value) {
  return String(value).replace(/<\/style/gi, '<\\/style')
}

function withTimeout(promise, timeoutMs) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Runtime Inspect 超过 ${timeoutMs}ms。`)),
        timeoutMs,
      )
    }),
  ]).finally(() => clearTimeout(timer))
}

function unsupported(message) {
  return {
    status: 'unsupported',
    designTree: undefined,
    diagnostics: [{ code: 'RUNTIME_INSPECT_UNSUPPORTED', message }],
  }
}

function clamp(value, fallback, min, max) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}
