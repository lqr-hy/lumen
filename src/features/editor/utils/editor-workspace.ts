import type { Artboard, ViewportState } from '../types'
import { DEFAULT_CANVAS_VIEWPORT, MIN_CONVERSATION_FOCUS_ZOOM } from '../constants'
import type { PlacementMode } from './placement-intent'
import type { EditorChatThread } from '../store/editor-store'

export function createDefaultChatThread(): EditorChatThread {
  return {
    id: 'panel-thread-default',
    title: '未命名对话',
    artboardIds: [],
    placementMode: 'auto',
    prompt: '',
    mentions: [],
    referenceImages: [],
    textReferences: [],
    messages: [],
  }
}

export function normalizePersistedChatThreads(threads: EditorChatThread[]) {
  return threads.map((thread) => {
    const interruptedRunIds = new Set(
      thread.messages
        .filter((message) => message.pending && message.runId)
        .map((message) => message.runId!),
    )
    return {
      ...thread,
      messages: thread.messages.map((message) =>
        message.pending
          ? {
              ...message,
              pending: false,
              text: '上次任务在应用重启前中断，可输入“继续”从检查点恢复。',
            }
          : message,
      ),
      runs: Object.fromEntries(
        Object.entries(thread.runs ?? {}).map(([id, run]) =>
          interruptedRunIds.has(id)
            ? [
                id,
                {
                  ...run,
                  status: 'interrupted' as const,
                  phaseLabel: '任务在应用重启前中断',
                  finishedAt: new Date().toISOString(),
                },
              ]
            : [id, normalizePersistedRun(run)],
        ),
      ),
    }
  })
}

function normalizePersistedRun(run: NonNullable<EditorChatThread['runs']>[string]) {
  if (!run.finishedAt || !['completed', 'failed', 'cancelled'].includes(run.status)) return run
  return {
    ...run,
    steps: run.steps.map((step) => {
      if (!['running', 'retrying'].includes(step.status)) return step
      const status =
        run.status === 'completed'
          ? ('completed' as const)
          : run.status === 'cancelled'
            ? ('cancelled' as const)
            : ('failed' as const)
      return { ...step, status, completedAt: step.completedAt ?? run.finishedAt }
    }),
  }
}

export function bindThreadToArtboard(
  thread: EditorChatThread,
  artboardId: string,
  mode: Exclude<PlacementMode, 'auto'>,
): EditorChatThread {
  return {
    ...thread,
    targetArtboardId: artboardId,
    activeTargetArtboardId: artboardId,
    assetArtboardId: mode === 'asset-board' ? artboardId : thread.assetArtboardId,
    artboardIds: Array.from(new Set([...(thread.artboardIds ?? []), artboardId])),
    lastPlacementMode: mode,
  }
}

export function focusConversationArtboard(
  viewport: ViewportState,
  artboard: Artboard,
): ViewportState {
  if (viewport.zoom >= MIN_CONVERSATION_FOCUS_ZOOM) return viewport
  const zoom = DEFAULT_CANVAS_VIEWPORT.zoom
  return {
    x: DEFAULT_CANVAS_VIEWPORT.x - artboard.x * zoom,
    y: DEFAULT_CANVAS_VIEWPORT.y - artboard.y * zoom,
    zoom,
  }
}
