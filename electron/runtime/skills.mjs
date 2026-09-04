import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { formatSkillInvocation, formatSkillsForSystemPrompt } from '@earendil-works/pi-agent-core'
import { createRuntimeError } from './providers.mjs'
import {
  configureComponentPackRuntime,
  loadComponentFromPrompt as loadComponentFromPackPrompt,
  loadComponentsFromPrompt as loadComponentsFromPackPrompt,
  resolveComponentReference as resolvePackComponentReference,
  resolveComponentPackSkillNames,
} from './component-packs.mjs'
import { configureUserExtensions, listEnabledUserSkillRoots } from './user-extensions.mjs'

let runtimeConfig = {
  appRoot: process.cwd(),
  resourcesPath: process.resourcesPath || process.cwd(),
  userDataPath: process.cwd(),
  isPackaged: false,
}
let cachedSkills
const MAX_SKILL_BYTES = 64 * 1024
const MAX_SKILL_RESOURCE_BYTES = 32 * 1024

export function configureSkillRuntime(config = {}) {
  runtimeConfig = {
    appRoot: config.appRoot || runtimeConfig.appRoot,
    resourcesPath: config.resourcesPath || runtimeConfig.resourcesPath,
    userDataPath: config.userDataPath || runtimeConfig.userDataPath,
    isPackaged: Boolean(config.isPackaged),
  }
  cachedSkills = undefined
  configureComponentPackRuntime(runtimeConfig)
  configureUserExtensions(runtimeConfig)
}

export async function listSkills(options = {}) {
  if (cachedSkills && !options.refresh) return cachedSkills
  const skills = []
  const roots = [
    ...(await listBuiltInSkillRoots()).map((root) => ({ root, source: 'built-in' })),
    ...(await listEnabledUserSkillRoots()).map((root) => ({ root, source: 'user' })),
  ]
  for (const item of roots) {
    const folderName = path.basename(item.root)
    try {
      if (skills.some((skill) => skill.name === folderName)) {
        console.warn('[runtime] duplicate user skill ignored', { folder: folderName })
        continue
      }
      skills.push(await readSkill(item.root, folderName, item.source))
    } catch (error) {
      console.warn('[runtime] skill ignored', {
        folder: folderName,
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
    source: skill.source,
    enabled: true,
    executable: Boolean(skill.runtime),
  }))
}

export async function buildSkillCatalogPrompt() {
  const skills = await listSkills()
  return formatSkillsForSystemPrompt(skills.map(toPiSkill))
}

export async function activateSkill(name, instructions = '') {
  const skill = await findSkill(name)
  return {
    name: skill.name,
    content: formatSkillInvocation(toPiSkill(skill), instructions),
    tools: (skill.runtime?.tools ?? []).map((tool) => tool.name),
  }
}

export async function readSkillResource(name, relativePath) {
  const skill = await findSkill(name)
  const normalized = String(relativePath || '').replace(/^\.\//, '')
  if (!/^(?:references|assets)\//.test(normalized)) {
    throw createRuntimeError(
      'SKILL_RESOURCE_FORBIDDEN',
      'Skill 只能读取 references 或 assets 目录。',
    )
  }
  const target = resolveInside(skill.root, normalized)
  const stat = await fs.stat(target)
  if (!stat.isFile() || stat.size > MAX_SKILL_RESOURCE_BYTES) {
    throw createRuntimeError('SKILL_RESOURCE_INVALID', 'Skill 资源不是文件或超过 32KB。')
  }
  if (!/\.(?:md|txt|json|ya?ml)$/i.test(target)) {
    throw createRuntimeError('SKILL_RESOURCE_UNSUPPORTED', '当前只允许读取文本型 Skill 资源。')
  }
  return { name, path: normalized, content: await fs.readFile(target, 'utf8') }
}

export async function resolveSkillNames(question, requestedNames = [], componentReferences = []) {
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
  for (const packSkillName of await resolveComponentPackSkillNames(question)) {
    if (byName.has(packSkillName) && !selected.includes(packSkillName)) selected.push(packSkillName)
  }
  if (
    componentReferences.length &&
    byName.has('component-design-assets') &&
    !selected.includes('component-design-assets')
  ) {
    selected.push('component-design-assets')
  }
  return selected.slice(0, 4)
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

export function invalidateSkillCache() {
  cachedSkills = undefined
}

async function listBuiltInSkillRoots() {
  const root = getSkillsRoot()
  try {
    return (await fs.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => path.join(root, entry.name))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

export async function loadComponentFromPrompt(prompt, options = {}) {
  return loadComponentFromPackPrompt(prompt, options)
}

export async function loadComponentsFromPrompt(prompt, options = {}) {
  return loadComponentsFromPackPrompt(prompt, options)
}

export async function resolveComponentReference(reference, options = {}) {
  return resolvePackComponentReference(reference, options)
}

async function readSkill(skillRoot, folderName, source = 'built-in') {
  const skillFile = path.join(skillRoot, 'SKILL.md')
  const skillStat = await fs.stat(skillFile)
  if (!skillStat.isFile() || skillStat.size > MAX_SKILL_BYTES) {
    throw new Error('SKILL.md 不是文件或超过 64KB。')
  }
  const content = await fs.readFile(skillFile, 'utf8')
  const frontmatter = parseSkillFrontmatter(content)
  if (frontmatter.name !== folderName) {
    throw new Error(`Skill 名称与目录不一致：${frontmatter.name} != ${folderName}`)
  }
  const runtimeManifestPath = path.join(skillRoot, 'runtime', 'manifest.json')
  let runtime
  try {
    runtime = validateRuntimeManifest(
      JSON.parse(await fs.readFile(runtimeManifestPath, 'utf8')),
      skillRoot,
    )
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    root: skillRoot,
    skillFile,
    content,
    runtime,
    source,
  }
}

async function findSkill(name) {
  const skill = (await listSkills()).find((item) => item.name === name)
  if (!skill) throw createRuntimeError('SKILL_NOT_FOUND', `未找到 Skill：${name}`)
  return skill
}

function toPiSkill(skill) {
  return {
    name: skill.name,
    description: skill.description,
    content: skill.content,
    filePath: skill.skillFile,
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
  const tools = Array.isArray(manifest.tools)
    ? manifest.tools.map((tool) => {
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
      })
    : []
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
