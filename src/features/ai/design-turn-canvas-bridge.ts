import { useEditorStore } from '../editor/store/editor-store'
import type { ChatArtboardTarget } from '../editor/store/editor-store'
import { applyIncrementalCanvasDeliverable } from '../editor/utils/incremental-delivery'
import { resolveWorkflowCanvasTarget } from '../editor/utils/workflow-canvas-target'
import type {
  CanvasSnapshotRequest,
  CanvasSnapshotResolution,
  CanvasTargetRequest,
  CanvasWriteObservation,
  IncrementalCanvasDeliverable,
} from './types'
import { renderArtboardSnapshot } from '../editor/utils/artboard-snapshot'
import {
  createCanvasLeaseSnapshot,
  findChangedLeaseElements,
  getDeliverableTargetIds,
} from './canvas-rebase'

interface DesignTurnCanvasBridgeOptions {
  threadId: string
  onDeliverable?: (
    deliverable: IncrementalCanvasDeliverable,
    observation: CanvasWriteObservation,
  ) => void
}

export function createDesignTurnCanvasBridge(options: DesignTurnCanvasBridgeOptions) {
  let target: ChatArtboardTarget | undefined
  const targetResolutions = new Map<string, ReturnType<typeof resolveWorkflowCanvasTarget>>()

  return {
    onCanvasTargetRequest(request: CanvasTargetRequest) {
      const cached = targetResolutions.get(request.operationId)
      if (cached) return cached
      const resolution = resolveWorkflowCanvasTarget(options.threadId, request)
      targetResolutions.set(request.operationId, resolution)
      if (resolution.status === 'ready' && resolution.target) {
        target = {
          artboardId: resolution.target.artboardId,
          created: resolution.target.createdForThread,
          mode: resolution.target.placementMode ?? 'append-section',
          documentRevision: resolution.target.documentRevision,
          leaseSnapshot:
            resolution.target.documentRevision !== undefined && useEditorStore.getState().document
              ? createCanvasLeaseSnapshot(
                  useEditorStore.getState().document!,
                  resolution.target.artboardId,
                )
              : undefined,
        }
      }
      return resolution
    },

    async onDeliverable(
      deliverable: IncrementalCanvasDeliverable,
    ): Promise<CanvasWriteObservation> {
      if (!target) {
        return {
          status: 'failed',
          summary: '设计任务缺少已确认的目标画板。',
          errorCode: 'CANVAS_TARGET_MISSING',
        }
      }
      const beforeMutation = useEditorStore.getState()
      if (
        !beforeMutation.document?.artboards.some((artboard) => artboard.id === target?.artboardId)
      ) {
        return {
          status: 'failed',
          summary: '目标画板在写入前已被删除，请重新执行任务。',
          errorCode: 'CANVAS_TARGET_EXPIRED',
        }
      }
      const previousDocument = beforeMutation.document
      const previousLedger = beforeMutation.mutationLedger
      if (
        target.documentRevision !== undefined &&
        beforeMutation.document?.version !== target.documentRevision
      ) {
        const changedIds = target.leaseSnapshot
          ? findChangedLeaseElements(
              beforeMutation.document!,
              target.artboardId,
              target.leaseSnapshot,
              getDeliverableTargetIds(deliverable),
            )
          : [target.artboardId]
        if (!changedIds.length) {
          target.documentRevision = beforeMutation.document?.version
          target.leaseSnapshot = createCanvasLeaseSnapshot(
            beforeMutation.document!,
            target.artboardId,
          )
        } else {
          return {
            status: 'failed',
            summary: `画布在任务执行期间发生了修改（Lease Revision ${target.documentRevision}，当前 Revision ${beforeMutation.document?.version ?? 0}），为避免覆盖用户修改，本次交付已停止。`,
            errorCode: 'CANVAS_DOCUMENT_REVISION_CONFLICT',
            data: {
              artboardId: target.artboardId,
              documentRevision: beforeMutation.document?.version,
              rebasedFromRevision: target.documentRevision,
              rebasedToRevision: beforeMutation.document?.version,
              affectedElementIds: changedIds,
            },
          }
        }
      }
      const observation = applyIncrementalCanvasDeliverable(target, deliverable)
      if (observation.status === 'success' && window.aiCampaignProjects) {
        try {
          const state = useEditorStore.getState()
          if (!state.document) throw new Error('当前项目文档不存在。')
          await window.aiCampaignProjects.save({
            schemaVersion: 2,
            projectId: state.document.id,
            document: { ...state.document, viewport: state.viewport },
            chatThreads: state.chatThreads,
            activeChatThreadId: state.activeChatThreadId,
            mutationLedger: state.mutationLedger,
            createdAt: state.document.createdAt,
            updatedAt: state.document.updatedAt,
          })
        } catch (error) {
          useEditorStore.setState({
            document: previousDocument,
            mutationLedger: previousLedger,
          })
          return {
            status: 'failed',
            summary:
              error instanceof Error
                ? `画布写入后持久化失败：${error.message}`
                : '画布写入后持久化失败。',
            errorCode: 'CANVAS_MUTATION_PERSIST_FAILED',
          }
        }
      }
      if (observation.status === 'success') {
        target.documentRevision =
          observation.data?.documentRevision ?? beforeMutation.document?.version
        const latestDocument = useEditorStore.getState().document
        if (latestDocument)
          target.leaseSnapshot = createCanvasLeaseSnapshot(latestDocument, target.artboardId)
      }
      options.onDeliverable?.(deliverable, observation)
      return observation
    },

    async onCanvasSnapshotRequest(
      request: CanvasSnapshotRequest,
    ): Promise<CanvasSnapshotResolution> {
      const document = useEditorStore.getState().document
      if (!document) {
        return {
          status: 'failed',
          reason: '当前项目没有可截图文档。',
          errorCode: 'SNAPSHOT_DOCUMENT_MISSING',
        }
      }
      try {
        const snapshot = await renderArtboardSnapshot(document, request.artboardId, request.scale)
        if (snapshot.data.length > 24 * 1024 * 1024) {
          return {
            status: 'failed',
            reason: '画板 PNG 快照超过 18MB 限制。',
            errorCode: 'SNAPSHOT_SIZE_EXCEEDED',
          }
        }
        return { status: 'ready', snapshot }
      } catch (error) {
        return {
          status: 'failed',
          reason: error instanceof Error ? error.message : '画板快照生成失败。',
          errorCode: 'SNAPSHOT_RENDER_FAILED',
        }
      }
    },
  }
}
