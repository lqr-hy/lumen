import { FocusEvent, PointerEvent, useEffect, useState } from 'react'
import { Square } from 'lucide-react'
import { applyChatEdit } from '../../ai/api'
import { getAgentEventStatus } from '../../ai/agent-events'
import { useEditorStore } from '../store/editor-store'
import type { EditorChatThread } from '../store/editor-store'
import { PromptComposer, type PromptTextReference } from '../../../components/ui/PromptComposer'
import { getPromptReferenceImages } from '../utils/chat-references'
import { RuntimeModelSelect, type RuntimeModelSelection } from './RuntimeModelSelect'
import { DEFAULT_ARTBOARD_HEIGHT, DEFAULT_ARTBOARD_WIDTH } from '../constants'
import { PlacementModeControl } from './PlacementModeControl'
import { resolvePlacementIntent, type PlacementMode } from '../utils/placement-intent'
import { createComponentEditScope } from '../utils/component-edit-scope'
import { applyIncrementalCanvasDeliverable } from '../utils/incremental-delivery'

interface ChatImage {
  id: string
  name: string
  src: string
  elementId?: string
}

interface ChatThread {
  id: string
  title: string
  prompt: string
  imageIds: string[]
}

interface AiCanvasChatProps {
  onOpenChatPanel?: () => void
}

export function AiCanvasChat({ onOpenChatPanel }: AiCanvasChatProps) {
  const document = useEditorStore((state) => state.document)
  const ensureChatThreadArtboard = useEditorStore((state) => state.ensureChatThreadArtboard)
  const applyGeneratedImage = useEditorStore((state) => state.applyGeneratedImage)
  const applyComponentDesign = useEditorStore((state) => state.applyComponentDesign)
  const applyPageDesign = useEditorStore((state) => state.applyPageDesign)
  const applyComponentSlotImage = useEditorStore((state) => state.applyComponentSlotImage)
  const selectElement = useEditorStore((state) => state.selectElement)
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const addChatThread = useEditorStore((state) => state.addChatThread)
  const updateChatThread = useEditorStore((state) => state.updateChatThread)
  const queuedReferenceImages = useEditorStore((state) => state.queuedReferenceImages)
  const consumeQueuedReferenceImages = useEditorStore(
    (state) => state.consumeQueuedReferenceImages,
  )
  const queuedChatTexts = useEditorStore((state) => state.queuedChatTexts)
  const consumeQueuedChatTexts = useEditorStore((state) => state.consumeQueuedChatTexts)
  const [expanded, setExpanded] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeRunSessionId, setActiveRunSessionId] = useState<string>()
  const [threadMenuOpen, setThreadMenuOpen] = useState(false)
  const [uploadedImages, setUploadedImages] = useState<ChatImage[]>([])
  const [activeImageIds, setActiveImageIds] = useState<string[]>([])
  const [textReferences, setTextReferences] = useState<PromptTextReference[]>([])
  const [composerCursorOffset, setComposerCursorOffset] = useState(0)
  const [activeThreadId, setActiveThreadId] = useState('thread-default')
  const [runtimeModel, setRuntimeModel] = useState<RuntimeModelSelection>({
    provider: 'codex',
    model: 'gpt-5.5',
  })
  const [imageModel, setImageModel] = useState<RuntimeModelSelection>({
    provider: 'biliImage',
    model: 'gpt-image-2',
  })
  const [placementMode, setPlacementMode] = useState<PlacementMode>('auto')
  const [threads, setThreads] = useState<ChatThread[]>([
    {
      id: 'thread-default',
      title: document?.title ?? '未命名对话',
      prompt: '结合当前画布继续创作',
      imageIds: [],
    },
  ])

  const activeImages = uploadedImages.filter((image) => activeImageIds.includes(image.id))
  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? threads[0]

  useEffect(() => {
    if (!queuedReferenceImages.some((image) => image.target === 'bottom')) return
    const images = consumeQueuedReferenceImages('bottom')
    if (!images.length) return
    setUploadedImages((current) => {
      const nextImages = [...current]
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
      return nextImages
    })
    setActiveImageIds((current) => {
      const nextIds = [...current]
      images.forEach((image) => {
        if (!nextIds.includes(image.id)) nextIds.push(image.id)
      })
      return nextIds
    })
    setExpanded(true)
  }, [consumeQueuedReferenceImages, queuedReferenceImages])

  useEffect(() => {
    if (!queuedChatTexts.some((item) => item.target === 'bottom')) return
    const texts = consumeQueuedChatTexts('bottom')
    if (!texts.length) return
    setTextReferences((current) => {
      const nextReferences = [...current]
      texts.forEach((item) => {
        const text = item.text.trim()
        if (!text) return
        if (nextReferences.some((reference) => reference.elementId === item.elementId)) return
        nextReferences.push({
          id: item.id,
          text,
          elementId: item.elementId,
          insertOffset: Math.min(composerCursorOffset, prompt.length),
        })
      })
      return nextReferences
    })
    setExpanded(true)
  }, [composerCursorOffset, consumeQueuedChatTexts, prompt.length, queuedChatTexts])

  async function submitPrompt() {
    if (loading) return
    const requestImages = getPromptReferenceImages(prompt, activeImages)

    const request = {
      prompt:
        [textReferences.map((reference) => reference.text).join(' '), prompt.trim()]
          .filter(Boolean)
          .join(' ') || '结合当前画布和参考图继续创作',
      type: 'landing-page',
      size: { width: DEFAULT_ARTBOARD_WIDTH, height: DEFAULT_ARTBOARD_HEIGHT },
      style: '自动',
      referenceImages: requestImages.map((image) => image.src),
      referenceImageNames: requestImages.map((image) => image.name),
    }

    const nextThread: ChatThread = {
      id: `thread-${Date.now()}`,
      title: request.prompt.slice(0, 18) || '未命名对话',
      prompt: request.prompt,
      imageIds: [...activeImageIds],
    }
    const panelThreadId = `panel-thread-${Date.now()}`
    setActiveRunSessionId(panelThreadId)
    const pendingMessageId = `agent-pending-${Date.now()}`
    const panelThread: EditorChatThread = {
      id: panelThreadId,
      title: request.prompt.slice(0, 18) || '未命名对话',
      artboardIds: [],
      placementMode,
      prompt: '',
      referenceImages: [],
      textReferences: textReferences.map((reference) => ({ ...reference })),
      messages: [
        {
          id: `user-${Date.now()}`,
          role: 'user',
          text: request.prompt,
          referenceImages: requestImages.map((image) => ({ ...image })),
        },
        {
          id: pendingMessageId,
          role: 'agent',
          text: '正在思考...',
          pending: true,
        },
      ],
    }

    setThreads((current) => [nextThread, ...current].slice(0, 5))
    setActiveThreadId(nextThread.id)
    addChatThread(panelThread)
    const placement = resolvePlacementIntent(request.prompt, placementMode)
    const target = ensureChatThreadArtboard(panelThreadId, placement.mode)
    const requestDocument = useEditorStore.getState().document
    const targetArtboard = requestDocument?.artboards.find(
      (artboard) => artboard.id === target?.artboardId,
    )
    onOpenChatPanel?.()
    setPrompt('')
    setTextReferences([])
    setActiveImageIds([])
    setExpanded(false)
    setThreadMenuOpen(false)
    setLoading(true)
    try {
      if (!requestDocument || !target || !targetArtboard) {
        throw new Error('无法创建或选择目标画板')
      }
      let streamedText = ''
      let pendingStreamText = ''
      let streamTimer: number | undefined
      const renderStreamText = (nextText: string) => {
        updateChatThread(panelThreadId, (thread) => ({
          ...thread,
          messages: thread.messages.map((message) =>
            message.id === pendingMessageId
              ? {
                  ...message,
                  text: nextText,
                }
              : message,
          ),
        }))
      }
      const scheduleStreamFlush = () => {
        if (streamTimer) return
        streamTimer = window.setInterval(() => {
          if (!pendingStreamText) {
            window.clearInterval(streamTimer)
            streamTimer = undefined
            return
          }
          const nextChunk = pendingStreamText.slice(0, 4)
          pendingStreamText = pendingStreamText.slice(nextChunk.length)
          streamedText += nextChunk
          renderStreamText(streamedText)
        }, 16)
      }
      const drainStreamText = () =>
        new Promise<void>((resolve) => {
          if (!pendingStreamText && !streamTimer) {
            resolve()
            return
          }
          const checkTimer = window.setInterval(() => {
            if (pendingStreamText || streamTimer) return
            window.clearInterval(checkTimer)
            resolve()
          }, 16)
        })
      const result = await applyChatEdit({
        sessionId: panelThreadId,
        provider: runtimeModel.provider,
        model: runtimeModel.model,
        imageProvider: imageModel.provider,
        imageModel: imageModel.model,
        prompt: request.prompt,
        document: requestDocument,
        referenceImages: request.referenceImages,
        referenceImageNames: request.referenceImageNames,
        textReferences,
        selectedElementIds,
        editScope: createComponentEditScope(requestDocument, selectedElementIds),
        canvasTarget: {
          artboardId: target.artboardId,
          createdForThread: target.created,
          width: targetArtboard.width,
          height: targetArtboard.height,
          autoHeight: targetArtboard.autoHeight,
          placementMode: target.mode,
          placementSource: placement.source,
        },
      }, {
        onToken: (token) => {
          pendingStreamText += token
          scheduleStreamFlush()
        },
        onAgentEvent: (event) => {
          const status = getAgentEventStatus(event)
          if (!status) return
          streamedText = status
          pendingStreamText = ''
          renderStreamText(status)
        },
        onDeliverable: (deliverable) => {
          const observation = applyIncrementalCanvasDeliverable(target, deliverable)
          streamedText = observation.summary
          pendingStreamText = ''
          renderStreamText(observation.summary)
          return observation
        },
      })
      await drainStreamText()
      if (result.kind === 'page' && result.pageDesign && result.pageComponents && result.pageShell) {
        const rootIds = applyPageDesign(
          target,
          result.pageDesign,
          result.pageComponents.map((component) => ({
            index: component.index,
            pageSectionId: component.pageSectionId,
            componentDesign: component.componentDesign,
            assets: component.images,
            visualShell: component.visualShell,
          })),
          result.pageShell,
        )
        const appliedDocument = useEditorStore.getState().document
        const hasPageShell = appliedDocument?.elements.some((element) => (
          element.artboardId === target.artboardId && element.designRole === 'page-shell'
        ))
        if (rootIds.length !== result.pageComponents.length || !hasPageShell) {
          throw new Error('页面生成结果未完整写入目标画板。')
        }
      } else if (result.kind === 'component-slot' && result.editScope && result.image) {
        applyComponentSlotImage(result.editScope.elementId, result.image)
      } else if (result.kind === 'component' && result.componentDesign) {
        const rootId = applyComponentDesign(
          target,
          result.componentDesign,
          result.images ?? [],
          result.visualShell,
          result.editScope?.type === 'component-instance' ? result.editScope.instanceId : undefined,
        )
        const appliedRoot = useEditorStore.getState().document?.elements.find((element) => (
          element.id === rootId && element.artboardId === target.artboardId
        ))
        if (!rootId || !appliedRoot) throw new Error('组件生成结果未写入目标画板。')
      } else if (result.kind === 'image') {
        for (const image of result.images ?? (result.image ? [result.image] : [])) {
          applyGeneratedImage(target, image)
        }
      }
      const agentText = result.message || streamedText
      updateChatThread(panelThreadId, (thread) => ({
        ...thread,
        messages: thread.messages.map((message) =>
          message.id === pendingMessageId
            ? {
                id: `agent-${Date.now()}`,
                role: 'agent',
                text: agentText,
                confirmation: result.confirmation,
              }
            : message,
        ),
      }))
    } catch (error) {
      const errorText = error instanceof Error ? error.message : '聊天接口调用失败'
      updateChatThread(panelThreadId, (thread) => ({
        ...thread,
        messages: thread.messages.map((message) =>
          message.id === pendingMessageId
            ? {
                id: `agent-${Date.now()}`,
                role: 'agent',
                text: errorText,
              }
            : message,
        ),
      }))
    } finally {
      setActiveRunSessionId(undefined)
      setLoading(false)
    }
  }

  function syncComposerImages(nextSources: string[], nextNames: string[] = []) {
    const currentBySrc = new Map(uploadedImages.map((image) => [image.src, image]))
    const newImages = nextSources
      .filter((src) => !currentBySrc.has(src))
      .map((src, index) => ({
        id: `upload-${Date.now()}-${index}`,
        name: nextNames[nextSources.indexOf(src)] || `参考图 ${uploadedImages.length + index + 1}`,
        src,
        elementId: undefined,
      }))
    const newBySrc = new Map(newImages.map((image) => [image.src, image]))
    const nextImages = nextSources
      .map((src) => currentBySrc.get(src) ?? newBySrc.get(src))
      .filter((image): image is ChatImage => Boolean(image))
    setUploadedImages((current) => {
      const nextBySrc = new Map(current.map((image) => [image.src, image]))
      nextImages.forEach((image, index) => {
        nextBySrc.set(image.src, {
          ...image,
          name: nextNames[index] || image.name || nextBySrc.get(image.src)?.name || `参考图 ${index + 1}`,
        })
      })
      return Array.from(nextBySrc.values())
    })
    setActiveImageIds(nextImages.map((image) => image.id))
    setExpanded(true)
  }

  function onPromptChange(value: string) {
    setPrompt(value)
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

  function selectThread(thread: ChatThread) {
    setActiveThreadId(thread.id)
    setPrompt(thread.prompt)
    setActiveImageIds(thread.imageIds)
    setThreadMenuOpen(false)
    setExpanded(true)
  }

  const activeThreadImage = activeThread
    ? uploadedImages.find((image) => activeThread.imageIds.includes(image.id))
    : null

  return (
    <div
      className={expanded ? 'ai-chat-card expanded' : 'ai-chat-card compact'}
      onPointerDown={stopCanvasPointer}
      onFocus={() => setExpanded(true)}
    >
      {threads.length > 1 && activeThread ? (
        <div className="chat-thread-switcher">
          <button
            className="active-thread-pill"
            type="button"
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
            <div className="chat-thread-list">
              {threads.map((thread) => {
                const threadImage = uploadedImages.find((image) => thread.imageIds.includes(image.id))
                return (
                  <button
                    key={thread.id}
                    type="button"
                    className={thread.id === activeThreadId ? 'active' : undefined}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                    }}
                    onClick={() => selectThread(thread)}
                  >
                    {threadImage ? <img src={threadImage.src} alt="" /> : <span />}
                    <strong>{thread.title}</strong>
                    <small>{thread.id === activeThreadId ? '当前' : '打开对话'}</small>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="ai-chat-form-wrap">
        {expanded ? (
          <PlacementModeControl value={placementMode} onChange={setPlacementMode} compact />
        ) : null}
        <PromptComposer
          compact={!expanded}
          iconOnlyActions
          className="ai-chat-composer"
          ariaLabel="AI 对话"
          value={prompt}
          images={activeImages.map((image) => image.src)}
          imageNames={activeImages.map((image) => image.name)}
          mentionOptions={activeImages.map((image) => ({
            id: image.id,
            name: image.name,
            image: image.src,
          }))}
          textReferences={textReferences}
          loading={loading}
          placeholder="结合参考、输入文字或 @ 主体，说说今天想做什么。"
          showActions={expanded}
          actionSlot={
            expanded ? (
              <>
                <RuntimeModelSelect value={runtimeModel} onChange={setRuntimeModel} compact purpose="chat" />
                <RuntimeModelSelect value={imageModel} onChange={setImageModel} compact purpose="image" />
                {loading ? (
                  <button
                    className="mode-button"
                    type="button"
                    title="取消当前任务"
                    onClick={() => activeRunSessionId && window.aiCampaignRuntime?.cancelAgent(activeRunSessionId)}
                  >
                    <Square size={14} />
                    <span>停止</span>
                  </button>
                ) : null}
              </>
            ) : null
          }
          onFocus={() => setExpanded(true)}
          onBlur={onComposerBlur}
          onChange={onPromptChange}
          onImagesChange={syncComposerImages}
          onImageClick={activateImageReference}
          onTextReferenceClick={activateTextReference}
          onTextReferenceRemove={(id) =>
            setTextReferences((current) => current.filter((reference) => reference.id !== id))
          }
          onCursorChange={setComposerCursorOffset}
          onSubmit={submitPrompt}
        />
      </div>
    </div>
  )
}
