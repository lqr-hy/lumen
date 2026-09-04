import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { createRuntimeError } from './providers.mjs'

const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024
const MAX_FILES = 96
const MAX_TOTAL_BYTES = 12 * 1024 * 1024
const EXTENSION_ID = /^[a-z0-9][a-z0-9-]{1,62}$/

let runtimeConfig = {
  appRoot: process.cwd(),
  resourcesPath: process.resourcesPath || process.cwd(),
  userDataPath: process.cwd(),
  isPackaged: false,
}

export function configureUserExtensions(config = {}) {
  runtimeConfig = {
    appRoot: config.appRoot || runtimeConfig.appRoot,
    resourcesPath: config.resourcesPath || runtimeConfig.resourcesPath,
    userDataPath: config.userDataPath || runtimeConfig.userDataPath,
    isPackaged: Boolean(config.isPackaged),
  }
}

export async function listUserExtensions() {
  const [skills, stylePacks] = await Promise.all([listUserSkills(), listStylePacks()])
  return { skills, stylePacks }
}

export async function listUserSkills() {
  const registry = await readRegistry()
  return listDirectories(userSkillsRoot(), async (directory, folder) => {
    const source = await fs.readFile(path.join(directory, 'SKILL.md'), 'utf8')
    const metadata = parseSkillFrontmatter(source)
    if (metadata.name !== folder) return undefined
    return {
      id: metadata.name,
      name: metadata.name,
      description: metadata.description,
      source: 'user',
      enabled: registry.skills[metadata.name] !== false,
      executable: false,
    }
  })
}

export async function listStylePacks() {
  const registry = await readRegistry()
  const roots = [
    { root: builtInStylePacksRoot(), source: 'built-in' },
    { root: userStylePacksRoot(), source: 'user' },
  ]
  const byId = new Map()
  for (const item of roots) {
    const packs = await listDirectories(item.root, async (directory, folder) => {
      const pack = await readStylePack(directory)
      if (pack.id !== folder) return undefined
      return {
        ...pack,
        source: item.source,
        enabled: item.source === 'built-in' || registry.stylePacks[pack.id] !== false,
      }
    })
    for (const pack of packs) {
      if (!byId.has(pack.id) || pack.source === 'user') byId.set(pack.id, pack)
    }
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
}

export async function resolveStylePack(stylePackId) {
  if (!stylePackId) return undefined
  const pack = (await listStylePacks()).find((item) => item.id === stylePackId && item.enabled)
  if (!pack)
    throw createRuntimeError('STYLE_PACK_NOT_FOUND', `设计风格不存在或已停用：${stylePackId}`)
  return sanitizeStylePackForRuntime(pack)
}

export async function installUserSkill(sourcePath) {
  const prepared = await prepareImportSource(sourcePath, 'skill')
  try {
    const root = await locatePackageRoot(prepared.root, 'SKILL.md')
    await assertSafeTree(root, { allowRuntime: false })
    const source = await fs.readFile(path.join(root, 'SKILL.md'), 'utf8')
    const metadata = parseSkillFrontmatter(source)
    if (await builtInSkillExists(metadata.name)) {
      throw createRuntimeError(
        'SKILL_NAME_CONFLICT',
        `用户 Skill 不能覆盖内置能力：${metadata.name}`,
      )
    }
    const target = path.join(userSkillsRoot(), metadata.name)
    await replaceDirectory(root, target)
    await updateRegistry('skills', metadata.name, true)
    return { id: metadata.name, name: metadata.name, description: metadata.description }
  } finally {
    await prepared.cleanup()
  }
}

export async function installStylePack(sourcePath) {
  const stat = await fs.stat(sourcePath)
  if (stat.isFile() && path.extname(sourcePath).toLowerCase() === '.json') {
    const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'))
    const pack = normalizeStylePack(source)
    await assertNoBuiltInStyleConflict(pack.id)
    const temporary = await createTemporaryRoot('style-json')
    const packageRoot = path.join(temporary, pack.id)
    await fs.mkdir(packageRoot, { recursive: true })
    await fs.writeFile(path.join(packageRoot, 'style.json'), JSON.stringify(pack, null, 2), 'utf8')
    try {
      await replaceDirectory(packageRoot, path.join(userStylePacksRoot(), pack.id))
      await updateRegistry('stylePacks', pack.id, true)
      return pack
    } finally {
      await fs.rm(temporary, { recursive: true, force: true })
    }
  }
  const prepared = await prepareImportSource(sourcePath, 'style')
  try {
    const root = await locateStylePackRoot(prepared.root)
    await assertSafeTree(root, { allowRuntime: false })
    const pack = await readStylePack(root)
    await assertNoBuiltInStyleConflict(pack.id)
    await replaceDirectory(root, path.join(userStylePacksRoot(), pack.id))
    await updateRegistry('stylePacks', pack.id, true)
    return pack
  } finally {
    await prepared.cleanup()
  }
}

export async function setUserExtensionEnabled(kind, id, enabled) {
  assertExtensionKind(kind)
  assertId(id)
  if (kind === 'skills' && !(await pathExists(path.join(userSkillsRoot(), id)))) {
    throw createRuntimeError('USER_EXTENSION_NOT_FOUND', `用户 Skill 不存在：${id}`)
  }
  if (kind === 'stylePacks' && !(await pathExists(path.join(userStylePacksRoot(), id)))) {
    throw createRuntimeError('USER_EXTENSION_NOT_FOUND', `用户 Style Pack 不存在：${id}`)
  }
  await updateRegistry(kind, id, Boolean(enabled))
  return true
}

export async function removeUserExtension(kind, id) {
  assertExtensionKind(kind)
  assertId(id)
  const root = kind === 'skills' ? userSkillsRoot() : userStylePacksRoot()
  await fs.rm(path.join(root, id), { recursive: true, force: true })
  const registry = await readRegistry()
  delete registry[kind][id]
  await writeRegistry(registry)
  return true
}

export async function listEnabledUserSkillRoots() {
  const registry = await readRegistry()
  const skills = await listUserSkills()
  return skills
    .filter((skill) => skill.enabled && registry.skills[skill.id] !== false)
    .map((skill) => path.join(userSkillsRoot(), skill.id))
}

function sanitizeStylePackForRuntime(pack) {
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    version: pack.version,
    colors: pack.colors,
    typography: pack.typography,
    surfaces: pack.surfaces,
    imagery: pack.imagery,
    constraints: pack.constraints,
    prompt: pack.prompt,
  }
}

async function readStylePack(root) {
  const stylePath = path.join(root, 'style.json')
  const manifestPath = path.join(root, 'manifest.json')
  const style = JSON.parse(await fs.readFile(stylePath, 'utf8'))
  let manifest = {}
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  let prompt = ''
  try {
    prompt = (await fs.readFile(path.join(root, 'prompt.md'), 'utf8')).trim().slice(0, 8000)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return normalizeStylePack({ ...manifest, ...style, prompt: style.prompt || prompt })
}

function normalizeStylePack(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createRuntimeError('STYLE_PACK_INVALID', 'Style Pack 必须是 JSON 对象。')
  }
  const id = String(value.id || '').trim()
  assertId(id)
  const name = String(value.name || '').trim()
  if (!name) throw createRuntimeError('STYLE_PACK_INVALID', 'Style Pack 缺少 name。')
  const colors = normalizeColors(value.colors)
  if (Object.keys(colors).length < 2) {
    throw createRuntimeError('STYLE_PACK_INVALID', 'Style Pack 至少需要两个有效颜色。')
  }
  return {
    id,
    name,
    version: String(value.version || '1.0.0').slice(0, 32),
    description: String(value.description || '')
      .trim()
      .slice(0, 500),
    colors,
    typography: plainObject(value.typography),
    surfaces: plainObject(value.surfaces),
    imagery: plainObject(value.imagery),
    constraints: Array.isArray(value.constraints)
      ? value.constraints
          .filter((item) => typeof item === 'string')
          .map((item) => item.slice(0, 300))
          .slice(0, 20)
      : [],
    prompt: String(value.prompt || '')
      .trim()
      .slice(0, 8000),
  }
}

function normalizeColors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([, color]) =>
          typeof color === 'string' && /^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(color.trim()),
      )
      .slice(0, 12),
  )
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? JSON.parse(JSON.stringify(value))
    : {}
}

async function prepareImportSource(sourcePath, prefix) {
  const stat = await fs.stat(sourcePath)
  if (stat.isDirectory()) return { root: sourcePath, cleanup: async () => {} }
  if (stat.size > MAX_ARCHIVE_BYTES || path.extname(sourcePath).toLowerCase() !== '.zip') {
    throw createRuntimeError(
      'EXTENSION_ARCHIVE_INVALID',
      '扩展必须是目录、JSON Style Pack 或不超过 8MB 的 ZIP。',
    )
  }
  const temporary = await createTemporaryRoot(prefix)
  const zip = new AdmZip(sourcePath)
  const entries = zip.getEntries()
  if (entries.length > MAX_FILES)
    throw createRuntimeError('EXTENSION_ARCHIVE_TOO_LARGE', '扩展文件数超过限制。')
  let total = 0
  for (const entry of entries) {
    const normalized = path.posix.normalize(entry.entryName.replaceAll('\\', '/'))
    if (normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
      throw createRuntimeError('EXTENSION_ARCHIVE_UNSAFE', 'ZIP 包含越界路径。')
    }
    if (entry.isDirectory) continue
    const data = entry.getData()
    total += data.length
    if (total > MAX_TOTAL_BYTES)
      throw createRuntimeError('EXTENSION_ARCHIVE_TOO_LARGE', '扩展解压后超过 12MB。')
    const target = path.join(temporary, normalized)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, data)
  }
  return {
    root: temporary,
    cleanup: () => fs.rm(temporary, { recursive: true, force: true }),
  }
}

async function assertSafeTree(root, options) {
  let count = 0
  let total = 0
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      count += 1
      if (count > MAX_FILES) throw createRuntimeError('EXTENSION_TOO_LARGE', '扩展文件数超过限制。')
      const target = path.join(directory, entry.name)
      if (entry.isSymbolicLink())
        throw createRuntimeError('EXTENSION_UNSAFE', '扩展不允许包含符号链接。')
      if (entry.isDirectory()) {
        if (!options.allowRuntime && ['runtime', 'scripts'].includes(entry.name)) {
          throw createRuntimeError(
            'USER_SKILL_EXECUTABLE_FORBIDDEN',
            '用户扩展暂不允许包含 Runtime 或脚本。',
          )
        }
        await visit(target)
        continue
      }
      const stat = await fs.stat(target)
      total += stat.size
      if (total > MAX_TOTAL_BYTES)
        throw createRuntimeError('EXTENSION_TOO_LARGE', '扩展内容超过 12MB。')
      if (/\.(?:js|mjs|cjs|node|sh|py|rb|exe|dylib)$/i.test(entry.name)) {
        throw createRuntimeError(
          'USER_SKILL_EXECUTABLE_FORBIDDEN',
          '用户扩展暂不允许包含可执行文件。',
        )
      }
    }
  }
  await visit(root)
}

async function locatePackageRoot(root, marker) {
  if (await pathExists(path.join(root, marker))) return root
  const directories = (await fs.readdir(root, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory(),
  )
  if (
    directories.length === 1 &&
    (await pathExists(path.join(root, directories[0].name, marker)))
  ) {
    return path.join(root, directories[0].name)
  }
  throw createRuntimeError('EXTENSION_PACKAGE_INVALID', `扩展包缺少 ${marker}。`)
}

async function locateStylePackRoot(root) {
  if (await pathExists(path.join(root, 'style.json'))) return root
  const directories = (await fs.readdir(root, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory(),
  )
  if (
    directories.length === 1 &&
    (await pathExists(path.join(root, directories[0].name, 'style.json')))
  ) {
    return path.join(root, directories[0].name)
  }
  throw createRuntimeError('STYLE_PACK_INVALID', 'Style Pack 缺少 style.json。')
}

async function replaceDirectory(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await fs.rm(temporary, { recursive: true, force: true })
  await fs.cp(source, temporary, { recursive: true, errorOnExist: false })
  await fs.rm(target, { recursive: true, force: true })
  await fs.rename(temporary, target)
}

async function builtInSkillExists(id) {
  const root = runtimeConfig.isPackaged
    ? path.join(runtimeConfig.resourcesPath, 'skills')
    : path.join(runtimeConfig.appRoot, '.agents', 'skills')
  return pathExists(path.join(root, id, 'SKILL.md'))
}

async function assertNoBuiltInStyleConflict(id) {
  if (await pathExists(path.join(builtInStylePacksRoot(), id, 'style.json'))) {
    throw createRuntimeError('STYLE_PACK_NAME_CONFLICT', `用户 Style Pack 不能覆盖内置风格：${id}`)
  }
}

function builtInStylePacksRoot() {
  return runtimeConfig.isPackaged
    ? path.join(runtimeConfig.resourcesPath, 'style-packs')
    : path.join(runtimeConfig.appRoot, 'style-packs')
}

function extensionsRoot() {
  return path.join(runtimeConfig.userDataPath, 'extensions')
}
function userSkillsRoot() {
  return path.join(extensionsRoot(), 'skills', 'installed')
}
function userStylePacksRoot() {
  return path.join(extensionsRoot(), 'style-packs', 'installed')
}
function registryPath() {
  return path.join(extensionsRoot(), 'registry.json')
}

async function createTemporaryRoot(prefix) {
  const root = path.join(extensionsRoot(), '.tmp')
  await fs.mkdir(root, { recursive: true })
  return fs.mkdtemp(path.join(root, `${prefix}-`))
}

async function listDirectories(root, reader) {
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const values = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => reader(path.join(root, entry.name), entry.name).catch(() => undefined)),
  )
  return values.filter(Boolean)
}

async function readRegistry() {
  try {
    const value = JSON.parse(await fs.readFile(registryPath(), 'utf8'))
    return {
      version: 1,
      skills: plainObject(value.skills),
      stylePacks: plainObject(value.stylePacks),
    }
  } catch {
    return { version: 1, skills: {}, stylePacks: {} }
  }
}

async function updateRegistry(kind, id, enabled) {
  const registry = await readRegistry()
  registry[kind][id] = enabled
  await writeRegistry(registry)
}

async function writeRegistry(registry) {
  await fs.mkdir(extensionsRoot(), { recursive: true })
  const target = registryPath()
  const temporary = `${target}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temporary, JSON.stringify(registry, null, 2), 'utf8')
  await fs.rename(temporary, target)
}

function parseSkillFrontmatter(content) {
  const match = String(content).match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) throw createRuntimeError('SKILL_INVALID', 'SKILL.md 缺少 YAML frontmatter。')
  const name = readYamlValue(match[1], 'name')
  const description = readYamlValue(match[1], 'description')
  assertId(name)
  if (!description) throw createRuntimeError('SKILL_INVALID', 'Skill description 为空。')
  return { name, description: description.slice(0, 1000) }
}

function readYamlValue(source, key) {
  return (
    source
      .match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, '') || ''
  )
}

function assertExtensionKind(kind) {
  if (!['skills', 'stylePacks'].includes(kind))
    throw createRuntimeError('EXTENSION_KIND_INVALID', '扩展类型无效。')
}

function assertId(id) {
  if (!EXTENSION_ID.test(String(id || '')))
    throw createRuntimeError('EXTENSION_ID_INVALID', `扩展 ID 无效：${id || '空'}`)
}

async function pathExists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}
