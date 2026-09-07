import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  FileCheck2,
  GripVertical,
  ImagePlus,
  Maximize2,
  Minus,
  Pencil,
  Plus,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react'
import { executeDesignChatTurn } from '../../ai/design-chat-controller'
import { createChatRun, type ChatRunDeliverable } from '../../ai/agent-run'
import { useEditorStore } from '../store/editor-store'
import type { EditorChatImage, EditorChatThread } from '../store/editor-store'
import type { DesignDocument } from '../types'
import { PromptComposer, type PromptTextReference } from '../../../components/ui/PromptComposer'
import {
  getImageMentionIndex,
  getImageMentionLabels,
  getMessageImageLabel,
  getPromptReferenceImages,
  getStandaloneMessageImages,
} from '../utils/chat-references'
import { ComposerRuntimeControls } from './ComposerRuntimeControls'
import { useRuntimeSettings } from '../../ai/runtime-settings'
import {
  createComponentRegionBatchScope,
  createSelectionScope,
  getSelectionScopeElementIds,
  isComponentSlotRegenerationReference,
  isAssetRegenerationPrompt,
} from '../utils/selection-scope'
import { upsertQueuedComposerReference } from '../utils/composer-target'
import { AgentRunTimeline } from './AgentRunTimeline'
import { resolveDesignSpecPatchConflicts } from '../utils/design-spec-patch'
import { getComponentReferences } from '../../ai/composer-draft'
import type { BlueprintConfirmation, SelectionScope } from '../../ai/types'
import { useComponentMentions } from '../hooks/use-component-mentions'
import { InvalidSelectionScopeChip, SelectionScopeChip } from './SelectionScopeChip'
import { buildVisualAssetPlan, summarizeVisualRedesignBrief } from '../utils/visual-brief'
import { DEFAULT_ARTBOARD_HEIGHT, DEFAULT_ARTBOARD_WIDTH } from '../constants'
import { resolveReferenceImageRoles } from '../../ai/reference-image-role'

interface ChatPanelProps {
  onClose: () => void
}

export function ChatPanel({ onClose }: ChatPanelProps) {
  const document = useEditorStore((state) => state.document)
  const selectElement = useEditorStore((state) => state.selectElement)
  const selectArtboard = useEditorStore((state) => state.selectArtboard)
  const setSelectedElements = useEditorStore((state) => state.setSelectedElements)
  const clearSelection = useEditorStore((state) => state.clearSelection)
  const consumeSelectionScope = useEditorStore((state) => state.consumeSelectionScope)
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const selectionScopeArmed = useEditorStore((state) => state.selectionScopeArmed)
  const textRangeSelection = useEditorStore((state) => state.textRangeSelection)
  const imageRegionSelection = useEditorStore((state) => state.imageRegionSelection)
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId)
  const selectedArtboardId = useEditorStore((state) => state.selectedArtboardId)
  const threads = useEditorStore((state) => state.chatThreads)
  const activeThreadId = useEditorStore((state) => state.activeChatThreadId)
  const setActiveThreadId = useEditorStore((state) => state.setActiveChatThread)
  const addChatThread = useEditorStore((state) => state.addChatThread)
  const updateChatThread = useEditorStore((state) => state.updateChatThread)
  const deleteChatThread = useEditorStore((state) => state.deleteChatThread)
  const queuedReferenceImages = useEditorStore((state) => state.queuedReferenceImages)
  const consumeQueuedReferenceImages = useEditorStore((state) => state.consumeQueuedReferenceImages)
  const queuedChatTexts = useEditorStore((state) => state.queuedChatTexts)
  const consumeQueuedChatTexts = useEditorStore((state) => state.consumeQueuedChatTexts)
  const [loading, setLoading] = useState(false)
  const [activeRunSessionId, setActiveRunSessionId] = useState<string>()
  const [threadMenuOpen, setThreadMenuOpen] = useState(false)
  const threadMenuRef = useRef<HTMLDivElement>(null)
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [composerCursorByThread, setComposerCursorByThread] = useState<Record<string, number>>({})
  const { runtimeModel, imageModel, stylePackId, setRuntimeModel, setImageModel, setStylePackId } =
    useRuntimeSettings()
  const bodyRef = useRef<HTMLDivElement>(null)
  const { componentMentionOptions, importComponent } = useComponentMentions(document?.id)

  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? threads[0]

  useEffect(() => {
    if (!threadMenuOpen) return

    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !threadMenuRef.current?.contains(target)) {
        setThreadMenuOpen(false)
      }
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setThreadMenuOpen(false)
    }

    window.document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    window.document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
      window.document.removeEventListener('keydown', closeOnEscape)
    }
  }, [threadMenuOpen])

  const directSelectionScope =
    document && selectionScopeArmed
      ? createSelectionScope(document, selectedElementIds, textRangeSelection, imageRegionSelection)
      : undefined
  const regenerationReferences = useMemo(
    () => activeThread?.textReferences.filter(isComponentSlotRegenerationReference) ?? [],
    [activeThread?.textReferences],
  )
  const regenerationScope = document
    ? createComponentRegionBatchScope(
        document,
        regenerationReferences.flatMap((reference) =>
          reference.elementId ? [reference.elementId] : [],
        ),
      )
    : undefined
  // 历史素材引用只用于继续/重试，不强行占据当前输入框的编辑范围。
  const selectionScope = regenerationScope ?? directSelectionScope
  const visibleTextReferences =
    activeThread?.textReferences.filter(
      (reference) => !isComponentSlotRegenerationReference(reference),
    ) ?? []
  const visualSummaryReferences = activeThread
    ? getPromptReferenceImages(
        activeThread.prompt,
        activeThread.referenceImages,
        activeThread.mentions ?? [],
      )
    : []
  const activeThreadPending = Boolean(activeThread?.messages.some((message) => message.pending))
  const activeMessageCount = activeThread?.messages.length ?? 0

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' })
  }, [activeMessageCount, activeThreadPending, activeThreadId])

  useEffect(() => {
    if (!queuedReferenceImages.some((image) => image.target === 'panel')) return
    const images = consumeQueuedReferenceImages('panel')
    if (!images.length) return
    updateChatThread(activeThreadId, (thread) => {
      const nextReferenceImages = [...thread.referenceImages]
      images.forEach((image) => {
        if (!nextReferenceImages.some((item) => item.src === image.src)) {
          nextReferenceImages.push({
            id: image.id,
            name: image.name,
            src: image.src,
            elementId: image.elementId,
          })
        }
      })
      return { ...thread, referenceImages: nextReferenceImages }
    })
  }, [activeThreadId, consumeQueuedReferenceImages, queuedReferenceImages, updateChatThread])

  useEffect(() => {
    if (!queuedChatTexts.some((item) => item.target === 'panel')) return
    const texts = consumeQueuedChatTexts('panel')
    if (!texts.length) return
    updateChatThread(activeThreadId, (thread) => {
      let nextReferences = [...thread.textReferences]
      const insertOffset = Math.min(
        composerCursorByThread[thread.id] ?? thread.prompt.length,
        thread.prompt.length,
      )
      texts.forEach((item) => {
        nextReferences = upsertQueuedComposerReference(nextReferences, item, insertOffset)
      })
      return {
        ...thread,
        textReferences: nextReferences,
      }
    })
    const regenerationIds = [
      ...regenerationReferences.flatMap((reference) =>
        reference.elementId ? [reference.elementId] : [],
      ),
      ...texts
        .filter((item) => item.kind === 'component-region-regeneration')
        .flatMap((item) => (item.elementId ? [item.elementId] : [])),
    ]
    if (regenerationIds.length) setSelectedElements([...new Set(regenerationIds)])
  }, [
    activeThreadId,
    composerCursorByThread,
    consumeQueuedChatTexts,
    queuedChatTexts,
    regenerationReferences,
    setSelectedElements,
    updateChatThread,
  ])

  function updateActiveThread(updater: (thread: EditorChatThread) => EditorChatThread) {
    updateChatThread(activeThreadId, updater)
  }

  function createThread() {
    const nextThread: EditorChatThread = {
      id: `panel-thread-${Date.now()}`,
      title: '新对话',
      artboardIds: [],
      placementMode: 'auto',
      prompt: '',
      mentions: [],
      referenceImages: [],
      textReferences: [],
      messages: [],
    }
    addChatThread(nextThread)
    setEditingThreadId(nextThread.id)
    setEditingTitle(nextThread.title)
  }

  function selectThread(threadId: string) {
    setActiveThreadId(threadId)
    setThreadMenuOpen(false)
    setEditingThreadId(null)
  }

  function startRenameThread(thread: EditorChatThread) {
    setEditingThreadId(thread.id)
    setEditingTitle(thread.title)
  }

  function saveThreadTitle(threadId: string) {
    const title = editingTitle.trim() || '未命名对话'
    updateChatThread(threadId, (thread) => ({ ...thread, title }))
    setEditingThreadId(null)
  }

  function removeThread(threadId: string) {
    deleteChatThread(threadId)
    if (editingThreadId === threadId) {
      setEditingThreadId(null)
    }
  }

  function setPrompt(prompt: string) {
    updateActiveThread((thread) => ({ ...thread, prompt }))
  }

  function setReferenceImages(referenceImages: string[], referenceImageNames: string[] = []) {
    updateActiveThread((thread) => {
      const currentBySrc = new Map(
        collectThreadMentionImages(thread).map((image) => [image.src, image]),
      )
      return {
        ...thread,
        referenceImages: referenceImages.map((src, index) =>
          currentBySrc.has(src)
            ? {
                ...currentBySrc.get(src)!,
                name: referenceImageNames[index] || currentBySrc.get(src)!.name,
              }
            : {
                id: `panel-upload-${Date.now()}-${index}`,
                name: referenceImageNames[index] || `参考图 ${index + 1}`,
                src,
                role: 'auto',
              },
        ),
      }
    })
  }

  function setReferenceImageRole(index: number, role: NonNullable<EditorChatImage['role']>) {
    updateActiveThread((thread) => ({
      ...thread,
      referenceImages: thread.referenceImages.map((image, imageIndex) =>
        imageIndex === index
          ? { ...image, role }
          : (role === 'kv' || role === 'prototype' || role === 'edit-base') && image.role === role
            ? { ...image, role: 'visual' }
            : image,
      ),
    }))
  }

  function removeTextReference(id: string) {
    updateActiveThread((thread) => ({
      ...thread,
      textReferences: thread.textReferences.filter((reference) => reference.id !== id),
    }))
  }

  function activateTextReference(reference: PromptTextReference) {
    if (!reference.elementId) return
    selectElement(reference.elementId)
  }

  function activateImageReference({ index }: { index: number }) {
    const image = activeThread?.referenceImages[index]
    if (!image?.elementId) return false
    const exists = document?.elements.some((element) => element.id === image.elementId)
    if (!exists) return false
    selectElement(image.elementId)
    return true
  }

  function activateMessageImage(elementId?: string) {
    if (!elementId) return
    const exists = document?.elements.some((element) => element.id === elementId)
    if (exists) selectElement(elementId)
  }

  function locateRunTarget(target: { artboardId?: string; elementId?: string }) {
    if (target.elementId && document?.elements.some((element) => element.id === target.elementId)) {
      selectElement(target.elementId)
      return
    }
    if (
      target.artboardId &&
      document?.artboards.some((artboard) => artboard.id === target.artboardId)
    ) {
      selectArtboard(target.artboardId)
    }
  }

  function resolveRunConflict(
    runId: string,
    deliverable: ChatRunDeliverable,
    choices: Record<string, 'current' | 'incoming'>,
  ) {
    const resolution = deliverable.conflictResolution
    const currentDocument = useEditorStore.getState().document
    const artboard = currentDocument?.artboards.find((item) => item.id === resolution?.artboardId)
    if (
      !resolution ||
      !currentDocument ||
      !artboard?.designSpec ||
      currentDocument.version !== resolution.currentRevision
    )
      return false
    try {
      const nextSpec = resolveDesignSpecPatchConflicts(
        artboard.designSpec,
        resolution.patch,
        resolution.conflicts,
        choices,
      )
      const result = useEditorStore
        .getState()
        .applyGenericUiStructure(
          { artboardId: artboard.id, created: false, mode: 'append-section' },
          nextSpec,
          currentDocument.version,
        )
      if (!result) return false
      updateActiveThread((thread) => {
        const run = thread.runs?.[runId]
        if (!run) return thread
        return {
          ...thread,
          runs: {
            ...thread.runs,
            [runId]: {
              ...run,
              status: 'completed',
              phaseLabel: '结构冲突已解决并提交',
              error: undefined,
              finishedAt: new Date().toISOString(),
              deliverables: run.deliverables.map((item) =>
                item.id === deliverable.id
                  ? {
                      ...item,
                      status: 'success',
                      summary: `已按节点选择合并 ${result.affectedBlockIds.length} 个 Block。`,
                      errorCode: undefined,
                      conflictResolution: undefined,
                      elementId: result.rootId,
                    }
                  : item,
              ),
            },
          },
        }
      })
      selectArtboard(artboard.id)
      return true
    } catch {
      return false
    }
  }

  function updateConfirmationBlueprint(
    messageId: string,
    update: (
      sections: import('../types').PageCompositionBlueprint['sections'],
    ) => import('../types').PageCompositionBlueprint['sections'],
  ) {
    updateActiveThread((thread) => ({
      ...thread,
      messages: thread.messages.map((message) => {
        if (message.id !== messageId || !message.confirmation) return message
        const current = message.confirmation.blueprint
        const gap =
          current.constraints.find((constraint) => constraint.type === 'vertical-gap')?.value ?? 24
        let cursorY = 0
        const sections = update(current.sections).map((section) => {
          const next = { ...section, bounds: { ...section.bounds, y: cursorY } }
          cursorY += section.bounds.height + gap
          return next
        })
        return {
          ...message,
          confirmation: {
            ...message.confirmation,
            blueprint: {
              ...current,
              estimatedHeight: Math.max(812, cursorY ? cursorY - gap : 812),
              sections,
              constraints: sections.flatMap((section, index) =>
                index
                  ? [
                      {
                        type: 'vertical-gap',
                        from: sections[index - 1].id,
                        to: section.id,
                        value: gap,
                      },
                    ]
                  : [],
              ),
            },
          },
        }
      }),
    }))
  }

  async function onSubmit(
    overrideText?: string,
    blueprintOverride?: import('../types').PageCompositionBlueprint,
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
    // 失败任务点击“重试”时，UI 传入的是控制词；视觉优化必须恢复原始
    // Brief Prompt，否则 Runtime 只会收到“重试”而丢失全部设计约束。
    const requestPrompt =
      overrideText === '重试' && draftSnapshot.visualOptimizationDraft ? draftSnapshot.prompt : text
    updateActiveThread((thread) => ({
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
          role: 'agent',
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
              status: 'understanding',
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

  return (
    <aside className="chat-panel">
      <header className="chat-panel-header">
        <div ref={threadMenuRef} className="chat-thread-menu-wrap">
          <button
            className="chat-title-button"
            type="button"
            onClick={() => setThreadMenuOpen((open) => !open)}
          >
            <span>{activeThread?.title ?? '未命名对话'}</span>
            <ChevronDown size={14} />
          </button>
          {threadMenuOpen ? (
            <div className="chat-panel-thread-list">
              <button className="new-thread" type="button" onClick={createThread}>
                <Plus size={14} />
                <span>新建对话</span>
              </button>
              {threads.map((thread) => (
                <div
                  key={thread.id}
                  className={
                    thread.id === activeThreadId ? 'chat-thread-row active' : 'chat-thread-row'
                  }
                >
                  {editingThreadId === thread.id ? (
                    <input
                      aria-label="对话名称"
                      value={editingTitle}
                      autoFocus
                      onChange={(event) => setEditingTitle(event.target.value)}
                      onBlur={() => saveThreadTitle(thread.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          saveThreadTitle(thread.id)
                        }
                        if (event.key === 'Escape') {
                          setEditingThreadId(null)
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="chat-thread-select"
                      onClick={() => selectThread(thread.id)}
                    >
                      <strong>{thread.title}</strong>
                      <small>
                        {thread.messages.length ? `${thread.messages.length} 条消息` : '空对话'}
                      </small>
                    </button>
                  )}
                  <div className="chat-thread-actions">
                    {editingThreadId === thread.id ? (
                      <button
                        type="button"
                        title="保存名称"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => saveThreadTitle(thread.id)}
                      >
                        <Check size={13} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        title="编辑名称"
                        onClick={() => startRenameThread(thread)}
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                    <button type="button" title="删除对话" onClick={() => removeThread(thread.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="chat-panel-header-actions">
          <button type="button" title="筛选">
            <WandSparkles size={15} />
          </button>
          <button type="button" title="收起对话面板" onClick={onClose}>
            <Maximize2 size={16} />
          </button>
        </div>
      </header>

      <div className="chat-panel-body" ref={bodyRef}>
        {activeThread?.messages.length ? (
          <div className="chat-messages">
            {activeThread.messages.map((message) => (
              <div key={message.id} className={`chat-message-group ${message.role}`}>
                {getStandaloneMessageImages(message.text, message.referenceImages ?? []).length ? (
                  <div className="chat-message-images">
                    {getStandaloneMessageImages(message.text, message.referenceImages ?? []).map(
                      (image) => (
                        <button
                          key={`${message.id}-${image.id}`}
                          type="button"
                          title={image.name}
                          onClick={() => activateMessageImage(image.elementId)}
                        >
                          <img src={image.src} alt={image.name} />
                        </button>
                      ),
                    )}
                  </div>
                ) : null}
                {message.runId &&
                activeThread.runs?.[message.runId] &&
                (message.pending ||
                  activeThread.runs[message.runId].steps.length > 0 ||
                  activeThread.runs[message.runId].deliverables.length > 0 ||
                  activeThread.runs[message.runId].status !== 'completed') ? (
                  <AgentRunTimeline
                    run={activeThread.runs[message.runId]}
                    selectionScope={message.selectionScope}
                    onRetry={
                      activeThread.runs[message.runId].status === 'failed'
                        ? () => void onSubmit('重试', undefined, message.runId, true)
                        : undefined
                    }
                    onLocate={locateRunTarget}
                    onResolveConflict={(deliverable, choices) =>
                      resolveRunConflict(message.runId!, deliverable, choices)
                    }
                  />
                ) : null}
                {message.text ? (
                  <div
                    className={`chat-message ${message.role}${message.pending ? ' typing' : ''}`}
                  >
                    {message.role === 'user'
                      ? renderMessageWithImageMentions(
                          message.text,
                          message.referenceImages ?? [],
                          activateMessageImage,
                        )
                      : message.text}
                  </div>
                ) : null}
                {message.confirmation ? (
                  <BlueprintConfirmationEditor
                    confirmation={message.confirmation}
                    componentOptions={componentMentionOptions}
                    disabled={loading || activeThreadPending}
                    onUpdate={(update) => updateConfirmationBlueprint(message.id, update)}
                    onConfirm={() =>
                      void onSubmit('确认执行', message.confirmation?.blueprint, message.runId)
                    }
                  />
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="chat-panel-empty">
            <h2>和 Agent 聊聊你的想法</h2>
            <div className="empty-upload-row">
              <ImagePlus size={34} />
              <div>
                <span>从已有素材开始</span>
                <small>在底部输入框添加多张参考图</small>
              </div>
            </div>
            <div className="empty-hint">
              <WandSparkles size={16} />
              <p>没有好创意？先和 Agent 聊聊，或者搜一搜站内灵感吧！</p>
            </div>
          </div>
        )}
      </div>

      <div className="chat-panel-compose-area">
        <PromptComposer
          className="chat-panel-composer"
          ariaLabel="右侧对话"
          value={activeThread?.prompt ?? ''}
          images={activeThread?.referenceImages.map((image) => image.src) ?? []}
          imageNames={activeThread?.referenceImages.map((image) => image.name) ?? []}
          imageRoles={activeThread?.referenceImages.map((image) => image.role ?? 'auto') ?? []}
          mentionOptions={[
            ...componentMentionOptions,
            ...(activeThread?.referenceImages ?? []).map((image, index) => ({
              id: image.id,
              resourceId: image.id,
              type: 'image' as const,
              group: 'image' as const,
              name: `图${index + 1} · ${image.name}`,
              label: `图${index + 1}`,
              image: image.src,
            })),
            ...(document?.elements.slice(-20).map((element) => ({
              id: `canvas:${element.id}`,
              resourceId: element.id,
              type: 'canvas-node' as const,
              group: 'canvas' as const,
              name: element.name || element.id,
              label: element.name || element.id,
              description: element.type,
            })) ?? []),
          ]}
          mentions={activeThread?.mentions ?? []}
          textReferences={visibleTextReferences}
          loading={loading || activeThreadPending}
          editBaseRoleEnabled={
            directSelectionScope?.type === 'image-region' ||
            /(?:编辑|修改|修图|替换|擦除|扩图|局部重绘).{0,16}(?:图片|这张图)/iu.test(
              activeThread?.prompt ?? '',
            )
          }
          placeholder="输入需求，或 @ 组件、图片与画布内容"
          contextSlot={
            <>
              {activeThread?.visualOptimizationDraft ? (
                <VisualGenerationSummary
                  draft={activeThread.visualOptimizationDraft}
                  references={visualSummaryReferences}
                  hasAttachedReferences={activeThread.referenceImages.length > 0}
                  onRemove={
                    loading || activeThreadPending
                      ? undefined
                      : () =>
                          updateActiveThread((thread) => ({
                            ...thread,
                            prompt: '',
                            editorState: undefined,
                            mentions: [],
                            visualOptimizationDraft: undefined,
                          }))
                  }
                />
              ) : null}
              {selectionScope ? (
                <SelectionScopeChip
                  scope={selectionScope}
                  action={regenerationReferences.length ? 'regenerate' : 'edit'}
                  onLocate={() => setSelectedElements(getSelectionScopeElementIds(selectionScope))}
                  onLocateTarget={(elementId) => selectElement(elementId)}
                  onRemoveTarget={(elementId) => {
                    const remaining = regenerationReferences.filter(
                      (reference) => reference.elementId !== elementId,
                    )
                    updateActiveThread((thread) => ({
                      ...thread,
                      textReferences: thread.textReferences.filter(
                        (reference) =>
                          !isComponentSlotRegenerationReference(reference) ||
                          reference.elementId !== elementId,
                      ),
                    }))
                    const remainingIds = remaining.flatMap((reference) =>
                      reference.elementId ? [reference.elementId] : [],
                    )
                    if (remainingIds.length) setSelectedElements(remainingIds)
                    else clearSelection()
                  }}
                  onClear={() => {
                    clearSelection()
                    if (regenerationReferences.length) {
                      updateActiveThread((thread) => ({
                        ...thread,
                        textReferences: thread.textReferences.filter(
                          (reference) => !isComponentSlotRegenerationReference(reference),
                        ),
                      }))
                    }
                  }}
                />
              ) : selectionScopeArmed && selectedElementIds.length ? (
                <InvalidSelectionScopeChip onClear={clearSelection} />
              ) : null}
            </>
          }
          actionSlot={
            <>
              <ComposerRuntimeControls
                runtimeModel={runtimeModel}
                imageModel={imageModel}
                stylePackId={stylePackId}
                onRuntimeModelChange={setRuntimeModel}
                onImageModelChange={setImageModel}
                onStylePackChange={setStylePackId}
              />
            </>
          }
          onChange={setPrompt}
          onMentionsChange={(mentions) => updateActiveThread((thread) => ({ ...thread, mentions }))}
          onImportComponent={importComponent}
          onMentionSelect={(option) => {
            if (option.type === 'canvas-node') selectElement(option.resourceId ?? option.id)
          }}
          onEditorStateChange={(editorState) =>
            updateActiveThread((thread) => ({ ...thread, editorState }))
          }
          onImagesChange={setReferenceImages}
          onImageRoleChange={setReferenceImageRole}
          onImageClick={activateImageReference}
          onTextReferenceClick={activateTextReference}
          onTextReferenceRemove={removeTextReference}
          onCursorChange={(offset) =>
            activeThread &&
            setComposerCursorByThread((current) => ({
              ...current,
              [activeThread.id]: offset,
            }))
          }
          onSubmit={onSubmit}
          onStop={() => {
            const sessionId = activeRunSessionId ?? activeThread?.id
            if (sessionId) void window.aiCampaignRuntime?.cancelAgent(sessionId)
          }}
        />
      </div>
    </aside>
  )
}

export function VisualGenerationSummary({
  draft,
  references,
  hasAttachedReferences,
  onRemove,
}: {
  draft: NonNullable<EditorChatThread['visualOptimizationDraft']>
  references: EditorChatImage[]
  hasAttachedReferences: boolean
  onRemove?: () => void
}) {
  const summary = summarizeVisualRedesignBrief(draft.brief)
  const roleDescriptions: Record<NonNullable<EditorChatImage['role']>, string> = {
    auto: 'Auto · 提交时根据任务与图片语义自动判断',
    content: '原图素材 · 保留像素并直接用于页面',
    kv: 'KV · 控制颜色、材质与视觉语言',
    prototype: 'Prototype · 控制结构、模块顺序与原文案',
    visual: 'Visual · 只影响指定的局部风格',
    'edit-base': 'Edit Base · 保持主体与未修改区域',
  }
  const roleResolutions = resolveReferenceImageRoles(references, {
    prompt: JSON.stringify(draft.brief),
    hasVisualBrief: true,
  })
  const resolvedRoleLabels = {
    content: '原图素材',
    kv: 'KV',
    prototype: 'Prototype',
    visual: 'Visual',
    'edit-base': 'Edit Base',
  }

  return (
    <details className="visual-generation-summary" open>
      <summary>
        <span>
          <FileCheck2 size={15} />
          生成前确认
        </span>
        <span className="visual-generation-summary-actions">
          <em>待确认 · 独立 Variant</em>
          {onRemove ? (
            <button
              type="button"
              title="取消本次视觉优化，保留参考图"
              aria-label="取消本次视觉优化"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onRemove()
              }}
            >
              <X size={13} />
            </button>
          ) : null}
        </span>
      </summary>
      <div className="visual-generation-summary-body">
        <div className="visual-summary-source">
          <span>基于原稿</span>
          <strong>{draft.sourceArtboardName}</strong>
          <small>原画板不会被覆盖</small>
        </div>
        <div className="visual-summary-columns">
          <section>
            <strong>必须保留</strong>
            <div>
              {summary.preserve.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </section>
          <section>
            <strong>重点重设计</strong>
            <div>
              {summary.change.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </section>
        </div>
        <section className="visual-summary-references">
          <strong>本次实际发送的参考图</strong>
          {references.length ? (
            <div>
              {references.map((reference, index) => {
                const role = reference.role ?? 'auto'
                const resolution = roleResolutions[index]
                return (
                  <span key={reference.id} data-role={resolution.resolvedRole}>
                    <img src={reference.src} alt="" />
                    <span>
                      <b>{reference.name}</b>
                      <small>
                        {role === 'auto'
                          ? `Auto → ${resolvedRoleLabels[resolution.resolvedRole]} · ${resolution.reason}`
                          : roleDescriptions[role]}
                      </small>
                    </span>
                  </span>
                )
              })}
            </div>
          ) : (
            <p>
              {hasAttachedReferences
                ? '当前 @ 引用没有匹配到附件，本次不会发送参考图。'
                : '未添加参考图，将从当前画板和 Brief 推导视觉方向。'}
            </p>
          )}
        </section>
      </div>
    </details>
  )
}

function BlueprintConfirmationEditor({
  confirmation,
  componentOptions,
  disabled,
  onUpdate,
  onConfirm,
}: {
  confirmation: BlueprintConfirmation
  componentOptions: import('../../../components/ui/PromptComposer').PromptMentionOption[]
  disabled: boolean
  onUpdate: (
    update: (
      sections: import('../types').PageCompositionBlueprint['sections'],
    ) => import('../types').PageCompositionBlueprint['sections'],
  ) => void
  onConfirm: () => void
}) {
  const [draggedSectionId, setDraggedSectionId] = useState<string>()
  const blueprint = confirmation.blueprint
  const replacementOptions = componentOptions.filter(
    (option) => option.packId && option.componentName,
  )

  function moveSection(sectionId: string, targetIndex: number) {
    onUpdate((sections) => {
      const sourceIndex = sections.findIndex((section) => section.id === sectionId)
      if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= sections.length) return sections
      const next = [...sections]
      const [section] = next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, section)
      return next
    })
  }

  function updateSectionHeight(sectionId: string, height: number) {
    onUpdate((sections) =>
      sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              bounds: { ...section.bounds, height: Math.max(120, Math.min(3000, height)) },
            }
          : section,
      ),
    )
  }

  return (
    <div className="blueprint-confirmation-card">
      <div className="blueprint-confirmation-header">
        <div>
          <strong>页面结构</strong>
          <small>拖拽排序 · 调整高度 · 替换组件</small>
        </div>
        <span>
          {blueprint.width} × {blueprint.estimatedHeight}
        </span>
      </div>
      <div className="blueprint-confirmation-sections">
        {blueprint.sections.map((section, index) => {
          const currentOption = replacementOptions.find(
            (option) =>
              option.componentName === section.component?.componentName &&
              (!section.component?.reference?.packId ||
                option.packId === section.component?.reference?.packId),
          )
          return (
            <div
              className={draggedSectionId === section.id ? 'dragging' : undefined}
              key={section.id}
              onDragOver={(event) => {
                if (!draggedSectionId || draggedSectionId === section.id) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (draggedSectionId) moveSection(draggedSectionId, index)
                setDraggedSectionId(undefined)
              }}
            >
              <button
                className="blueprint-drag-handle"
                type="button"
                draggable
                title="拖拽调整模块顺序"
                aria-label={`拖拽第 ${index + 1} 个模块`}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', section.id)
                  setDraggedSectionId(section.id)
                }}
                onDragEnd={() => setDraggedSectionId(undefined)}
              >
                <GripVertical size={14} />
              </button>
              <span className="blueprint-section-index">{index + 1}</span>
              <div className="blueprint-section-copy">
                <input
                  className="blueprint-section-role-input"
                  value={section.role}
                  aria-label={`第 ${index + 1} 个模块名称`}
                  onChange={(event) =>
                    onUpdate((sections) =>
                      sections.map((item) =>
                        item.id === section.id ? { ...item, role: event.target.value } : item,
                      ),
                    )
                  }
                />
                <small>{section.component?.componentName ?? section.kind}</small>
              </div>
              <button
                className="blueprint-delete-action"
                type="button"
                title="删除模块"
                disabled={blueprint.sections.length <= 1}
                onClick={() =>
                  onUpdate((sections) => sections.filter((item) => item.id !== section.id))
                }
              >
                <Trash2 size={14} />
              </button>

              <div className="blueprint-section-controls">
                {section.kind === 'component-instance' ? (
                  <label className="blueprint-component-select">
                    <span>组件</span>
                    <select
                      value={currentOption?.id ?? ''}
                      disabled={!replacementOptions.length}
                      onChange={(event) => {
                        const option = replacementOptions.find(
                          (item) => item.id === event.target.value,
                        )
                        if (!option?.packId || !option.componentName) return
                        onUpdate((sections) =>
                          sections.map((item) =>
                            item.id === section.id
                              ? {
                                  ...item,
                                  component: {
                                    componentName: option.componentName!,
                                    reference: {
                                      packId: option.packId!,
                                      componentName: option.componentName!,
                                      label: option.label,
                                    },
                                  },
                                }
                              : item,
                          ),
                        )
                      }}
                    >
                      {!currentOption ? (
                        <option value="">{section.component?.componentName ?? '选择组件'}</option>
                      ) : null}
                      {replacementOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label || option.componentName}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="blueprint-height-control">
                  <span>高度</span>
                  <button
                    type="button"
                    title="减少模块高度"
                    onClick={() => updateSectionHeight(section.id, section.bounds.height - 40)}
                  >
                    <Minus size={12} />
                  </button>
                  <input
                    type="number"
                    min={120}
                    max={3000}
                    step={20}
                    value={Math.round(section.bounds.height)}
                    onChange={(event) =>
                      updateSectionHeight(section.id, Number(event.target.value) || 120)
                    }
                  />
                  <button
                    type="button"
                    title="增加模块高度"
                    onClick={() => updateSectionHeight(section.id, section.bounds.height + 40)}
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <div className="blueprint-order-actions">
                  <button
                    type="button"
                    title="上移模块"
                    disabled={index === 0}
                    onClick={() => moveSection(section.id, index - 1)}
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    type="button"
                    title="下移模块"
                    disabled={index === blueprint.sections.length - 1}
                    onClick={() => moveSection(section.id, index + 1)}
                  >
                    <ChevronDown size={13} />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <button type="button" disabled={disabled} onClick={onConfirm}>
        <Check size={14} />
        确认结构并生成
      </button>
    </div>
  )
}

function collectThreadMentionImages(thread: EditorChatThread | undefined) {
  if (!thread) return []
  const imageMap = new Map<string, EditorChatThread['referenceImages'][number]>()
  thread.referenceImages.forEach((image) => imageMap.set(image.src, image))
  thread.messages.forEach((message) => {
    message.referenceImages?.forEach((image) => {
      if (!imageMap.has(image.src)) imageMap.set(image.src, image)
    })
  })
  return Array.from(imageMap.values())
}

function refreshRetrySelectionScope(
  document: DesignDocument,
  scope: SelectionScope | undefined,
): SelectionScope | undefined {
  if (!scope) return undefined
  if (scope.type === 'generic-node') {
    return createSelectionScope(document, [scope.elementId])
  }
  if (scope.type === 'design-block') {
    return createSelectionScope(document, [scope.elementId])
  }
  if (scope.type === 'multi-node') {
    return createSelectionScope(document, scope.elementIds)
  }
  // Text ranges and image masks carry user-owned frozen data. Keep them for
  // conflict validation instead of silently rebuilding a different range.
  return scope
}

function renderMessageWithImageMentions(
  text: string,
  images: EditorChatImage[],
  onImageClick: (elementId?: string) => void,
) {
  if (!images.length) return text

  const matches = images
    .map((image, imageIndex) => {
      const labels = getImageMentionLabels(image.name)
      const shortLabel = getMessageImageLabel(imageIndex)
      const label = [shortLabel, ...labels].find((item) => text.includes(`@${item}`))
      const index = label ? text.indexOf(`@${label}`) : getImageMentionIndex(text, image.name)
      return label && index >= 0 ? { image, imageIndex, label: `@${label}`, index } : null
    })
    .filter(
      (
        item,
      ): item is { image: EditorChatImage; imageIndex: number; label: string; index: number } =>
        Boolean(item),
    )
    .sort((a, b) => a.index - b.index)

  if (!matches.length) {
    return text
  }

  const nodes: ReactNode[] = []
  let cursor = 0
  matches.forEach((match) => {
    const start = text.indexOf(match.label, cursor)
    if (start < 0) return
    if (start > cursor) nodes.push(text.slice(cursor, start))
    nodes.push(renderMessageImageChip(match.image, match.imageIndex, onImageClick))
    cursor = start + match.label.length
  })
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

function renderMessageImageChip(
  image: EditorChatImage,
  index: number,
  onImageClick: (elementId?: string) => void,
) {
  return (
    <button
      key={`message-image-${image.id}`}
      className="chat-message-image-chip"
      type="button"
      title={image.name}
      onClick={() => onImageClick(image.elementId)}
    >
      <img src={image.src} alt="" />
      <span>{getMessageImageLabel(index)}</span>
    </button>
  )
}
