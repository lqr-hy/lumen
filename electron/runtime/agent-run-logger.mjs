import fs from 'node:fs/promises'
import path from 'node:path'

let logRoot
let enabled = false

export function configureAgentRunLogger(userDataPath, options = {}) {
  logRoot = path.join(userDataPath, 'logs', 'agent-runs')
  enabled = options.enabled === true
}

export function appendAgentRunLog(event) {
  if (!enabled || !logRoot || event?.type !== 'tool.trace' || !event.trace) return
  const date = new Date(event.timestamp || Date.now()).toISOString().slice(0, 10)
  const runId = safeFileName(event.runId || event.sessionId || 'unknown-run')
  const record = {
    timestamp: new Date(event.timestamp || Date.now()).toISOString(),
    sessionId: event.sessionId,
    runId: event.runId,
    stepId: event.stepId,
    stage: event.trace.stage,
    tool: event.trace.tool,
    operation: event.trace.operation,
    taskId: event.trace.taskId,
    slotId: event.trace.slotId,
    label: event.trace.label,
    status: event.trace.status,
    attempt: event.trace.attempt,
    maxAttempts: event.trace.maxAttempts,
    elapsedMs: event.trace.elapsedMs,
    targetSize: event.trace.targetSize,
    errorCode: event.trace.errorCode,
    message: sanitizeMessage(event.trace.message),
  }
  void fs
    .mkdir(path.join(logRoot, date), { recursive: true })
    .then(() =>
      fs.appendFile(
        path.join(logRoot, date, `${runId}.jsonl`),
        `${JSON.stringify(record)}\n`,
        'utf8',
      ),
    )
    .catch((error) => console.warn('[agent-trace] failed to persist log:', error?.message || error))
}

function safeFileName(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 96)
}

function sanitizeMessage(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+/gi, '[image-data]')
    .slice(0, 500)
}
