import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  ImagePlus,
  Maximize2,
  Pencil,
  Plus,
  Trash2,
  WandSparkles,
} from 'lucide-react'
import type { ChatRunDeliverable } from '../../ai/agent-run'
import { useEditorStore } from '../store/editor-store'
import type { EditorChatImage, EditorChatThread } from '../store/editor-store'
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
} from '../utils/selection-scope'
import { upsertQueuedComposerReference } from '../utils/composer-target'
import { AgentRunTimeline } from './AgentRunTimeline'
import { resolveDesignSpecPatchConflicts } from '../utils/design-spec-patch'
import { useComponentMentions } from '../hooks/use-component-mentions'
import { InvalidSelectionScopeChip, SelectionScopeChip } from './SelectionScopeChip'
import { useChatRunSubmit } from '../hooks/use-chat-run-submit'
import { VisualGenerationSummary } from './VisualGenerationSummary'
import { BlueprintConfirmationEditor } from './BlueprintConfirmationEditor'

export { VisualGenerationSummary } from './VisualGenerationSummary'

interface ChatPanelProps {
  onClose: () => void
  initialPrompt?: string
}

export function ChatPanel({ onClose, initialPrompt }: ChatPanelProps) {
  const document = useEditorStore((state) => state.document)
  const selectElement = useEditorStore((state) => state.selectElement)
  const selectArtboard = useEditorStore((state) => state.selectArtboard)
  const setSelectedElements = useEditorStore((state) => state.setSelectedElements)
  const clearSelection = useEditorStore((state) => state.clearSelection)
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const selectionScopeArmed = useEditorStore((state) => state.selectionScopeArmed)
  const textRangeSelection = useEditorStore((state) => state.textRangeSelection)
  const imageRegionSelection = useEditorStore((state) => state.imageRegionSelection)
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
  const [threadMenuOpen, setThreadMenuOpen] = useState(false)
  const threadMenuRef = useRef<HTMLDivElement>(null)
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [composerCursorByThread, setComposerCursorByThread] = useState<Record<string, number>>({})
  const { runtimeModel, imageModel, stylePackId, setRuntimeModel, setImageModel, setStylePackId } =
    useRuntimeSettings()
  const bodyRef = useRef<HTMLDivElement>(null)
  const initialPromptRef = useRef<string | undefined>(undefined)
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
  const { loading, activeRunSessionId, onSubmit } = useChatRunSubmit({
    activeThread,
    activeThreadPending,
    regenerationReferences,
    visibleTextReferences,
    runtimeModel,
    imageModel,
    stylePackId,
  })

  useEffect(() => {
    const prompt = initialPrompt?.trim()
    if (!prompt || !activeThread || activeThread.messages.length || loading) return
    if (initialPromptRef.current === prompt) return
    initialPromptRef.current = prompt
    void onSubmit(prompt)
    // onSubmit is intentionally omitted; the ref guarantees one dispatch per prompt value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread, initialPrompt, loading])

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
            if (sessionId) void window.lumenRuntime?.cancelAgent(sessionId)
          }}
        />
      </div>
    </aside>
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
