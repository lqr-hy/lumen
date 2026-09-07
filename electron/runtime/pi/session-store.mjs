import path from 'node:path'
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core'
import {
  createNodeSqliteFactory,
  SqliteSessionRepo,
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
  if (sessions.has(sessionId)) return sessions.get(sessionId).branch
  const repo = getRepository()
  const metadata = (await repo.list(undefined, BACKGROUND_CONTEXT)).find(
    (item) => item.id === sessionId,
  )
  const session = metadata
    ? await repo.open(metadata, BACKGROUND_CONTEXT)
    : await repo.create({ id: sessionId }, BACKGROUND_CONTEXT)
  if (!metadata && projectId) await session.setName(projectId, BACKGROUND_CONTEXT)
  const persistedBranch = await session.branch('main', BACKGROUND_CONTEXT)
  const branch = persistedBranch ?? (await session.createBranch('main', null, BACKGROUND_CONTEXT))
  const adapter = {
    appendMessage: (message) => branch.appendMessage(message, BACKGROUND_CONTEXT),
  }
  sessions.set(sessionId, { session, branch: adapter })
  return adapter
}

export async function closePiSessionStore() {
  sessions.clear()
  if (repository) await repository.close(BACKGROUND_CONTEXT)
  repository = undefined
}

function getRepository() {
  if (repository) return repository
  if (!databasePath) throw new Error('Pi Session Store 尚未配置。')
  repository = new SqliteSessionRepo({
    directory: path.dirname(databasePath),
    databasePath,
    databaseFactory: createNodeSqliteFactory(),
  })
  return repository
}
