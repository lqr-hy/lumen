import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { configureArtifactRepository } from '../artifacts/artifact-repository.mjs'

let storageRoot = path.join(os.homedir(), '.ai-campaign-page-studio', 'agent-sessions')
let checkpointsRoot = path.join(os.homedir(), '.ai-campaign-page-studio', 'agent-checkpoints')
let sessionAssetsRoot = path.join(os.homedir(), '.ai-campaign-page-studio', 'agent-assets')

export function configureAgentSessionStore(root) {
  if (typeof root === 'string' && root.trim()) {
    storageRoot = path.join(root, 'agent-sessions')
    checkpointsRoot = path.join(root, 'agent-checkpoints')
    sessionAssetsRoot = path.join(root, 'agent-assets')
    configureArtifactRepository(root)
  }
}

export async function loadAgentSession(sessionId) {
  const filePath = getSessionPath(sessionId)
  try {
    const content = await fs.readFile(filePath, 'utf8')
    const session = JSON.parse(content)
    if (session?.id === sessionId) {
      const hydrated = await hydrateSessionReferences(session)
      // Electron 重启后，内存中的 activeSessions 已丢失；持久化的 running
      // 只能表示上次进程中断，不能被当作仍有 CLI 子进程在执行。
      if (hydrated.status === 'running') {
        hydrated.status = 'failed'
        hydrated.lastError = {
          code: 'AGENT_INTERRUPTED_BY_RESTART',
          message: '应用在任务执行期间重启，任务已暂停，可点击“继续”恢复。',
        }
        hydrated.plan = (hydrated.plan ?? []).map((step) => step.status === 'running'
          ? { ...step, status: 'failed', error: '应用重启导致任务中断。' }
          : step)
        await saveAgentSession(hydrated)
      }
      return hydrated
    }
  } catch {
    // A missing or invalid checkpoint starts a clean session.
  }
  return createAgentSession(sessionId)
}

export async function saveAgentSession(session) {
  await fs.mkdir(storageRoot, { recursive: true })
  const filePath = getSessionPath(session.id)
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const persistedSession = await externalizeSessionReferences(session)
  const serialized = JSON.stringify(persistedSession)
  if (Buffer.byteLength(serialized) > 32 * 1024 * 1024) {
    throw new Error('Agent Session 超过 32MB 限制，请减少参考图数量。')
  }
  await fs.writeFile(temporaryPath, serialized, 'utf8')
  await fs.rename(temporaryPath, filePath)
}

async function externalizeSessionReferences(session) {
  return {
    ...session,
    references: await Promise.all((session.references ?? []).map(async (reference) => {
      if (typeof reference.data !== 'string' || !reference.data.startsWith('data:')) return reference
      const parsed = parseDataUri(reference.data)
      if (!parsed) return reference
      const hash = crypto.createHash('sha256').update(parsed.data).digest('hex')
      const directory = path.join(sessionAssetsRoot, hash.slice(0, 2))
      const filePath = path.join(directory, hash)
      await fs.mkdir(directory, { recursive: true })
      try {
        await fs.access(filePath)
      } catch {
        const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
        await fs.writeFile(temporaryPath, parsed.data)
        await fs.rename(temporaryPath, filePath)
      }
      const metadata = { ...reference }
      delete metadata.data
      return { ...metadata, assetRef: `sha256:${hash}`, contentHash: hash, mime: reference.mime || parsed.mime }
    })),
  }
}

async function hydrateSessionReferences(session) {
  return {
    ...session,
    references: await Promise.all((session.references ?? []).map(async (reference) => {
      if (reference.data || typeof reference.assetRef !== 'string') return reference
      const hash = reference.assetRef.startsWith('sha256:') ? reference.assetRef.slice(7) : ''
      if (!/^[a-f0-9]{64}$/.test(hash)) return reference
      const data = await fs.readFile(path.join(sessionAssetsRoot, hash.slice(0, 2), hash))
      return { ...reference, data: `data:${reference.mime || 'image/png'};base64,${data.toString('base64')}` }
    })),
  }
}

function parseDataUri(value) {
  const match = value.match(/^data:([^;,]+)(;base64)?,(.*)$/s)
  if (!match) return undefined
  return {
    mime: match[1],
    data: match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3])),
  }
}

export async function saveStepCheckpoint(sessionId, runId, stepId, result) {
  const filePath = getCheckpointPath(sessionId, runId, stepId)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await writeJsonAtomic(filePath, {
    version: 1,
    sessionId,
    runId,
    stepId,
    result,
    createdAt: new Date().toISOString(),
  })
}

export async function loadStepCheckpoint(sessionId, runId, stepId) {
  try {
    const value = JSON.parse(await fs.readFile(getCheckpointPath(sessionId, runId, stepId), 'utf8'))
    if (value?.sessionId === sessionId && value?.runId === runId && value?.stepId === stepId) {
      return value.result
    }
  } catch {
    return undefined
  }
  return undefined
}

export function createAgentSession(sessionId) {
  const now = new Date().toISOString()
  return {
    id: sessionId,
    status: 'idle',
    plan: [],
    references: [],
    artifacts: [],
    observations: [],
    createdAt: now,
    updatedAt: now,
  }
}

function getSessionPath(sessionId) {
  const digest = crypto.createHash('sha256').update(sessionId).digest('hex')
  return path.join(storageRoot, `${digest}.json`)
}

function getCheckpointPath(sessionId, runId, stepId) {
  const sessionDigest = crypto.createHash('sha256').update(sessionId).digest('hex')
  const runDigest = crypto.createHash('sha256').update(runId).digest('hex')
  const stepDigest = crypto.createHash('sha256').update(stepId).digest('hex')
  return path.join(checkpointsRoot, sessionDigest, runDigest, `${stepDigest}.json`)
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temporaryPath, JSON.stringify(value), 'utf8')
  await fs.rename(temporaryPath, filePath)
}
