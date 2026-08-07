import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRuntimeError } from './providers.mjs'

let runtimeConfig = {
  appRoot: process.cwd(),
  resourcesPath: process.resourcesPath || process.cwd(),
  isPackaged: false,
}
let cachedSkills

export function configureSkillRuntime(config = {}) {
  runtimeConfig = {
    appRoot: config.appRoot || runtimeConfig.appRoot,
    resourcesPath: config.resourcesPath || runtimeConfig.resourcesPath,
    isPackaged: Boolean(config.isPackaged),
  }
  cachedSkills = undefined
}

export async function listSkills(options = {}) {
  if (cachedSkills && !options.refresh) return cachedSkills
  const root = getSkillsRoot()
  let entries = []
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const skills = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const skillRoot = path.join(root, entry.name)
    try {
      skills.push(await readSkill(skillRoot, entry.name))
    } catch (error) {
      console.warn('[runtime] skill ignored', {
        folder: entry.name,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
  validateUniqueToolNames(skills)
  cachedSkills = skills.sort((left, right) => left.name.localeCompare(right.name))
  return cachedSkills
}

export async function listPublicSkills() {
  const skills = await listSkills()
  return skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    triggers: skill.runtime?.triggers ?? [],
    tools: (skill.runtime?.tools ?? []).map((tool) => tool.name),
  }))
}

export async function resolveSkillNames(question, requestedNames = []) {
  const skills = await listSkills()
  const byName = new Map(skills.map((skill) => [skill.name, skill]))
  const selected = []

  for (const requestedName of requestedNames ?? []) {
    if (!byName.has(requestedName)) {
      throw createRuntimeError('SKILL_NOT_FOUND', `未找到 Skill：${requestedName}`)
    }
    if (!selected.includes(requestedName)) selected.push(requestedName)
  }

  const normalizedQuestion = String(question || '').toLowerCase()
  for (const skill of skills) {
    if (selected.includes(skill.name)) continue
    if (normalizedQuestion.includes(`$${skill.name.toLowerCase()}`)) {
      selected.push(skill.name)
      continue
    }
    const triggers = skill.runtime?.triggers ?? []
    if (triggers.some((trigger) => normalizedQuestion.includes(String(trigger).toLowerCase()))) {
      selected.push(skill.name)
    }
  }
  return selected.slice(0, 4)
}

export async function stageSkills(jobDirectory, skillNames = []) {
  if (!skillNames.length) return []
  const skills = await listSkills()
  const byName = new Map(skills.map((skill) => [skill.name, skill]))
  const destinationRoot = path.join(jobDirectory, 'skills')
  await fs.mkdir(destinationRoot, { recursive: true })
  const staged = []

  for (const name of skillNames) {
    const skill = byName.get(name)
    if (!skill) throw createRuntimeError('SKILL_NOT_FOUND', `未找到 Skill：${name}`)
    const destination = path.join(destinationRoot, name)
    await fs.cp(skill.root, destination, { recursive: true, force: true, dereference: false })
    staged.push({
      name,
      description: skill.description,
      root: destination,
      skillFile: path.join(destination, 'SKILL.md'),
    })
  }
  return staged
}

export function buildSkillPrompt(stagedSkills = []) {
  if (!stagedSkills.length) return ''
  return [
    '【本任务必须使用的项目 Skill】',
    ...stagedSkills.flatMap((skill, index) => [
      `${index + 1}. ${skill.name}`,
      `必须先完整读取：${skill.skillFile}`,
      '按照 SKILL.md 的渐进式说明按需读取 references，并优先使用其 scripts 或 Runtime Tools。',
    ]),
    'Skill 是任务执行规范；不得只复述 Skill 内容，必须按其中流程完成实际任务。',
  ].join('\n')
}

export async function executeSkillTool(toolName, input) {
  const skills = await listSkills()
  for (const skill of skills) {
    const tool = (skill.runtime?.tools ?? []).find((item) => item.name === toolName)
    if (!tool) continue
    const modulePath = resolveInside(skill.root, tool.module)
    const module = await importModule(modulePath)
    const execute = module[tool.export]
    if (typeof execute !== 'function') {
      throw createRuntimeError(
        'SKILL_TOOL_INVALID',
        `Skill Tool 导出不存在：${toolName} -> ${tool.export}`,
      )
    }
    return execute(input, { skillRoot: skill.root, skill })
  }
  throw createRuntimeError('SKILL_TOOL_NOT_FOUND', `未找到 Skill Tool：${toolName}`)
}

export function getSkillsRoot() {
  return runtimeConfig.isPackaged
    ? path.join(runtimeConfig.resourcesPath, 'skills')
    : path.join(runtimeConfig.appRoot, '.agents', 'skills')
}

export function getComponentsJsonRoot() {
  return runtimeConfig.isPackaged
    ? path.join(runtimeConfig.resourcesPath, 'componentsJson')
    : path.join(runtimeConfig.appRoot, 'componentsJson')
}

export async function loadComponentFromPrompt(prompt) {
  const candidates = await loadComponentsFromPrompt(prompt)
  if (candidates.length !== 1) {
    throw createRuntimeError('COMPONENT_MATCH_AMBIGUOUS', '提示词匹配到多个组件，请明确指定一个组件名称。')
  }
  return candidates[0]
}

export async function loadComponentsFromPrompt(prompt, options = {}) {
  const root = getComponentsJsonRoot()
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    throw createRuntimeError('COMPONENT_REGISTRY_MISSING', '应用中没有可用的组件 JSON 目录。')
  }
  const normalizedPrompt = String(prompt || '').toLowerCase()
  const candidates = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) continue
    const filePath = path.join(root, entry.name)
    try {
      const source = await fs.readFile(filePath, 'utf8')
      const component = JSON.parse(source)
      const componentName = String(component?.name || path.basename(entry.name, '.json'))
      const aliases = [componentName, entry.name, path.basename(entry.name, '.json')]
        .map((value) => value.toLowerCase())
      if (aliases.some((alias) => normalizedPrompt.includes(alias))) {
        candidates.push({ component, source, fileName: entry.name })
      }
    } catch (error) {
      console.warn('[runtime] component json ignored', {
        file: entry.name,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (!candidates.length) {
    const available = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => path.basename(entry.name, '.json'))
    throw createRuntimeError(
      'COMPONENT_NOT_FOUND',
      `请明确指定组件名称。当前可用组件：${available.join('、') || '无'}。`,
    )
  }
  return Promise.all(candidates.map(async (selected) => {
    const structural = isStructuralComponent(selected.component)
    if (!selected.component.thumbnail && !(options.allowStructuralComponents && structural)) {
      throw createRuntimeError(
        'COMPONENT_THUMBNAIL_MISSING',
        `${selected.component.name} 缺少 thumbnail，无法可靠生成组件原型。`,
      )
    }
    const thumbnailUpload = selected.component.thumbnail
      ? await loadTrustedComponentThumbnail(selected.component.thumbnail, selected.component.name)
      : undefined
    return { ...selected, thumbnailUpload }
  }))
}

function isStructuralComponent(component) {
  const name = String(component?.name || '')
  const label = String(component?.label || '')
  return /page|layout|container|页面|容器|布局/i.test(`${name} ${label}`)
}

async function loadTrustedComponentThumbnail(value, componentName) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw createRuntimeError('COMPONENT_THUMBNAIL_INVALID', `${componentName} 的 thumbnail URL 无效。`)
  }
  if (!isTrustedThumbnailUrl(url)) {
    throw createRuntimeError(
      'COMPONENT_THUMBNAIL_UNTRUSTED',
      `${componentName} 的 thumbnail 不在允许的图片域中。`,
    )
  }

  let response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  } catch (error) {
    throw createRuntimeError(
      'COMPONENT_THUMBNAIL_LOAD_FAILED',
      `${componentName} 的 thumbnail 下载失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) {
    throw createRuntimeError(
      'COMPONENT_THUMBNAIL_LOAD_FAILED',
      `${componentName} 的 thumbnail 下载失败：HTTP ${response.status}。`,
    )
  }
  if (!isTrustedThumbnailUrl(new URL(response.url))) {
    throw createRuntimeError(
      'COMPONENT_THUMBNAIL_UNTRUSTED',
      `${componentName} 的 thumbnail 重定向到了非可信图片域。`,
    )
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) {
    throw createRuntimeError('COMPONENT_THUMBNAIL_INVALID', `${componentName} 的 thumbnail 大小无效。`)
  }
  const mime = normalizeThumbnailMime(response.headers.get('content-type'), url.pathname)
  return {
    type: 'file',
    name: `${componentName}-thumbnail.${extensionForThumbnailMime(mime)}`,
    mime,
    role: 'prototype',
    data: `data:${mime};base64,${bytes.toString('base64')}`,
  }
}

function isTrustedThumbnailUrl(url) {
  const hostname = url.hostname.toLowerCase()
  return url.protocol === 'https:' && (
    hostname === 'bilibili.com' ||
    hostname.endsWith('.bilibili.com') ||
    hostname === 'hdslb.com' ||
    hostname.endsWith('.hdslb.com')
  )
}

function normalizeThumbnailMime(contentType, pathname) {
  const value = String(contentType || '').split(';')[0].trim().toLowerCase()
  if (['image/png', 'image/jpeg', 'image/webp'].includes(value)) return value
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

async function readSkill(skillRoot, folderName) {
  const skillFile = path.join(skillRoot, 'SKILL.md')
  const content = await fs.readFile(skillFile, 'utf8')
  const frontmatter = parseSkillFrontmatter(content)
  if (frontmatter.name !== folderName) {
    throw new Error(`Skill 名称与目录不一致：${frontmatter.name} != ${folderName}`)
  }
  const runtimeManifestPath = path.join(skillRoot, 'runtime', 'manifest.json')
  let runtime
  try {
    runtime = validateRuntimeManifest(JSON.parse(await fs.readFile(runtimeManifestPath, 'utf8')), skillRoot)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    root: skillRoot,
    skillFile,
    runtime,
  }
}

function parseSkillFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) throw new Error('SKILL.md 缺少 YAML frontmatter。')
  const name = readSingleLineYamlValue(match[1], 'name')
  const description = readSingleLineYamlValue(match[1], 'description')
  if (!name || !/^[a-z0-9-]+$/.test(name)) throw new Error('Skill name 无效。')
  if (!description) throw new Error('Skill description 为空。')
  return { name, description }
}

function readSingleLineYamlValue(source, key) {
  const match = source.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  if (!match) return ''
  return match[1].trim().replace(/^['"]|['"]$/g, '')
}

function validateRuntimeManifest(manifest, skillRoot) {
  if (!manifest || typeof manifest !== 'object') throw new Error('runtime/manifest.json 格式错误。')
  const triggers = Array.isArray(manifest.triggers)
    ? manifest.triggers.filter((item) => typeof item === 'string' && item.trim()).slice(0, 32)
    : []
  const tools = Array.isArray(manifest.tools) ? manifest.tools.map((tool) => {
    if (
      !tool ||
      typeof tool.name !== 'string' ||
      typeof tool.module !== 'string' ||
      typeof tool.export !== 'string'
    ) {
      throw new Error('Skill runtime tool 配置错误。')
    }
    resolveInside(skillRoot, tool.module)
    return {
      name: tool.name,
      description: typeof tool.description === 'string' ? tool.description : '',
      module: tool.module,
      export: tool.export,
    }
  }) : []
  return { version: manifest.version || 1, triggers, tools }
}

function validateUniqueToolNames(skills) {
  const owners = new Map()
  for (const skill of skills) {
    for (const tool of skill.runtime?.tools ?? []) {
      const owner = owners.get(tool.name)
      if (owner) {
        throw createRuntimeError(
          'SKILL_TOOL_CONFLICT',
          `Skill Tool 名称冲突：${tool.name} 同时由 ${owner} 和 ${skill.name} 声明。`,
        )
      }
      owners.set(tool.name, skill.name)
    }
  }
}

function resolveInside(root, relativePath) {
  const target = path.resolve(root, relativePath)
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    if (!relative) return target
    throw new Error(`Skill 路径越界：${relativePath}`)
  }
  return target
}

async function importModule(modulePath) {
  const stat = await fs.stat(modulePath)
  return import(`${pathToFileURL(modulePath).href}?mtime=${stat.mtimeMs}`)
}
