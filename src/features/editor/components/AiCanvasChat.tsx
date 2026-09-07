import { FocusEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { executeDesignChatTurn } from '../../ai/design-chat-controller'
import { createChatRun } from '../../ai/agent-run'
import { useEditorStore } from '../store/editor-store'
import type { EditorChatThread } from '../store/editor-store'
import { PromptComposer, type PromptTextReference } from '../../../components/ui/PromptComposer'
import { getPromptReferenceImages } from '../utils/chat-references'
import { getComponentReferences } from '../../ai/composer-draft'
import { useComponentMentions } from '../hooks/use-component-mentions'
import { ComposerRuntimeControls } from './ComposerRuntimeControls'
import { useRuntimeSettings } from '../../ai/runtime-settings'
import { DEFAULT_ARTBOARD_HEIGHT, DEFAULT_ARTBOARD_WIDTH } from '../constants'
import {
  createComponentRegionBatchScope,
  createSelectionScope,
  getSelectionScopeElementIds,
  isComponentSlotRegenerationReference,
  isAssetRegenerationPrompt,
} from '../utils/selection-scope'
import { upsertQueuedComposerReference } from '../utils/composer-target'
import { InvalidSelectionScopeChip, SelectionScopeChip } from './SelectionScopeChip'
import { VisualGenerationSummary } from './ChatPanel'
import { buildVisualAssetPlan } from '../utils/visual-brief'

interface AiCanvasChatProps {
  onOpenChatPanel?: () => void
}

export function AiCanvasChat({ onOpenChatPanel }: AiCanvasChatProps) {
  const document = useEditorStore((state) => state.document)
  const selectElement = useEditorStore((state) => state.selectElement)
  const setSelectedElements = useEditorStore((state) => state.setSelectedElements)
  const clearSelection = useEditorStore((state) => state.clearSelection)
  const consumeSelectionScope = useEditorStore((state) => state.consumeSelectionScope)
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const selectionScopeArmed = useEditorStore((state) => state.selectionScopeArmed)
  const textRangeSelection = useEditorStore((state) => state.textRangeSelection)
  const imageRegionSelection = useEditorStore((state) => state.imageRegionSelection)
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId)
  const selectedArtboardId = useEditorStore((state) => state.selectedArtboardId)
  const chatThreads = useEditorStore((state) => state.chatThreads)
  const activeChatThreadId = useEditorStore((state) => state.activeChatThreadId)
  const setActiveChatThread = useEditorStore((state) => state.setActiveChatThread)
  const updateChatThread = useEditorStore((state) => state.updateChatThread)
  const queuedReferenceImages = useEditorStore((state) => state.queuedReferenceImages)
  const consumeQueuedReferenceImages = useEditorStore((state) => state.consumeQueuedReferenceImages)
  const queuedChatTexts = useEditorStore((state) => state.queuedChatTexts)
  const consumeQueuedChatTexts = useEditorStore((state) => state.consumeQueuedChatTexts)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const { componentMentionOptions, importComponent } = useComponentMentions(document?.id)
  const [activeRunSessionId, setActiveRunSessionId] = useState<string>()
  const [threadMenuOpen, setThreadMenuOpen] = useState(false)
  const threadSwitcherRef = useRef<HTMLDivElement>(null)
  const [composerCursorOffset, setComposerCursorOffset] = useState(0)
  const { runtimeModel, imageModel, stylePackId, setRuntimeModel, setImageModel, setStylePackId } =
    useRuntimeSettings()
  const activeThread =
    chatThreads.find((thread) => thread.id === activeChatThreadId) ?? chatThreads[0]
  const prompt = activeThread?.prompt ?? ''
  const activeImages = useMemo(
    () => activeThread?.referenceImages ?? [],
    [activeThread?.referenceImages],
  )
  const textReferences = useMemo(
    () => activeThread?.textReferences ?? [],
    [activeThread?.textReferences],
  )
  const mentions = useMemo(() => activeThread?.mentions ?? [], [activeThread?.mentions])
  const directSelectionScope =
    document && selectionScopeArmed
      ? createSelectionScope(document, selectedElementIds, textRangeSelection, imageRegionSelection)
      : undefined
  const regenerationReferences = textReferences.filter(isComponentSlotRegenerationReference)
  const regenerationScope = document
    ? createComponentRegionBatchScope(
        document,
        regenerationReferences.flatMap((reference) =>
          reference.elementId ? [reference.elementId] : [],
        ),
      )
    : undefined
  const selectionScope = regenerationScope ?? directSelectionScope
  const visibleTextReferences = textReferences.filter(
    (reference) => !isComponentSlotRegenerationReference(reference),
  )

  const updateActiveThread = useCallback(
    (updater: (thread: EditorChatThread) => EditorChatThread) => {
      if (!activeThread) return
      updateChatThread(activeThread.id, updater)
    },
    [activeThread, updateChatThread],
  )

  useEffect(() => {
    if (!threadMenuOpen) return

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !threadSwitcherRef.current?.contains(target)) {
        setThreadMenuOpen(false)
      }
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setThreadMenuOpen(false)
    }

    globalThis.document.addEventListener('pointerdown', handlePointerDown)
    globalThis.document.addEventListener('keydown', handleKeyDown)
    return () => {
      globalThis.document.removeEventListener('pointerdown', handlePointerDown)
      globalThis.document.removeEventListener('keydown', handleKeyDown)
    }
  }, [threadMenuOpen])

  useEffect(() => {
    if (!queuedReferenceImages.some((image) => image.target === 'bottom')) return
    const images = consumeQueuedReferenceImages('bottom')
    if (!images.length || !activeThread) return
    updateActiveThread((thread) => {
      const nextImages = [...thread.referenceImages]
      images.forEach((image) => {
        if (!nextImages.some((item) => item.src === image.src)) {
          nextImages.push({
            id: image.id,
            name: image.name,
            src: image.src,
            elementId: image.elementId,
          })
        }
      })
      return { ...thread, referenceImages: nextImages }
    })
    setExpanded(true)
  }, [activeThread, consumeQueuedReferenceImages, queuedReferenceImages, updateActiveThread])

  useEffect(() => {
    if (!queuedChatTexts.some((item) => item.target === 'bottom')) return
    const texts = consumeQueuedChatTexts('bottom')
    if (!texts.length || !activeThread) return
    updateActiveThread((thread) => {
      let nextReferences = [...thread.textReferences]
      texts.forEach((item) => {
        nextReferences = upsertQueuedComposerReference(
          nextReferences,
          item,
          Math.min(composerCursorOffset, thread.prompt.length),
        )
      })
      return { ...thread, textReferences: nextReferences }
    })
    const regenerationIds = [
      ...textReferences
        .filter(isComponentSlotRegenerationReference)
        .flatMap((reference) => (reference.elementId ? [reference.elementId] : [])),
      ...texts
        .filter((item) => item.kind === 'component-region-regeneration')
        .flatMap((item) => (item.elementId ? [item.elementId] : [])),
    ]
    if (regenerationIds.length) setSelectedElements([...new Set(regenerationIds)])
    setExpanded(true)
  }, [
    activeThread,
    composerCursorOffset,
    consumeQueuedChatTexts,
    queuedChatTexts,
    setSelectedElements,
    textReferences,
    updateActiveThread,
  ])

  async function submitPrompt() {
    if (loading || !activeThread) return
    const useAssetScope = isAssetRegenerationPrompt(prompt)
    const turnRegenerationReferences = useAssetScope ? regenerationReferences : []
    const frozenSelectionScope = document
      ? (createComponentRegionBatchScope(
          document,
          turnRegenerationReferences.flatMap((reference) =>
            reference.elementId ? [reference.elementId] : [],
          ),
        ) ??
        createSelectionScope(
          document,
          selectionScopeArmed ? selectedElementIds : [],
          useEditorStore.getState().textRangeSelection,
          useEditorStore.getState().imageRegionSelection,
        ))
      : undefined
    if (
      ((selectionScopeArmed && selectedElementIds.length > 0) ||
        turnRegenerationReferences.length) &&
      !frozenSelectionScope
    )
      return
    const requestImages = getPromptReferenceImages(prompt, activeImages, mentions)
    const componentReferences = getComponentReferences(mentions)
    consumeSelectionScope()

    const request = {
      prompt:
        [visibleTextReferences.map((reference) => reference.text).join(' '), prompt.trim()]
          .filter(Boolean)
          .join(' ') ||
        (turnRegenerationReferences.length
          ? '重新生成选中的组件素材'
          : '结合当前画布和参考图继续创作'),
      type: 'landing-page',
      size: { width: DEFAULT_ARTBOARD_WIDTH, height: DEFAULT_ARTBOARD_HEIGHT },
      style: '自动',
      referenceImages: requestImages.map((image) => image.src),
      referenceImageNames: requestImages.map((image) => image.name),
      referenceImageRoles: requestImages.map((image) => image.role ?? 'auto'),
    }

    const threadId = activeThread.id
    setActiveRunSessionId(threadId)
    const pendingMessageId = `agent-pending-${Date.now()}`
    const runId = `chat-run-${Date.now()}`
    const draftSnapshot = {
      prompt,
      mentions: [...mentions],
      referenceImages: [...activeImages],
      textReferences: [...textReferences],
      visualOptimizationDraft: activeThread.visualOptimizationDraft,
    }
    updateActiveThread((thread) => ({
      ...thread,
      title: thread.messages.length ? thread.title : request.prompt.slice(0, 18) || '未命名对话',
      prompt: '',
      editorState: undefined,
      mentions: [],
      referenceImages: [],
      textReferences: [],
      messages: [
        ...thread.messages,
        {
          id: `user-${Date.now()}`,
          role: 'user',
          text: request.prompt,
          mentions: mentions.map((mention) => ({ ...mention })),
          referenceImages: requestImages.map((image) => ({ ...image })),
        },
        {
          id: pendingMessageId,
          role: 'agent',
          text: '',
          pending: true,
          runId,
          selectionScope: frozenSelectionScope,
        },
      ],
      runs: { ...thread.runs, [runId]: createChatRun(runId, pendingMessageId) },
    }))
    const initialDocument = useEditorStore.getState().document
    if (!initialDocument) return
    const requestDocument = useEditorStore.getState().document ?? initialDocument
    onOpenChatPanel?.()
    setExpanded(false)
    setThreadMenuOpen(false)
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
          prompt: request.prompt,
          document: requestDocument,
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
          mentions,
          componentReferences,
          referenceImages: request.referenceImages,
          referenceImageNames: request.referenceImageNames,
          referenceImageRoles: request.referenceImageRoles,
          textReferences,
          selectedElementIds,
          activeArtboardId,
          selectedArtboardId,
          editScope: frozenSelectionScope,
          componentRegionAction:
            useAssetScope && frozenSelectionScope?.type === 'component-region-batch'
              ? { kind: 'regenerate-component-regions', targets: frozenSelectionScope.targets }
              : undefined,
          visualBrief: draftSnapshot.visualOptimizationDraft?.brief,
          visualAssetPlan: (() => {
            const draft = draftSnapshot.visualOptimizationDraft
            const target = requestDocument.artboards.find(
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
      setExpanded(true)
    } finally {
      setActiveRunSessionId(undefined)
      setLoading(false)
    }
  }

  function syncComposerImages(nextSources: string[], nextNames: string[] = []) {
    updateActiveThread((thread) => {
      const currentBySrc = new Map(thread.referenceImages.map((image) => [image.src, image]))
      return {
        ...thread,
        referenceImages: nextSources.map(
          (src, index) =>
            currentBySrc.get(src) ?? {
              id: `upload-${Date.now()}-${index}`,
              name: nextNames[index] || `参考图 ${index + 1}`,
              src,
              role: 'auto',
            },
        ),
      }
    })
    setExpanded(true)
  }

  function setReferenceImageRole(
    index: number,
    role: NonNullable<(typeof activeImages)[number]['role']>,
  ) {
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
    setExpanded(true)
  }

  function onPromptChange(value: string) {
    updateActiveThread((thread) => ({ ...thread, prompt: value }))
  }

  function activateTextReference(reference: PromptTextReference) {
    if (!reference.elementId) return
    selectElement(reference.elementId)
  }

  function activateImageReference({ index }: { index: number }) {
    const image = activeImages[index]
    if (!image?.elementId) return false
    const exists = document?.elements.some((element) => element.id === image.elementId)
    if (!exists) return false
    selectElement(image.elementId)
    return true
  }

  function stopCanvasPointer(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation()
  }

  function onComposerBlur(event: FocusEvent<HTMLElement>) {
    const chatCard = event.currentTarget.closest('.ai-chat-card')
    window.setTimeout(() => {
      if (chatCard?.contains(window.document.activeElement)) return
      setExpanded(false)
    }, 160)
  }

  function selectThread(thread: EditorChatThread) {
    setActiveChatThread(thread.id)
    setThreadMenuOpen(false)
    setExpanded(true)
  }

  const activeThreadImage = activeThread?.referenceImages[0]

  return (
    <div
      className={expanded ? 'ai-chat-card expanded' : 'ai-chat-card compact'}
      onPointerDown={stopCanvasPointer}
      onFocus={() => setExpanded(true)}
    >
      {chatThreads.length > 1 && activeThread ? (
        <div
          ref={threadSwitcherRef}
          className={`chat-thread-switcher${threadMenuOpen ? ' is-open' : ''}`}
        >
          <button
            className="active-thread-pill"
            type="button"
            aria-expanded={threadMenuOpen}
            aria-controls="chat-thread-list"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={() => {
              setThreadMenuOpen((open) => !open)
              setExpanded(true)
            }}
          >
            {activeThreadImage ? <img src={activeThreadImage.src} alt="" /> : <span />}
            <strong>{activeThread.title}</strong>
            <small>↗</small>
          </button>
          {threadMenuOpen ? (
            <div id="chat-thread-list" className="chat-thread-list">
              {chatThreads.map((thread) => {
                const threadImage = thread.referenceImages[0]
                return (
                  <button
                    key={thread.id}
                    type="button"
                    className={thread.id === activeChatThreadId ? 'active' : undefined}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                    onClick={() => selectThread(thread)}
                  >
                    {threadImage ? <img src={threadImage.src} alt="" /> : <span />}
                    <strong>{thread.title}</strong>
                    <small>{thread.id === activeChatThreadId ? '当前' : '打开对话'}</small>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="ai-chat-form-wrap">
        <PromptComposer
          compact={!expanded}
          iconOnlyActions
          className="ai-chat-composer"
          ariaLabel="AI 对话"
          value={prompt}
          images={activeImages.map((image) => image.src)}
          imageNames={activeImages.map((image) => image.name)}
          imageRoles={activeImages.map((image) => image.role ?? 'auto')}
          mentionOptions={[
            ...componentMentionOptions,
            ...activeImages.map((image, index) => ({
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
          mentions={mentions}
          textReferences={visibleTextReferences}
          loading={loading}
          editBaseRoleEnabled={
            directSelectionScope?.type === 'image-region' ||
            /(?:编辑|修改|修图|替换|擦除|扩图|局部重绘).{0,16}(?:图片|这张图)/iu.test(prompt)
          }
          placeholder="结合参考、输入文字或 @ 主体，说说今天想做什么。"
          contextSlot={
            <>
              {activeThread?.visualOptimizationDraft ? (
                <VisualGenerationSummary
                  draft={activeThread.visualOptimizationDraft}
                  references={getPromptReferenceImages(prompt, activeImages, mentions)}
                  hasAttachedReferences={activeImages.length > 0}
                  onRemove={
                    loading
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
          showActions={expanded}
          actionSlot={
            expanded ? (
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
            ) : null
          }
          onFocus={() => setExpanded(true)}
          onBlur={onComposerBlur}
          onChange={onPromptChange}
          onMentionsChange={(nextMentions) =>
            updateActiveThread((thread) => ({ ...thread, mentions: nextMentions }))
          }
          onImportComponent={importComponent}
          onMentionSelect={(option) => {
            if (option.type === 'canvas-node') selectElement(option.resourceId ?? option.id)
          }}
          onImagesChange={syncComposerImages}
          onImageRoleChange={setReferenceImageRole}
          onImageClick={activateImageReference}
          onTextReferenceClick={activateTextReference}
          onTextReferenceRemove={(id) =>
            updateActiveThread((thread) => ({
              ...thread,
              textReferences: thread.textReferences.filter((reference) => reference.id !== id),
            }))
          }
          onCursorChange={setComposerCursorOffset}
          onSubmit={submitPrompt}
          onStop={() =>
            activeRunSessionId && window.aiCampaignRuntime?.cancelAgent(activeRunSessionId)
          }
        />
      </div>
    </div>
  )
}
