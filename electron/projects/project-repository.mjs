import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

let projectsRoot
let assetsRoot
const projectSaveQueues = new Map()

export function configureProjectRepository(userDataRoot) {
  projectsRoot = path.join(userDataRoot, 'projects')
  assetsRoot = path.join(userDataRoot, 'content-assets')
}

export async function saveProjectSnapshot(input) {
  assertConfigured()
  const snapshot = normalizeSnapshot(input)
  return enqueueProjectSave(snapshot.projectId, async () => {
    const directory = getProjectDirectory(snapshot.projectId)
    await fs.mkdir(directory, { recursive: true })
    const filePath = path.join(directory, 'project.json')
    const existing = await readJson(filePath)
    const now = new Date().toISOString()
    const record = await externalizeDataAssets({
      ...snapshot,
      schemaVersion: 2,
      createdAt: existing?.createdAt || snapshot.createdAt || now,
      updatedAt: now,
    })
    await writeJsonAtomic(filePath, record)
    await saveProjectVersion(directory, record)
    return summarizeProject(record)
  })
}

function enqueueProjectSave(projectId, operation) {
  const previous = projectSaveQueues.get(projectId) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  projectSaveQueues.set(projectId, current)
  return current.finally(() => {
    if (projectSaveQueues.get(projectId) === current) projectSaveQueues.delete(projectId)
  })
}

export async function loadProjectSnapshot(projectId) {
  assertConfigured()
  const directory = getProjectDirectory(normalizeId(projectId))
  const record =
    (await readJson(path.join(directory, 'project.json'))) ??
    (await readLatestProjectVersion(directory))
  if (!record || ![1, 2].includes(record.schemaVersion) || record.projectId !== projectId)
    return undefined
  return normalizeSnapshot(await hydrateDataAssets(migrateProjectRecord(record)))
}

export async function listProjectVersions(projectId) {
  assertConfigured()
  const directory = path.join(getProjectDirectory(normalizeId(projectId)), 'versions')
  try {
    const files = (await fs.readdir(directory)).filter((file) => file.endsWith('.json'))
    const versions = await Promise.all(
      files.map(async (file) => {
        const record = await readJson(path.join(directory, file))
        return record
          ? {
              id: file.replace(/\.json$/, ''),
              documentVersion: record.document?.version ?? 0,
              updatedAt: record.updatedAt,
            }
          : undefined
      }),
    )
    return versions
      .filter(Boolean)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

export async function loadProjectVersion(projectId, versionId) {
  assertConfigured()
  const safeVersionId = String(versionId || '')
  if (!/^[a-z0-9-]+$/i.test(safeVersionId)) throw new Error('项目版本 ID 无效。')
  const record = await readJson(
    path.join(getProjectDirectory(normalizeId(projectId)), 'versions', `${safeVersionId}.json`),
  )
  return record
    ? normalizeSnapshot(await hydrateDataAssets(migrateProjectRecord(record)))
    : undefined
}

export async function listProjects() {
  assertConfigured()
  let entries = []
  try {
    entries = await fs.readdir(projectsRoot, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const projects = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const record = await readJson(path.join(projectsRoot, entry.name, 'project.json'))
    if ([1, 2].includes(record?.schemaVersion) && typeof record.projectId === 'string') {
      projects.push(summarizeProject(record))
    }
  }
  return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export async function deleteProject(projectId) {
  assertConfigured()
  await fs.rm(getProjectDirectory(normalizeId(projectId)), { recursive: true, force: true })
  return true
}

function normalizeSnapshot(input) {
  if (!input || typeof input !== 'object') throw new Error('项目快照为空。')
  const projectId = normalizeId(input.projectId)
  if (!input.document || typeof input.document !== 'object')
    throw new Error('项目缺少 DesignDocument。')
  return {
    schemaVersion: 2,
    projectId,
    document: { ...input.document, id: projectId },
    chatThreads: Array.isArray(input.chatThreads) ? input.chatThreads : [],
    activeChatThreadId:
      typeof input.activeChatThreadId === 'string'
        ? input.activeChatThreadId
        : 'panel-thread-default',
    mutationLedger: normalizeMutationLedger(input.mutationLedger),
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : input.document.createdAt,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : input.document.updatedAt,
  }
}

function normalizeMutationLedger(value) {
  if (!Array.isArray(value)) return []
  const byDelivery = new Map()
  for (const item of value) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.deliveryId !== 'string' ||
      typeof item.runId !== 'string' ||
      typeof item.stepId !== 'string' ||
      typeof item.kind !== 'string' ||
      item.observation?.status !== 'success'
    )
      continue
    byDelivery.set(item.deliveryId, item)
  }
  return Array.from(byDelivery.values()).slice(-500)
}

function summarizeProject(record) {
  return {
    projectId: record.projectId,
    title: record.document?.title || '未命名项目',
    artboardCount: Array.isArray(record.document?.artboards) ? record.document.artboards.length : 0,
    updatedAt: record.updatedAt,
  }
}

function normalizeId(value) {
  const id = String(value || '').trim()
  if (!id || id.length > 200) throw new Error('项目 ID 无效。')
  return id
}

function getProjectDirectory(projectId) {
  const digest = crypto.createHash('sha256').update(projectId).digest('hex')
  return path.join(projectsRoot, digest)
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    if (error instanceof SyntaxError) {
      await fs.rename(filePath, `${filePath}.corrupt-${Date.now()}`).catch(() => undefined)
      return undefined
    }
    throw error
  }
}

function migrateProjectRecord(record) {
  if (record.schemaVersion === 2) return record
  return {
    ...record,
    schemaVersion: 2,
    document: {
      ...record.document,
      componentInstances: record.document?.componentInstances ?? {},
      assets: record.document?.assets ?? [],
    },
    mutationLedger: normalizeMutationLedger(record.mutationLedger),
  }
}

async function externalizeDataAssets(value) {
  if (typeof value === 'string' && value.startsWith('data:')) {
    const parsed = parseDataUri(value)
    if (!parsed) return value
    const hash = crypto.createHash('sha256').update(parsed.data).digest('hex')
    const directory = path.join(assetsRoot, hash.slice(0, 2))
    const filePath = path.join(directory, hash)
    await fs.mkdir(directory, { recursive: true })
    try {
      await fs.access(filePath)
    } catch {
      await writeBufferAtomic(filePath, parsed.data)
    }
    return { __assetRef: `sha256:${hash}`, mime: parsed.mime, bytes: parsed.data.length }
  }
  if (Array.isArray(value)) return Promise.all(value.map(externalizeDataAssets))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    await Promise.all(
      Object.entries(value).map(async ([key, child]) => [key, await externalizeDataAssets(child)]),
    ),
  )
}

async function hydrateDataAssets(value) {
  if (Array.isArray(value)) return Promise.all(value.map(hydrateDataAssets))
  if (!value || typeof value !== 'object') return value
  if (typeof value.__assetRef === 'string' && value.__assetRef.startsWith('sha256:')) {
    const hash = value.__assetRef.slice('sha256:'.length)
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('项目包含无效素材引用。')
    const data = await fs.readFile(path.join(assetsRoot, hash.slice(0, 2), hash))
    return `data:${value.mime || 'application/octet-stream'};base64,${data.toString('base64')}`
  }
  return Object.fromEntries(
    await Promise.all(
      Object.entries(value).map(async ([key, child]) => [key, await hydrateDataAssets(child)]),
    ),
  )
}

function parseDataUri(value) {
  const match = value.match(/^data:([^;,]+)(;base64)?,(.*)$/s)
  if (!match) return undefined
  return {
    mime: match[1],
    data: match[2]
      ? Buffer.from(match[3], 'base64')
      : Buffer.from(decodeURIComponent(match[3]), 'utf8'),
  }
}

async function writeBufferAtomic(filePath, data) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temporaryPath, data)
  await fs.rename(temporaryPath, filePath)
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temporaryPath, JSON.stringify(value), 'utf8')
  await fs.rename(temporaryPath, filePath)
}

async function saveProjectVersion(directory, record) {
  const versionDirectory = path.join(directory, 'versions')
  await fs.mkdir(versionDirectory, { recursive: true })
  const hash = crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex').slice(0, 12)
  const versionId = `v${record.document?.version ?? 0}-${hash}`
  await writeJsonAtomic(path.join(versionDirectory, `${versionId}.json`), record)
  const files = (await fs.readdir(versionDirectory)).filter((file) => file.endsWith('.json')).sort()
  for (const staleFile of files.slice(0, Math.max(0, files.length - 30))) {
    await fs.unlink(path.join(versionDirectory, staleFile)).catch(() => undefined)
  }
}

async function readLatestProjectVersion(directory) {
  const versions = path.join(directory, 'versions')
  try {
    const files = (await fs.readdir(versions))
      .filter((file) => file.endsWith('.json'))
      .sort()
      .reverse()
    for (const file of files) {
      const record = await readJson(path.join(versions, file))
      if (record) return record
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return undefined
}

function assertConfigured() {
  if (!projectsRoot || !assetsRoot) throw new Error('Project Repository 尚未配置。')
}
