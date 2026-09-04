import path from 'node:path'
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node'
import {
  createNodeSqliteFactory,
  SqliteSessionRepository,
} from '@earendil-works/pi-session-backend-sqlite-node'

let repository
let databasePath
const sessions = new Map()

export function configurePiSessionStore(root) {
  databasePath = path.join(root, 'pi-agent-sessions.sqlite')
  repository = undefined
  sessions.clear()
}

export async function getPiSession(sessionId, projectId) {
  if (sessions.has(sessionId)) return sessions.get(sessionId)
  const repo = getRepository()
  const metadata = (await repo.list()).find((item) => item.id === sessionId)
  const session = metadata
    ? await repo.open(metadata)
    : await repo.create({
        id: sessionId,
        cwd: process.cwd(),
        metadata: projectId ? { projectId } : undefined,
      })
  sessions.set(sessionId, session)
  return session
}

export async function closePiSessionStore() {
  sessions.clear()
  if (repository) await repository.close()
  repository = undefined
}

function getRepository() {
  if (repository) return repository
  if (!databasePath) throw new Error('Pi Session Store 尚未配置。')
  repository = new SqliteSessionRepository({
    databasePath,
    sqlite: createNodeSqliteFactory(),
    env: new NodeExecutionEnv({ cwd: path.dirname(databasePath) }),
  })
  return repository
}
