import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Maximize2,
  Pencil,
  Plus,
  Square,
  Trash2,
  WandSparkles,
} from 'lucide-react'
import { applyChatEdit } from '../../ai/api'
import { getAgentEventStatus } from '../../ai/agent-events'
import { useEditorStore } from '../store/editor-store'
import type { EditorChatImage, EditorChatThread } from '../store/editor-store'
import { PromptComposer, type PromptTextReference } from '../../../components/ui/PromptComposer'
import { getImageMentionIndex, getImageMentionLabels, getPromptReferenceImages } from '../utils/chat-references'
import { RuntimeModelSelect, type RuntimeModelSelection } from './RuntimeModelSelect'
import { PlacementModeControl } from './PlacementModeControl'
import { resolvePlacementIntent, type PlacementMode } from '../utils/placement-intent'
import { createComponentEditScope } from '../utils/component-edit-scope'
import { applyIncrementalCanvasDeliverable } from '../utils/incremental-delivery'

interface ChatPanelProps {
  onClose: () => void
}

export function ChatPanel({ onClose }: ChatPanelProps) {
  const document = useEditorStore((state) => state.document)
  const ensureChatThreadArtboard = useEditorStore((state) => state.ensureChatThreadArtboard)
  const applyGeneratedImage = useEditorStore((state) => state.applyGeneratedImage)
  const applyComponentDesign = useEditorStore((state) => state.applyComponentDesign)
  const applyPageDesign = useEditorStore((state) => state.applyPageDesign)
  const applyComponentSlotImage = useEditorStore((state) => state.applyComponentSlotImage)
  const applyPageShellImage = useEditorStore((state) => state.applyPageShellImage)
  const selectElement = useEditorStore((state) => state.selectElement)
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const threads = useEditorStore((state) => state.chatThreads)
  const activeThreadId = useEditorStore((state) => state.activeChatThreadId)
  const setActiveThreadId = useEditorStore((state) => state.setActiveChatThread)
  const addChatThread = useEditorStore((state) => state.addChatThread)
  const updateChatThread = useEditorStore((state) => state.updateChatThread)
  const deleteChatThread = useEditorStore((state) => state.deleteChatThread)
  const queuedReferenceImages = useEditorStore((state) => state.queuedReferenceImages)
  const consumeQueuedReferenceImages = useEditorStore(
    (state) => state.consumeQueuedReferenceImages,
  )
  const queuedChatTexts = useEditorStore((state) => state.queuedChatTexts)
  const consumeQueuedChatTexts = useEditorStore((state) => state.consumeQueuedChatTexts)
  const [loading, setLoading] = useState(false)
  const [activeRunSessionId, setActiveRunSessionId] = useState<string>()
  const [threadMenuOpen, setThreadMenuOpen] = useState(false)
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [composerCursorByThread, setComposerCursorByThread] = useState<Record<string, number>>({})
  const [runtimeModel, setRuntimeModel] = useState<RuntimeModelSelection>({
    provider: 'codex',
    model: 'gpt-5.5',
  })
  const [imageModel, setImageModel] = useState<RuntimeModelSelection>({
    provider: 'biliImage',
    model: 'gpt-image-2',
  })
  const bodyRef = useRef<HTMLDivElement>(null)

  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? threads[0]
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
        const nextReferences = [...thread.textReferences]
        const insertOffset = Math.min(
          composerCursorByThread[thread.id] ?? thread.prompt.length,
          thread.prompt.length,
        )
        texts.forEach((item) => {
          const text = item.text.trim()
          if (!text) return
          if (nextReferences.some((reference) => reference.elementId === item.elementId)) return
          nextReferences.push({ id: item.id, text, elementId: item.elementId, insertOffset })
        })
        return {
          ...thread,
          textReferences: nextReferences,
        }
      })
  }, [activeThreadId, composerCursorByThread, consumeQueuedChatTexts, queuedChatTexts, updateChatThread])

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

  function setPlacementMode(placementMode: PlacementMode) {
    updateActiveThread((thread) => ({ ...thread, placementMode }))
  }

  function setReferenceImages(referenceImages: string[], referenceImageNames: string[] = []) {
    updateActiveThread((thread) => {
      const currentBySrc = new Map(collectThreadMentionImages(thread).map((image) => [image.src, image]))
      return {
        ...thread,
        referenceImages: referenceImages.map((src, index) => (
          currentBySrc.has(src)
            ? {
                ...currentBySrc.get(src)!,
                name: referenceImageNames[index] || currentBySrc.get(src)!.name,
              }
            : {
            id: `panel-upload-${Date.now()}-${index}`,
            name: referenceImageNames[index] || `参考图 ${index + 1}`,
            src,
          }
        )),
      }
    })
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

  function updateConfirmationBlueprint(
    messageId: string,
    update: (sections: import('../types').PageCompositionBlueprint['sections']) => import('../types').PageCompositionBlueprint['sections'],
  ) {
    updateActiveThread((thread) => ({
      ...thread,
      messages: thread.messages.map((message) => {
        if (message.id !== messageId || !message.confirmation) return message
        const current = message.confirmation.blueprint
        const gap = current.constraints.find((constraint) => constraint.type === 'vertical-gap')?.value ?? 24
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
              constraints: sections.flatMap((section, index) => index ? [{
                type: 'vertical-gap',
                from: sections[index - 1].id,
                to: section.id,
                value: gap,
              }] : []),
            },
          },
        }
      }),
    }))
  }

  async function onSubmit(
    overrideText?: string,
    blueprintOverride?: import('../types').PageCompositionBlueprint,
  ) {
    if (loading || activeThreadPending || !activeThread) return

    const referencedText = overrideText
      ? ''
      : activeThread.textReferences.map((reference) => reference.text).join(' ')
    const text =
      [referencedText, overrideText ?? activeThread.prompt.trim()].filter(Boolean).join(' ') ||
      '结合当前画布继续创作'
    const requestImages = overrideText
      ? []
      : getPromptReferenceImages(activeThread.prompt, activeThread.referenceImages)
    const placement = resolvePlacementIntent(text, activeThread.placementMode ?? 'auto')
    const target = ensureChatThreadArtboard(activeThread.id, placement.mode)
    const requestDocument = useEditorStore.getState().document
    const targetArtboard = requestDocument?.artboards.find(
      (artboard) => artboard.id === target?.artboardId,
    )
    if (!requestDocument || !target || !targetArtboard) return

    const threadTitle =
      activeThread.messages.length === 0
        ? text.slice(0, 18) || '未命名对话'
        : activeThread.title
    const threadId = activeThread.id
    setActiveRunSessionId(threadId)
    const pendingMessageId = `agent-pending-${Date.now()}`
    updateActiveThread((thread) => ({
      ...thread,
      title: threadTitle,
      prompt: '',
      referenceImages: [],
      textReferences: [],
      messages: [
        ...thread.messages.map((message) => overrideText === '确认执行'
          ? { ...message, confirmation: undefined }
          : message),
        {
          id: `user-${Date.now()}`,
          role: 'user',
          text,
          referenceImages: requestImages.map((image) => ({ ...image })),
        },
        {
          id: pendingMessageId,
          role: 'agent',
          text: '正在思考...',
          pending: true,
        },
      ],
    }))
    setLoading(true)
    try {
      let streamedText = ''
      let pendingStreamText = ''
      let streamTimer: number | undefined
      const renderStreamText = (nextText: string) => {
        updateChatThread(threadId, (thread) => ({
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
        sessionId: threadId,
        provider: runtimeModel.provider,
        model: runtimeModel.model,
        imageProvider: imageModel.provider,
        imageModel: imageModel.model,
        prompt: text,
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
          })),
        referenceImages: requestImages.map((image) => image.src),
        referenceImageNames: requestImages.map((image) => image.name),
        textReferences: activeThread.textReferences,
        selectedElementIds,
        editScope: createComponentEditScope(requestDocument, selectedElementIds),
        blueprintOverride,
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
      } else if (result.kind === 'page-shell' && result.editScope?.type === 'page-shell' && result.image) {
        applyPageShellImage(result.editScope.elementId, result.image)
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
      updateChatThread(threadId, (thread) => ({
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
      updateChatThread(threadId, (thread) => ({
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

  return (
    <aside className="chat-panel">
      <header className="chat-panel-header">
        <div className="chat-thread-menu-wrap">
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
                  className={thread.id === activeThreadId ? 'chat-thread-row active' : 'chat-thread-row'}
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
                        {thread.messages.length
                          ? `${thread.messages.length} 条消息`
                          : '空对话'}
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
                    <button
                      type="button"
                      title="删除对话"
                      onClick={() => removeThread(thread.id)}
                    >
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
              <div
                key={message.id}
                className={`chat-message-group ${message.role}`}
              >
                {message.referenceImages?.length ? (
                  <div className="chat-message-images">
                    {message.referenceImages.map((image) => (
                      <button
                        key={`${message.id}-${image.id}`}
                        type="button"
                        title={image.name}
                        onClick={() => activateMessageImage(image.elementId)}
                      >
                        <img src={image.src} alt={image.name} />
                      </button>
                    ))}
                  </div>
                ) : null}
                {message.text ? (
                  <div className={`chat-message ${message.role}${message.pending ? ' typing' : ''}`}>
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
                  <div className="blueprint-confirmation-card">
                    <div className="blueprint-confirmation-header">
                      <strong>页面结构</strong>
                      <span>
                        {message.confirmation.blueprint.width} × {message.confirmation.blueprint.estimatedHeight}
                      </span>
                    </div>
                    <div className="blueprint-confirmation-sections">
                      {message.confirmation.blueprint.sections.map((section, index) => (
                        <div key={section.id}>
                          <span>{index + 1}</span>
                          <div className="blueprint-section-copy">
                            <strong>{section.role}</strong>
                            <small>{section.component?.componentName ?? section.kind}</small>
                          </div>
                          <input
                            type="number"
                            min={120}
                            step={20}
                            title="模块高度"
                            value={Math.round(section.bounds.height)}
                            onChange={(event) => updateConfirmationBlueprint(message.id, (sections) => (
                              sections.map((item) => item.id === section.id
                                ? { ...item, bounds: { ...item.bounds, height: Math.max(120, Number(event.target.value) || 120) } }
                                : item)
                            ))}
                          />
                          <button
                            type="button"
                            title="上移模块"
                            disabled={index === 0}
                            onClick={() => updateConfirmationBlueprint(message.id, (sections) => {
                              const next = [...sections]
                              ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                              return next
                            })}
                          ><ChevronUp size={14} /></button>
                          <button
                            type="button"
                            title="下移模块"
                            disabled={index === message.confirmation!.blueprint.sections.length - 1}
                            onClick={() => updateConfirmationBlueprint(message.id, (sections) => {
                              const next = [...sections]
                              ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
                              return next
                            })}
                          ><ChevronDown size={14} /></button>
                          <button
                            type="button"
                            title="删除模块"
                            disabled={message.confirmation!.blueprint.sections.length <= 1}
                            onClick={() => updateConfirmationBlueprint(message.id, (sections) => (
                              sections.filter((item) => item.id !== section.id)
                            ))}
                          ><Trash2 size={14} /></button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={loading || activeThreadPending}
                      onClick={() => void onSubmit('确认执行', message.confirmation?.blueprint)}
                    >
                      <Check size={14} />
                      确认并生成
                    </button>
                  </div>
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
        <PlacementModeControl
          value={activeThread?.placementMode ?? 'auto'}
          onChange={setPlacementMode}
        />
        <PromptComposer
          className="chat-panel-composer"
          ariaLabel="右侧对话"
          value={activeThread?.prompt ?? ''}
          images={activeThread?.referenceImages.map((image) => image.src) ?? []}
          imageNames={activeThread?.referenceImages.map((image) => image.name) ?? []}
          mentionOptions={(activeThread?.referenceImages ?? []).map((image) => ({
            id: image.id,
            name: image.name,
            image: image.src,
          }))}
          textReferences={activeThread?.textReferences ?? []}
          loading={loading || activeThreadPending}
          placeholder="上传参考、输入文字或 @ 主体，创意无限可能"
          actionSlot={
            <>
              <RuntimeModelSelect value={runtimeModel} onChange={setRuntimeModel} compact purpose="chat" />
              <RuntimeModelSelect value={imageModel} onChange={setImageModel} compact purpose="image" />
              {loading || activeThreadPending ? (
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
          }
          onChange={setPrompt}
          onImagesChange={setReferenceImages}
          onImageClick={activateImageReference}
          onTextReferenceClick={activateTextReference}
          onTextReferenceRemove={removeTextReference}
          onCursorChange={(offset) =>
            activeThread && setComposerCursorByThread((current) => ({
              ...current,
              [activeThread.id]: offset,
            }))
          }
          onSubmit={onSubmit}
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
    .map((image) => {
      const labels = getImageMentionLabels(image.name)
      const label = labels.find((item) => text.includes(`@${item}`))
      const index = getImageMentionIndex(text, image.name)
      return label && index >= 0 ? { image, label: `@${label}`, index } : null
    })
    .filter((item): item is { image: EditorChatImage; label: string; index: number } => Boolean(item))
    .sort((a, b) => a.index - b.index)

  if (!matches.length) {
    return (
      <>
        {images.map((image) => renderMessageImageChip(image, onImageClick))}
        {text}
      </>
    )
  }

  const nodes: ReactNode[] = []
  let cursor = 0
  matches.forEach((match) => {
    const start = text.indexOf(match.label, cursor)
    if (start < 0) return
    if (start > cursor) nodes.push(text.slice(cursor, start))
    nodes.push(renderMessageImageChip(match.image, onImageClick))
    cursor = start + match.label.length
  })
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

function renderMessageImageChip(
  image: EditorChatImage,
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
      <span>{image.name.replace(/\.[a-z0-9]{1,8}$/i, '')}</span>
    </button>
  )
}
