import type { EditorChatThread } from '../editor/store/editor-store'
import { appendRunDeliverable, finishRun, reduceChatRunEvent } from './agent-run'
import type {
  AgentEvent,
  BlueprintConfirmation,
  CanvasWriteObservation,
  IncrementalCanvasDeliverable,
} from './types'

interface AgentChatRunControllerOptions {
  threadId: string
  messageId: string
  runId: string
  updateThread: (threadId: string, updater: (thread: EditorChatThread) => EditorChatThread) => void
}

export function createAgentChatRunController(options: AgentChatRunControllerOptions) {
  let tokenBuffer = ''
  let flushTimer: number | undefined

  const update = (updater: (thread: EditorChatThread) => EditorChatThread) => {
    options.updateThread(options.threadId, updater)
  }
  const flushTokens = () => {
    if (flushTimer) window.clearTimeout(flushTimer)
    flushTimer = undefined
    if (!tokenBuffer) return
    const chunk = tokenBuffer
    tokenBuffer = ''
    update((thread) => ({
      ...thread,
      messages: thread.messages.map((message) =>
        message.id === options.messageId
          ? { ...message, text: `${message.text}${chunk}` }
          : message,
      ),
    }))
  }
  const updateRun = (
    updater: (
      run: NonNullable<EditorChatThread['runs']>[string],
    ) => NonNullable<EditorChatThread['runs']>[string],
  ) => {
    update((thread) => {
      const run = thread.runs?.[options.runId]
      if (!run) return thread
      return {
        ...thread,
        runs: { ...thread.runs, [options.runId]: updater(run) },
      }
    })
  }

  return {
    onToken(token: string) {
      tokenBuffer += token
      if (!flushTimer) flushTimer = window.setTimeout(flushTokens, 24)
    },
    onAgentEvent(event: AgentEvent) {
      flushTokens()
      updateRun((run) => reduceChatRunEvent(run, event))
    },
    onDeliverable(deliverable: IncrementalCanvasDeliverable, observation: CanvasWriteObservation) {
      updateRun((run) => appendRunDeliverable(run, deliverable, observation))
    },
    complete(text: string, confirmation?: BlueprintConfirmation) {
      flushTokens()
      update((thread) => {
        const currentMessage = thread.messages.find((message) => message.id === options.messageId)
        const run = thread.runs?.[options.runId]
        if (!run) return thread
        if (['failed', 'cancelled', 'interrupted'].includes(run.status)) {
          return {
            ...thread,
            messages: thread.messages.map((message) =>
              message.id === options.messageId ? { ...message, pending: false } : message,
            ),
          }
        }
        const waiting = Boolean(confirmation)
        return {
          ...thread,
          messages: thread.messages.map((message) =>
            message.id === options.messageId
              ? {
                  ...message,
                  pending: false,
                  text:
                    text ||
                    currentMessage?.text ||
                    (waiting ? '页面结构已规划，请确认后继续。' : '任务已完成。'),
                  confirmation,
                }
              : message,
          ),
          runs: {
            ...thread.runs,
            [options.runId]: finishRun(
              run,
              waiting ? 'waiting-confirmation' : 'completed',
              waiting ? '等待确认页面结构' : '任务已完成',
            ),
          },
        }
      })
    },
    fail(error: string) {
      flushTokens()
      const cancelled = /取消|停止|cancel/i.test(error)
      const displayError = normalizeRunError(error)
      update((thread) => {
        const run = thread.runs?.[options.runId]
        if (!run) return thread
        return {
          ...thread,
          messages: thread.messages.map((message) =>
            message.id === options.messageId ? { ...message, pending: false } : message,
          ),
          runs: {
            ...thread.runs,
            [options.runId]: finishRun(
              run,
              cancelled ? 'cancelled' : 'failed',
              cancelled ? '任务已停止' : '任务执行失败',
              displayError,
            ),
          },
        }
      })
    },
    flush: flushTokens,
  }
}

function normalizeRunError(error: string) {
  if (/gateway[_-]?empty[_-]?response|empty_response|HTTP 200 空响应|网关.*空响应/i.test(error)) {
    return '连接推理服务失败：网关没有返回有效内容，已自动重试 2 次。输入和附件已保留，可以重新发送。'
  }
  return error.replace(/OpenAI API error \(502\):\s*\{[\s\S]*$/i, '连接推理服务失败，请稍后重试。')
}
