/**
 * 返回当前依赖条件已经满足的步骤。
 * 默认保持计划顺序；页面组件生成步骤允许彼此并行，不互相阻塞。
 */
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

/** 判断两个未完成步骤是否允许同时进入 Ready 集合。 */
function canRunAlongside(previous, current) {
  return previous.tool === 'page.generate-component' && current.tool === 'page.generate-component'
}
