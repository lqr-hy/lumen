import { applyChatEdit } from './api'
import { createAgentChatRunController } from './agent-chat-run-controller'
import { createDesignTurnCanvasBridge } from './design-turn-canvas-bridge'
import type { ChatEditCallbacks, ChatEditRequest, ChatEditResult } from './types'

export interface DesignChatControllerOptions {
  threadId: string
  messageId: string
  runId: string
  updateThread: Parameters<typeof createAgentChatRunController>[0]['updateThread']
  onDeliverable?: (result: ChatEditResult) => void
}

/**
 * 唯一的 AI 设计回合执行入口。UI 只负责准备 Draft 和提交后的展示，
 * 运行时间线、画布目标握手、增量交付和失败状态在这里保持一致。
 */
export async function executeDesignChatTurn(
  request: ChatEditRequest,
  options: DesignChatControllerOptions,
): Promise<ChatEditResult> {
  const runController = createAgentChatRunController({
    threadId: options.threadId,
    messageId: options.messageId,
    runId: options.runId,
    updateThread: options.updateThread,
  })
  const canvasBridge = createDesignTurnCanvasBridge({
    threadId: options.threadId,
    onDeliverable: runController.onDeliverable,
  })
  const callbacks: ChatEditCallbacks = {
    onToken: runController.onToken,
    onAgentEvent: runController.onAgentEvent,
    onCanvasTargetRequest: canvasBridge.onCanvasTargetRequest,
    onCanvasSnapshotRequest: canvasBridge.onCanvasSnapshotRequest,
    onDeliverable: canvasBridge.onDeliverable,
  }

  try {
    const result = await applyChatEdit(request, callbacks)
    runController.flush()
    runController.complete(result.message, result.confirmation)
    options.onDeliverable?.(result)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : '聊天接口调用失败'
    runController.fail(message)
    throw error
  }
}
