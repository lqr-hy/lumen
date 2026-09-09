import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRuntimeError } from './providers.mjs'

let runtimeConfig = {
  appRoot: process.cwd(),
  resourcesPath: process.resourcesPath || process.cwd(),
  userDataPath: process.cwd(),
  isPackaged: false,
}
const cachedPacks = new Map()
const MAX_EXPORT_PACKAGE_BYTES = 64 * 1024 * 1024
const EXPORT_ADAPTER_TIMEOUT_MS = 10_000
const MAX_IMPORTED_COMPONENT_BYTES = 2 * 1024 * 1024
const MAX_IMPORTED_COMPONENT_NODES = 50_000
const MAX_IMPORTED_COMPONENT_DEPTH = 40
const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024

export function configureComponentPackRuntime(config = {}) {
  runtimeConfig = {
    appRoot: config.appRoot || runtimeConfig.appRoot,
    resourcesPath: config.resourcesPath || runtimeConfig.resourcesPath,
    userDataPath: config.userDataPath || runtimeConfig.userDataPath,
    isPackaged: Boolean(config.isPackaged),
  }
  cachedPacks.clear()
}

export async function listComponentPacks(options = {}) {
  const projectId = normalizeProjectId(options.projectId)
  const cacheKey = projectId || 'built-in'
  if (cachedPacks.has(cacheKey) && !options.refresh) return cachedPacks.get(cacheKey)
  const roots = [getComponentPacksRoot()]
  if (projectId) roots.push(getProjectComponentPacksRoot(projectId))
  const packs = []
  for (const packsRoot of roots) packs.push(...(await readPacksRoot(packsRoot)))
  validateUniqueComponents(packs)
  const result = packs.sort((left, right) => left.id.localeCompare(right.id))
  cachedPacks.set(cacheKey, result)
  return result
}

async function readPacksRoot(packsRoot) {
  let entries = []
  try {
    entries = await fs.readdir(packsRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const packs = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const root = path.join(packsRoot, entry.name)
    try {
      const source = await fs.readFile(path.join(root, 'manifest.json'), 'utf8')
      packs.push(validatePackManifest(JSON.parse(source), root, entry.name))
    } catch (error) {
      console.warn('[runtime] component pack ignored', {
        folder: entry.name,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return packs
}

export async function listPublicComponentPacks(projectId) {
  return (await listComponentPacks({ projectId })).map((pack) => ({
    id: pack.id,
    label: pack.label,
    version: pack.version,
    skill: pack.skill.name,
    components: pack.components.map((component) => ({
      name: component.name,
      label: component.label,
      kind: component.kind,
      aliases: component.aliases,
    })),
  }))
}

export async function resolveComponentPackSkillNames(prompt) {
  const matches = matchPackComponents(await listComponentPacks(), prompt)
  return [...new Set(matches.map(({ pack }) => pack.skill.name))]
}

export async function resolveComponentReference(reference, options = {}) {
  const packId = normalizeReferenceIdentifier(reference?.packId, 'packId')
  const componentName = normalizeReferenceIdentifier(reference?.componentName, 'componentName')
  const packs = await listComponentPacks({ projectId: options.projectId })
  const pack = packs.find((item) => item.id === packId)
  const descriptor = pack?.components.find((item) => item.name === componentName)
  if (!pack || !descriptor) {
    throw createRuntimeError(
      'COMPONENT_RESOLVE_FAILED',
      `组件未解析：${packId}/${componentName}。未执行普通图片生成。`,
      { packId, componentName },
    )
  }
  return loadComponentDescriptor(pack, descriptor, options)
}

export async function importProjectComponent(input) {
  const projectId = normalizeProjectId(input?.projectId)
  if (!projectId)
    throw createRuntimeError('COMPONENT_IMPORT_PROJECT_INVALID', '导入组件缺少有效 projectId。')
  const fileName = String(input?.fileName || '').trim()
  if (!/^[A-Za-z][A-Za-z0-9_.-]*\.json$/.test(fileName)) {
    throw createRuntimeError('COMPONENT_IMPORT_FILE_INVALID', '只支持名称安全的 .json 组件文件。')
  }
  const source = String(input?.source || '')
  if (!source || Buffer.byteLength(source) > MAX_IMPORTED_COMPONENT_BYTES) {
    throw createRuntimeError('COMPONENT_IMPORT_SIZE_INVALID', '组件 JSON 为空或超过 2MB。')
  }
  let component
  try {
    component = JSON.parse(source)
  } catch {
    throw createRuntimeError('COMPONENT_IMPORT_JSON_INVALID', '组件文件不是合法 JSON。')
  }
  validateImportedComponent(component)
  const builtInPacks = await listComponentPacks()
  const selectors = new Set(
    builtInPacks
      .flatMap((pack) =>
        pack.components.flatMap((item) => [
          item.name,
          item.file,
          path.basename(item.file, '.json'),
          ...item.aliases,
        ]),
      )
      .map((value) => value.toLowerCase()),
  )
  if (selectors.has(component.name.toLowerCase()) || selectors.has(fileName.toLowerCase())) {
    throw createRuntimeError(
      'COMPONENT_IMPORT_CONFLICT',
      `${component.name} 与内置组件重名，不能覆盖内置 Pack。`,
    )
  }

  const packsRoot = getProjectComponentPacksRoot(projectId)
  const packRoot = path.join(packsRoot, 'project-imports')
  const componentsRoot = path.join(packRoot, 'components')
  await fs.mkdir(componentsRoot, { recursive: true })
  const manifestPath = path.join(packRoot, 'manifest.json')
  let manifest = createProjectImportManifest()
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT')
      throw createRuntimeError('COMPONENT_IMPORT_MANIFEST_INVALID', '项目组件索引已损坏。')
  }
  const existing = (manifest.components ?? []).find((item) => item.name === component.name)
  if (existing)
    throw createRuntimeError('COMPONENT_IMPORT_CONFLICT', `${component.name} 已存在于当前项目。`)
  const storedFileName = `${component.name}.json`
  manifest.components = [
    ...(manifest.components ?? []),
    {
      name: component.name,
      label:
        typeof component.label === 'string' && component.label.trim()
          ? component.label.trim().slice(0, 64)
          : component.name,
      file: storedFileName,
      kind: component.thumbnail ? 'design' : 'structural',
      aliases: [],
    },
  ]
  await writeFileAtomic(
    path.join(componentsRoot, storedFileName),
    JSON.stringify(component, null, 2),
  )
  await writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2))
  cachedPacks.delete(projectId)
  return {
    packId: 'project-imports',
    componentName: component.name,
    label: manifest.components.at(-1).label,
  }
}

export function resolveLoadedComponentPackTool(loaded, capability) {
  return loaded?.pack?.skill?.tools?.[capability]
}

export async function executeComponentPackExportAdapter(input) {
  const request = normalizeExportAdapterInput(input)
  const pack = (await listComponentPacks()).find((item) => item.id === request.packId)
  if (!pack) {
    throw createRuntimeError('COMPONENT_PACK_NOT_FOUND', `未找到组件所属 Pack：${request.packId}`)
  }
  if (!pack.exportAdapter) return { applied: false }

  const stat = await fs.stat(pack.exportAdapter)
  const module = await import(`${pathToFileURL(pack.exportAdapter).href}?mtime=${stat.mtimeMs}`)
  if (typeof module.adaptComponentExport !== 'function') {
    throw createRuntimeError(
      'COMPONENT_EXPORT_ADAPTER_INVALID',
      `${pack.id} 的 Export Adapter 缺少 adaptComponentExport 导出。`,
    )
  }
  const result = await withTimeout(
    Promise.resolve(
      module.adaptComponentExport(
        Object.freeze({
          version: 1,
          componentName: request.componentName,
          profile: request.profile,
          standardPackage: request.standardPackage,
        }),
      ),
    ),
    EXPORT_ADAPTER_TIMEOUT_MS,
  )
  const packageBytes = normalizePackageBytes(result?.package ?? result, 'Adapter 输出')
  assertZipPackage(packageBytes, 'COMPONENT_EXPORT_ADAPTER_OUTPUT_INVALID')
  return {
    applied: true,
    adapterId: pack.id,
    package: Uint8Array.from(packageBytes),
  }
}

export async function loadComponentFromPrompt(prompt, options = {}) {
  const candidates = await loadComponentsFromPrompt(prompt, options)
  if (candidates.length !== 1) {
    throw createRuntimeError(
      'COMPONENT_MATCH_AMBIGUOUS',
      '提示词匹配到多个组件，请明确指定一个组件名称。',
    )
  }
  return candidates[0]
}

export async function loadComponentsFromPrompt(prompt, options = {}) {
  const packs = await listComponentPacks({ projectId: options.projectId })
  if (!packs.length)
    throw createRuntimeError('COMPONENT_PACK_REGISTRY_MISSING', '应用中没有可用的 Component Pack。')
  const matches = matchPackComponents(packs, prompt)
  if (!matches.length) {
    const available = packs.flatMap((pack) => pack.components.map((component) => component.name))
    throw createRuntimeError(
      'COMPONENT_NOT_FOUND',
      `请明确指定组件名称。当前可用组件：${available.join('、') || '无'}。`,
    )
  }
  return Promise.all(
    matches.map(({ pack, descriptor }) => loadComponentDescriptor(pack, descriptor, options)),
  )
}

export function getComponentPacksRoot() {
  return runtimeConfig.isPackaged
    ? path.join(runtimeConfig.resourcesPath, 'component-packs')
    : path.join(runtimeConfig.appRoot, 'component-packs')
}

function getProjectComponentPacksRoot(projectId) {
  const digest = crypto.createHash('sha256').update(projectId).digest('hex').slice(0, 24)
  return path.join(runtimeConfig.userDataPath, 'project-component-packs', digest)
}

function matchPackComponents(packs, prompt) {
  const value = String(prompt || '').toLowerCase()
  const matches = []
  for (const pack of packs) {
    for (const descriptor of pack.components) {
      const selectors = [
        descriptor.name,
        descriptor.file,
        path.basename(descriptor.file, '.json'),
        ...descriptor.aliases,
      ]
      if (selectors.some((selector) => value.includes(selector.toLowerCase())))
        matches.push({ pack, descriptor })
    }
  }
  return matches
}

function validatePackManifest(manifest, root, folderName) {
  if (!manifest || manifest.version !== 1 || manifest.id !== folderName) {
    throw new Error('Component Pack Manifest 的 version 或 id 无效。')
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)) {
    throw new Error('Component Pack id 只能使用小写字母、数字和连字符。')
  }
  if (!manifest.skill?.name || !manifest.skill?.tools?.resolveContract) {
    throw new Error('Component Pack 必须声明 skill.name 和 tools.resolveContract。')
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(manifest.skill.name)) {
    throw new Error('Component Pack skill.name 无效。')
  }
  for (const toolName of Object.values(manifest.skill.tools)) {
    if (
      toolName !== undefined &&
      (typeof toolName !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(toolName))
    ) {
      throw new Error('Component Pack Skill Tool 名称无效。')
    }
  }
  const sourceKind = manifest.source?.kind
  if (!['pack', 'component-registry'].includes(sourceKind))
    throw new Error('Component Pack source.kind 无效。')
  const sourceRoot =
    sourceKind === 'pack'
      ? resolveInside(root, manifest.source.root || 'components')
      : getLegacyComponentRegistryRoot()
  const components = (manifest.components ?? []).map((component) => {
    if (
      !component?.name ||
      !/^[A-Za-z][A-Za-z0-9_-]*$/.test(component.name) ||
      !component?.file ||
      !['design', 'structural'].includes(component.kind)
    ) {
      throw new Error('Component Pack 组件索引无效。')
    }
    if (!/^[a-z0-9_.-]+\.json$/i.test(component.file))
      throw new Error(`组件文件名无效：${component.file}`)
    return {
      name: component.name,
      label: typeof component.label === 'string' ? component.label : component.name,
      file: component.file,
      kind: component.kind,
      aliases: Array.isArray(component.aliases)
        ? component.aliases
            .filter((alias) => typeof alias === 'string' && alias.trim())
            .map((alias) => alias.trim().slice(0, 64))
            .slice(0, 16)
        : [],
    }
  })
  if (!components.length) throw new Error('Component Pack 没有组件。')
  return {
    id: manifest.id,
    label: typeof manifest.label === 'string' ? manifest.label : manifest.id,
    version: 1,
    root,
    source: { kind: sourceKind, root: sourceRoot },
    surface: normalizePackSurface(manifest.surface),
    skill: {
      name: manifest.skill.name,
      tools: {
        resolveContract: manifest.skill.tools.resolveContract,
        extractFacts: manifest.skill.tools.extractFacts,
      },
    },
    exportAdapter:
      typeof manifest.exportAdapter === 'string'
        ? resolveExportAdapter(root, manifest.exportAdapter)
        : undefined,
    components,
  }
}

function resolveComponentSource(pack, file) {
  return resolveInside(pack.source.root, file)
}

async function loadComponentDescriptor(pack, descriptor, options = {}) {
  if (descriptor.kind === 'structural' && !options.allowStructuralComponents) {
    throw createRuntimeError(
      'COMPONENT_STRUCTURAL_ONLY',
      `${descriptor.name} 是结构组件，只能在页面组合流程中使用。`,
    )
  }
  let source
  try {
    source = await fs.readFile(resolveComponentSource(pack, descriptor.file), 'utf8')
  } catch (error) {
    throw createRuntimeError(
      'COMPONENT_RESOLVE_FAILED',
      `组件未解析：${pack.id}/${descriptor.name}。未执行普通图片生成。`,
      {
        packId: pack.id,
        componentName: descriptor.name,
        cause: error instanceof Error ? error.message : String(error),
      },
    )
  }
  let component
  try {
    component = JSON.parse(source)
  } catch {
    throw createRuntimeError(
      'COMPONENT_RESOLVE_FAILED',
      `${descriptor.name} 的组件 JSON 无效。未执行普通图片生成。`,
    )
  }
  if (String(component?.name || '') !== descriptor.name) {
    throw createRuntimeError(
      'COMPONENT_PACK_SOURCE_MISMATCH',
      `${pack.id} 中 ${descriptor.file} 的组件名称与 Manifest 不一致。`,
    )
  }
  if (!component.thumbnail && descriptor.kind !== 'structural') {
    throw createRuntimeError(
      'COMPONENT_THUMBNAIL_MISSING',
      `${component.name} 缺少 thumbnail，无法可靠生成组件原型。`,
    )
  }
  const thumbnailUpload = component.thumbnail
    ? await loadComponentThumbnail(component.thumbnail, component.name)
    : undefined
  return {
    component,
    source,
    fileName: descriptor.file,
    thumbnailUpload,
    pack: publicPackRuntime(pack),
    descriptor,
  }
}

function publicPackRuntime(pack) {
  return {
    id: pack.id,
    label: pack.label,
    version: pack.version,
    skill: pack.skill,
    exportAdapter: pack.exportAdapter,
    surface: pack.surface,
  }
}

function normalizePackSurface(value) {
  const source = value && typeof value === 'object' ? value : {}
  const viewport = source.viewport && typeof source.viewport === 'object' ? source.viewport : {}
  const width = Number(viewport.width)
  const height = Number(viewport.height)
  const layout = source.layout && typeof source.layout === 'object' ? source.layout : {}
  return {
    kind: ['mobile', 'desktop-web', 'desktop-admin', 'custom'].includes(source.kind)
      ? source.kind
      : 'mobile',
    viewport: {
      width: Number.isFinite(width) && width > 0 ? width : 375,
      height: Number.isFinite(height) && height > 0 ? height : 812,
    },
    autoHeight: source.autoHeight !== false,
    layout: {
      direction: ['vertical', 'horizontal', 'grid'].includes(layout.direction)
        ? layout.direction
        : 'vertical',
      columns: Number.isFinite(layout.columns)
        ? Math.max(1, Math.round(layout.columns))
        : undefined,
      padding: Number.isFinite(layout.padding) ? Math.max(0, layout.padding) : 16,
      gap: Number.isFinite(layout.gap) ? Math.max(0, layout.gap) : 24,
    },
  }
}

function validateUniqueComponents(packs) {
  const owners = new Map()
  for (const pack of packs) {
    for (const component of pack.components) {
      const selectors = [
        component.name,
        component.file,
        path.basename(component.file, '.json'),
        ...component.aliases,
      ]
      for (const selector of new Set(selectors.map((value) => value.toLowerCase()))) {
        const owner = owners.get(selector)
        if (owner) {
          throw new Error(
            `组件选择器 ${selector} 同时由 ${owner.pack}/${owner.component} 和 ${pack.id}/${component.name} 声明。`,
          )
        }
        owners.set(selector, { pack: pack.id, component: component.name })
      }
    }
  }
}

function resolveExportAdapter(root, relativePath) {
  if (!/\.mjs$/i.test(relativePath))
    throw new Error('Component Pack exportAdapter 必须是 .mjs 文件。')
  return resolveInside(root, relativePath)
}

function normalizeExportAdapterInput(input) {
  if (!input || typeof input !== 'object') {
    throw createRuntimeError('COMPONENT_EXPORT_REQUEST_INVALID', '组件导出请求格式无效。')
  }
  const packId = normalizeExportIdentifier(input.packId, 'packId')
  const componentName = normalizeExportIdentifier(input.componentName, 'componentName')
  const profile = normalizeExportIdentifier(input.profile, 'profile')
  const standardPackage = normalizePackageBytes(input.standardPackage, '标准组件包')
  assertZipPackage(standardPackage, 'COMPONENT_EXPORT_REQUEST_INVALID')
  return { packId, componentName, profile, standardPackage: Uint8Array.from(standardPackage) }
}

function normalizeExportIdentifier(value, field) {
  const normalized = String(value || '').trim()
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw createRuntimeError('COMPONENT_EXPORT_REQUEST_INVALID', `组件导出 ${field} 无效。`)
  }
  return normalized
}

function normalizeReferenceIdentifier(value, field) {
  const normalized = String(value || '').trim()
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw createRuntimeError('COMPONENT_REFERENCE_INVALID', `组件引用 ${field} 无效。`)
  }
  return normalized
}

function normalizeProjectId(value) {
  const normalized = String(value || '').trim()
  if (!normalized || normalized.length > 256 || /[\0\r\n]/.test(normalized)) return ''
  return normalized
}

function validateImportedComponent(component) {
  if (!component || typeof component !== 'object' || Array.isArray(component)) {
    throw createRuntimeError('COMPONENT_IMPORT_SCHEMA_INVALID', '组件 JSON 根节点必须是对象。')
  }
  if (typeof component.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(component.name)) {
    throw createRuntimeError(
      'COMPONENT_IMPORT_SCHEMA_INVALID',
      '组件 name 必须是稳定的 ASCII 标识。',
    )
  }
  if (!component.props || typeof component.props !== 'object' || Array.isArray(component.props)) {
    throw createRuntimeError('COMPONENT_IMPORT_SCHEMA_INVALID', '组件 props 必须是对象。')
  }
  if (component.thumbnail) {
    let url
    try {
      url = new URL(component.thumbnail)
    } catch {
      throw createRuntimeError(
        'COMPONENT_IMPORT_THUMBNAIL_INVALID',
        '组件 thumbnail 不是有效 URL。',
      )
    }
    if (!isAllowedThumbnailUrl(url)) {
      throw createRuntimeError(
        'COMPONENT_IMPORT_THUMBNAIL_INVALID',
        '组件 thumbnail 必须是 HTTPS 图片地址。',
      )
    }
  }
  let nodes = 0
  const visit = (value, depth) => {
    nodes += 1
    if (nodes > MAX_IMPORTED_COMPONENT_NODES || depth > MAX_IMPORTED_COMPONENT_DEPTH) {
      throw createRuntimeError(
        'COMPONENT_IMPORT_COMPLEXITY_INVALID',
        '组件 JSON 结构过深或节点过多。',
      )
    }
    if (typeof value === 'string' && value.length > 256 * 1024) {
      throw createRuntimeError('COMPONENT_IMPORT_COMPLEXITY_INVALID', '组件 JSON 包含超长字符串。')
    }
    if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1))
    else if (value && typeof value === 'object')
      Object.values(value).forEach((item) => visit(item, depth + 1))
  }
  visit(component, 0)
}

function createProjectImportManifest() {
  return {
    version: 1,
    id: 'project-imports',
    label: '项目导入组件',
    source: { kind: 'pack', root: 'components' },
    skill: {
      name: 'component-design-assets',
      tools: {
        extractFacts: 'component-design-assets.extract-facts',
        resolveContract: 'component-design-assets.resolve-contract',
      },
    },
    components: [],
  }
}

async function writeFileAtomic(filePath, source) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temporaryPath, source, 'utf8')
  await fs.rename(temporaryPath, filePath)
}

function normalizePackageBytes(value, label) {
  let bytes
  if (value instanceof Uint8Array) bytes = value
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value)
  else if (ArrayBuffer.isView(value))
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (!bytes || !bytes.byteLength || bytes.byteLength > MAX_EXPORT_PACKAGE_BYTES) {
    throw createRuntimeError('COMPONENT_EXPORT_PACKAGE_INVALID', `${label}为空或超过 64MB。`)
  }
  return bytes
}

function assertZipPackage(bytes, code) {
  const signature = bytes.length >= 4 ? `${bytes[0]},${bytes[1]},${bytes[2]},${bytes[3]}` : ''
  if (!['80,75,3,4', '80,75,5,6', '80,75,7,8'].includes(signature)) {
    throw createRuntimeError(code, 'Component Pack Export Adapter 必须返回 ZIP 文件。')
  }
}

async function withTimeout(promise, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              createRuntimeError(
                'COMPONENT_EXPORT_ADAPTER_TIMEOUT',
                `Component Pack Export Adapter 执行超过 ${timeoutMs / 1000} 秒。`,
              ),
            ),
          timeoutMs,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function getLegacyComponentRegistryRoot() {
  return runtimeConfig.isPackaged
    ? path.join(runtimeConfig.resourcesPath, 'componentsJson')
    : path.join(runtimeConfig.appRoot, 'componentsJson')
}

function resolveInside(root, relativePath) {
  const target = path.resolve(root, relativePath)
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    if (!relative) return target
    throw new Error(`Component Pack 路径越界：${relativePath}`)
  }
  return target
}

async function loadComponentThumbnail(value, componentName) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw createRuntimeError(
      'COMPONENT_THUMBNAIL_INVALID',
      `${componentName} 的 thumbnail URL 无效。`,
    )
  }
  if (!isAllowedThumbnailUrl(url)) {
    throw createRuntimeError(
      'COMPONENT_THUMBNAIL_UNTRUSTED',
      `${componentName} 的 thumbnail 必须是 HTTPS 图片地址。`,
    )
  }
  let response
  try {
    response = await fetchPublicThumbnail(url)
  } catch (error) {
    if (error?.code === 'COMPONENT_THUMBNAIL_UNTRUSTED') throw error
    throw createRuntimeError(
      'COMPONENT_THUMBNAIL_LOAD_FAILED',
      `${componentName} 的 thumbnail 下载失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok)
    throw createRuntimeError(
      'COMPONENT_THUMBNAIL_LOAD_FAILED',
      `${componentName} 的 thumbnail 下载失败：HTTP ${response.status}。`,
    )
  const declaredBytes = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_THUMBNAIL_BYTES) {
    throw createRuntimeError(
      'COMPONENT_THUMBNAIL_INVALID',
      `${componentName} 的 thumbnail 超过 8MB。`,
    )
  }
  const bytes = await readResponseBytes(response, MAX_THUMBNAIL_BYTES)
  if (!bytes.length) {
    throw createRuntimeError(
      'COMPONENT_THUMBNAIL_INVALID',
      `${componentName} 的 thumbnail 大小无效。`,
    )
  }
  const responsePathname = response.url ? new URL(response.url).pathname : url.pathname
  const mime = normalizeThumbnailMime(response.headers.get('content-type'), responsePathname)
  if (!isSupportedThumbnail(bytes, mime)) {
    throw createRuntimeError(
      'COMPONENT_THUMBNAIL_INVALID',
      `${componentName} 的 thumbnail 响应不是受支持的 PNG、JPEG 或 WebP 图片。`,
    )
  }
  return {
    type: 'file',
    name: `${componentName}-thumbnail.${extensionForThumbnailMime(mime)}`,
    mime,
    role: 'prototype',
    data: `data:${mime};base64,${bytes.toString('base64')}`,
  }
}

function isAllowedThumbnailUrl(url) {
  // thumbnail 域名不做白名单或公网 IP 限制，以兼容 UAT、内网和自定义 CDN。
  // 仍要求 HTTPS 且禁止在 URL 中携带账号密码；内容本身继续执行大小、格式和超时校验。
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password
  )
}

async function fetchPublicThumbnail(initialUrl) {
  let url = initialUrl
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    if (!isAllowedThumbnailUrl(url)) {
      throw createRuntimeError(
        'COMPONENT_THUMBNAIL_UNTRUSTED',
        'thumbnail 地址或重定向目标必须是 HTTPS 地址。',
      )
    }
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    const location = response.headers.get('location')
    if (!location) throw new Error('thumbnail 重定向缺少 Location。')
    await response.body?.cancel()
    url = new URL(location, url)
  }
  throw new Error('thumbnail 重定向次数超过限制。')
}

function isSupportedThumbnail(bytes, mime) {
  if (mime === 'image/png') {
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  }
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8
  if (mime === 'image/webp') {
    return (
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    )
  }
  return false
}

async function readResponseBytes(response, maximumBytes) {
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > maximumBytes) {
      throw createRuntimeError('COMPONENT_THUMBNAIL_INVALID', 'thumbnail 超过 8MB。')
    }
    return bytes
  }
  const reader = response.body.getReader()
  const chunks = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maximumBytes) {
        await reader.cancel()
        throw createRuntimeError('COMPONENT_THUMBNAIL_INVALID', 'thumbnail 超过 8MB。')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, totalBytes)
}

function normalizeThumbnailMime(contentType, pathname) {
  const value = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (['image/png', 'image/jpeg', 'image/webp'].includes(value)) return value
  if (value && value !== 'application/octet-stream') return ''
  const extension = path.extname(pathname).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  return 'image/png'
}

function extensionForThumbnailMime(mime) {
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  return 'png'
}
