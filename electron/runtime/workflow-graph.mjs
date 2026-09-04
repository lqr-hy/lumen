export function getReadyWorkflowSteps(session) {
  const plan = Array.isArray(session.plan) ? session.plan : []
  const ready = []
  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index]
    if (step.status !== 'pending' && step.status !== 'failed') continue
    const blocked = plan
      .slice(0, index)
      .some((candidate) => candidate.status !== 'completed' && !canRunAlongside(candidate, step))
    if (!blocked) ready.push(step)
  }
  return ready
}

function canRunAlongside(previous, current) {
  return previous.tool === 'page.generate-component' && current.tool === 'page.generate-component'
}
