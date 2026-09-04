import type { CanvasTargetRequest, CanvasTargetResolution } from '../../ai/types'
import type { PlacementMode } from './placement-intent'
import { useEditorStore } from '../store/editor-store'

export function resolveWorkflowCanvasTarget(
  threadId: string,
  request: CanvasTargetRequest,
): CanvasTargetResolution {
  const state = useEditorStore.getState()
  if (!state.document) {
    return failed('CANVAS_DOCUMENT_MISSING', '当前项目没有可用的设计文档。')
  }
  const thread = state.chatThreads.find((item) => item.id === threadId)
  if (!thread) {
    return failed('CANVAS_THREAD_MISSING', '当前对话已经不存在，无法绑定目标画板。')
  }

  if (request.baseDocumentRevision !== state.document.version) {
    return failed(
      'CANVAS_DOCUMENT_STALE',
      `画布版本已变化（计划版本 ${request.baseDocumentRevision}，当前版本 ${state.document.version}），请重新检查目标。`,
    )
  }
  const mode = resolvePlacementMode(request)
  const requiresExistingTarget = ['insert', 'revise', 'variant', 'resume'].includes(
    request.placement.operation,
  )
  if (requiresExistingTarget && !request.preferredArtboardId) {
    return failed('CANVAS_TARGET_REQUIRED', '该操作需要明确的目标画板，不能从历史对话隐式选择。')
  }
  if (
    request.preferredArtboardId &&
    !state.document.artboards.some((artboard) => artboard.id === request.preferredArtboardId)
  ) {
    return failed('CANVAS_TARGET_INVALID', 'Agent 选择的目标画板不存在或已经被删除。')
  }
  const target = state.ensureChatThreadArtboard(
    threadId,
    mode,
    request.preferredArtboardId,
    request.placement.operation === 'create' && request.action !== 'create-artboard',
    request.logicalSize,
  )
  const latest = useEditorStore.getState().document
  const artboard = latest?.artboards.find((item) => item.id === target?.artboardId)
  if (!target || !artboard) {
    return failed('CANVAS_TARGET_MISSING', '无法创建或选择目标画板。')
  }

  return {
    status: 'ready',
    summary: target.created ? '已自动创建目标画板。' : '已选择目标画板。',
    target: {
      artboardId: target.artboardId,
      createdForThread: target.created,
      width: artboard.width,
      height: artboard.height,
      autoHeight: artboard.autoHeight,
      placementMode: target.mode,
      placementSource: placementSource(request, target.created),
      operationId: request.operationId,
      leaseId: `canvas-lease-${request.operationId}`,
      documentRevision: latest?.version,
    },
  }
}

function resolvePlacementMode(request: CanvasTargetRequest): Exclude<PlacementMode, 'auto'> {
  if (request.placement.operation === 'create') return 'new-artboard'
  if (request.placement.operation === 'variant') return 'duplicate-variant'
  if (request.placement.operation === 'assets') return 'asset-board'
  return 'append-section'
}

function placementSource(
  request: CanvasTargetRequest,
  created: boolean,
): NonNullable<NonNullable<CanvasTargetResolution['target']>['placementSource']> {
  if (request.placement.scope === 'selection') return 'selection'
  if (request.placement.operation === 'resume') return 'thread'
  if (request.preferredArtboardId && !created) return 'prompt'
  return created ? 'default' : 'thread'
}

function failed(errorCode: string, reason: string): CanvasTargetResolution {
  return { status: 'failed', errorCode, reason }
}
