import { useState } from 'react'
import { executeDesignChatTurn } from '../../ai/design-chat-controller'
import { createChatRun } from '../../ai/agent-run'
import type { RuntimeModelSelection, SelectionScope } from '../../ai/types'
import { getComponentReferences } from '../../ai/composer-draft'
import { useEditorStore } from '../store/editor-store'
import type { EditorChatThread } from '../store/editor-store'
import type { DesignDocument, PageCompositionBlueprint } from '../types'
import {
  createComponentRegionBatchScope,
  createSelectionScope,
  getSelectionScopeElementIds,
  isAssetRegenerationPrompt,
} from '../utils/selection-scope'
import { buildVisualAssetPlan } from '../utils/visual-brief'
import { DEFAULT_ARTBOARD_HEIGHT, DEFAULT_ARTBOARD_WIDTH } from '../constants'
import { getPromptReferenceImages } from '../utils/chat-references'

interface UseChatRunSubmitOptions {
  activeThread?: EditorChatThread
  activeThreadPending: boolean
  regenerationReferences: EditorChatThread['textReferences']
  visibleTextReferences: EditorChatThread['textReferences']
  runtimeModel: RuntimeModelSelection
  imageModel: RuntimeModelSelection
  stylePackId: string
}

export function useChatRunSubmit({
  activeThread,
  activeThreadPending,
  regenerationReferences,
  visibleTextReferences,
  runtimeModel,
  imageModel,
  stylePackId,
}: UseChatRunSubmitOptions) {
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const selectionScopeArmed = useEditorStore((state) => state.selectionScopeArmed)
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId)
  const selectedArtboardId = useEditorStore((state) => state.selectedArtboardId)
  const consumeSelectionScope = useEditorStore((state) => state.consumeSelectionScope)
  const updateChatThread = useEditorStore((state) => state.updateChatThread)
  const [loading, setLoading] = useState(false)
  const [activeRunSessionId, setActiveRunSessionId] = useState<string>()

  async function onSubmit(
    overrideText?: string,
    blueprintOverride?: PageCompositionBlueprint,
    resumeRunId?: string,
    silentResume = false,
  ) {
    if (loading || activeThreadPending || !activeThread) return

    const resumedMessageIndex = resumeRunId
      ? activeThread.messages.findIndex((message) => message.runId === resumeRunId)
      : -1
    const resumedUserMessage =
      resumedMessageIndex >= 0
        ? [...activeThread.messages.slice(0, resumedMessageIndex)]
            .reverse()
            .find((message) => message.role === 'user')
        : undefined
    const referencedText = overrideText
      ? ''
      : visibleTextReferences.map((reference) => reference.text).join(' ')
    const runControlText = resumeRunId && overrideText ? overrideText : undefined
    const userPrompt = overrideText ?? activeThread.prompt.trim()
    const useHistoricalAssetScope = Boolean(resumeRunId) || isAssetRegenerationPrompt(userPrompt)
    const turnRegenerationReferences = useHistoricalAssetScope ? regenerationReferences : []
    const text =
      (runControlText ??
        (resumeRunId
          ? resumedUserMessage?.text
          : [referencedText, overrideText ?? activeThread.prompt.trim()]
              .filter(Boolean)
              .join(' '))) ||
      (turnRegenerationReferences.length ? '重新生成选中的组件素材' : '结合当前画布继续创作')
    const requestImages = runControlText
      ? []
      : resumeRunId
        ? (resumedUserMessage?.referenceImages ?? [])
        : overrideText
          ? []
          : getPromptReferenceImages(
              activeThread.prompt,
              activeThread.referenceImages,
              activeThread.mentions,
            )
    const currentMentions = runControlText
      ? []
      : resumeRunId
        ? (resumedUserMessage?.mentions ?? [])
        : overrideText
          ? []
          : (activeThread.mentions ?? [])
    const requestDocument = useEditorStore.getState().document
    if (!requestDocument) return
    const resumedSelectionScope = resumeRunId
      ? activeThread.messages.find((message) => message.runId === resumeRunId)?.selectionScope
      : undefined
    const frozenSelectionScope = resumeRunId
      ? refreshRetrySelectionScope(requestDocument, resumedSelectionScope)
      : (createComponentRegionBatchScope(
          requestDocument,
          turnRegenerationReferences.flatMap((reference) =>
            reference.elementId ? [reference.elementId] : [],
          ),
        ) ??
        createSelectionScope(
          requestDocument,
          selectionScopeArmed ? selectedElementIds : [],
          useEditorStore.getState().textRangeSelection,
          useEditorStore.getState().imageRegionSelection,
        ))
    if (
      ((!resumeRunId && selectionScopeArmed && selectedElementIds.length > 0) ||
        turnRegenerationReferences.length) &&
      !frozenSelectionScope
    )
      return
    const componentReferences = getComponentReferences(currentMentions)
    const latestDocument = useEditorStore.getState().document ?? requestDocument
    if (!resumeRunId) consumeSelectionScope()

    const threadTitle =
      activeThread.messages.length === 0 ? text.slice(0, 18) || '未命名对话' : activeThread.title
    const threadId = activeThread.id
    setActiveRunSessionId(threadId)
    const pendingMessageId = `agent-pending-${Date.now()}`
    const resumableRun = resumeRunId ? activeThread.runs?.[resumeRunId] : undefined
    const runId = resumableRun?.id ?? `chat-run-${Date.now()}`
    const draftSnapshot = {
      prompt: activeThread.prompt,
      editorState: activeThread.editorState,
      mentions: activeThread.mentions ?? [],
      referenceImages: activeThread.referenceImages,
      textReferences: activeThread.textReferences,
      visualOptimizationDraft: activeThread.visualOptimizationDraft,
    }
    const requestPrompt =
      overrideText === '重试' && draftSnapshot.visualOptimizationDraft ? draftSnapshot.prompt : text
    updateChatThread(threadId, (thread) => ({
      ...thread,
      title: threadTitle,
      prompt: '',
      editorState: undefined,
      mentions: [],
      referenceImages: [],
      textReferences: [],
      messages: [
        ...thread.messages.map((message) =>
          resumeRunId
            ? {
                ...message,
                ...(overrideText === '确认执行' ? { confirmation: undefined } : {}),
                ...(message.runId === runId ? { runId: undefined } : {}),
              }
            : message,
        ),
        ...(!silentResume
          ? [
              {
                id: `user-${Date.now()}`,
                role: 'user' as const,
                text,
                mentions: currentMentions.map((mention) => ({ ...mention })),
                referenceImages: requestImages.map((image) => ({ ...image })),
              },
            ]
          : []),
        {
          id: pendingMessageId,
          role: 'agent' as const,
          text: '',
          pending: true,
          runId,
          selectionScope: frozenSelectionScope,
        },
      ],
      runs: {
        ...thread.runs,
        [runId]: resumableRun
          ? {
              ...resumableRun,
              messageId: pendingMessageId,
              status: 'understanding' as const,
              phaseLabel: '正在继续已确认的页面任务',
              currentStepId: undefined,
              finishedAt: undefined,
              error: undefined,
              lastSequence: 0,
            }
          : createChatRun(runId, pendingMessageId),
      },
    }))
    setLoading(true)
    try {
      await executeDesignChatTurn(
        {
          sessionId: threadId,
          provider: runtimeModel.provider,
          model: runtimeModel.model,
          imageProvider: imageModel.provider,
          imageModel: imageModel.model,
          stylePackId: stylePackId || undefined,
          prompt: requestPrompt,
          document: latestDocument,
          history: activeThread.messages
            .filter((message) => !message.pending)
            .map((message) => ({
              role: message.role,
              text: message.text,
              referenceImages: message.referenceImages?.map((image) => ({
                name: image.name,
                src: image.src,
              })),
              componentReferences: getComponentReferences(message.mentions ?? []),
            })),
          mentions: currentMentions,
          componentReferences,
          referenceImages: requestImages.map((image) => image.src),
          referenceImageNames: requestImages.map((image) => image.name),
          referenceImageRoles: requestImages.map((image) => image.role ?? 'auto'),
          textReferences: runControlText ? [] : activeThread.textReferences,
          selectedElementIds: frozenSelectionScope
            ? getSelectionScopeElementIds(frozenSelectionScope)
            : selectedElementIds,
          activeArtboardId,
          selectedArtboardId,
          editScope: frozenSelectionScope,
          componentRegionAction:
            frozenSelectionScope?.type === 'component-region-batch'
              ? { kind: 'regenerate-component-regions', targets: frozenSelectionScope.targets }
              : undefined,
          blueprintOverride,
          visualBrief: draftSnapshot.visualOptimizationDraft?.brief,
          visualAssetPlan: (() => {
            const draft = draftSnapshot.visualOptimizationDraft
            const target = latestDocument.artboards.find(
              (item) => item.id === draft?.sourceArtboardId,
            )
            return draft
              ? buildVisualAssetPlan(
                  draft.brief,
                  target ?? { width: DEFAULT_ARTBOARD_WIDTH, height: DEFAULT_ARTBOARD_HEIGHT },
                )
              : undefined
          })(),
          visualOptimizationContext: draftSnapshot.visualOptimizationDraft
            ? {
                mode:
                  draftSnapshot.visualOptimizationDraft.mode ??
                  (draftSnapshot.visualOptimizationDraft.sourceArtboardId
                    ? 'variant'
                    : 'new-design'),
                sourceArtboardId:
                  draftSnapshot.visualOptimizationDraft.sourceArtboardId || undefined,
              }
            : undefined,
        },
        { threadId, messageId: pendingMessageId, runId, updateThread: updateChatThread },
      )
      updateChatThread(threadId, (thread) => ({
        ...thread,
        visualOptimizationDraft: undefined,
      }))
    } catch {
      updateChatThread(threadId, (thread) => ({
        ...thread,
        prompt: thread.prompt || draftSnapshot.prompt,
        editorState: thread.editorState || draftSnapshot.editorState,
        mentions: thread.mentions?.length ? thread.mentions : draftSnapshot.mentions,
        referenceImages: thread.referenceImages.length
          ? thread.referenceImages
          : draftSnapshot.referenceImages,
        textReferences: thread.textReferences.length
          ? thread.textReferences
          : draftSnapshot.textReferences,
        visualOptimizationDraft:
          thread.visualOptimizationDraft ?? draftSnapshot.visualOptimizationDraft,
      }))
    } finally {
      setActiveRunSessionId(undefined)
      setLoading(false)
    }
  }

  return { loading, activeRunSessionId, onSubmit }
}

function refreshRetrySelectionScope(
  document: DesignDocument,
  scope: SelectionScope | undefined,
): SelectionScope | undefined {
  if (!scope) return undefined
  if (scope.type === 'generic-node' || scope.type === 'design-block') {
    return createSelectionScope(document, [scope.elementId])
  }
  if (scope.type === 'multi-node') {
    return createSelectionScope(document, scope.elementIds)
  }
  return scope
}
