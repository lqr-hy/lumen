const activeAgents = new Map()

export function registerPiAgent(sessionId, agent) {
  activeAgents.set(sessionId, agent)
  return () => {
    if (activeAgents.get(sessionId) === agent) activeAgents.delete(sessionId)
  }
}

export function cancelPiAgent(sessionId) {
  const agent = activeAgents.get(sessionId)
  if (!agent) return false
  agent.abort()
  return true
}
