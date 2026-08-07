import type { AgentEvent } from './types'

export function getAgentEventStatus(event: AgentEvent) {
  if (event.type === 'agent.decision' && event.decision?.mode === 'tool' && event.decision.tool) {
    return `Agent 已选择 ${event.decision.tool}。`
  }
  if (event.type === 'agent.decision' && event.decision?.mode === 'clarify') {
    return 'Agent 需要补充信息。'
  }
  if (event.type === 'observation.created' && event.observation?.status === 'failed') {
    return `${event.observation.summary}${event.observation.retryable ? '，正在决定恢复方式...' : ''}`
  }
  if (event.type === 'step.started' && event.step) return `正在${event.step.title}...`
  if (event.type === 'step.completed' && event.step) return `${event.step.title}已完成。`
  if (event.type === 'step.retrying' && event.step) return `${event.step.title}失败，正在重试...`
  if (event.type === 'step.failed') return event.error || '任务步骤执行失败。'
  if (event.type === 'task.completed') return '任务已完成，正在交付结果...'
  if (event.type === 'task.awaiting-confirmation') return '页面结构已规划，等待确认。'
  if (event.type === 'task.failed') return event.error || '任务执行失败。'
  return ''
}
