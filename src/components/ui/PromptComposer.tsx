import {
  ChangeEvent,
  DragEvent,
  FocusEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  TextNode,
} from 'lexical'
import type {
  EditorConfig,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedTextNode,
  Spread,
} from 'lexical'
import { ArrowUp, AtSign, Blocks, FileUp, ImagePlus, Layers3, Plus, Square, X } from 'lucide-react'
import type { ComposerMention, ComposerReferenceType } from '../../features/ai/composer-draft'
import type { ReferenceImageRole } from '../../features/ai/types'
import { cn } from '../../lib/cn'

export interface PromptMentionOption {
  id: string
  name: string
  label?: string
  image?: string
  type?: ComposerReferenceType
  resourceId?: string
  packId?: string
  componentName?: string
  group?: 'component' | 'image' | 'canvas'
  description?: string
}

export interface PromptTextReference {
  id: string
  text: string
  elementId?: string
  insertOffset?: number
  kind?: 'text' | 'component-region-regeneration'
}

interface PromptComposerProps {
  value: string
  images: string[]
  imageNames?: string[]
  imageRoles?: ReferenceImageRole[]
  mentions?: ComposerMention[]
  textReferences?: PromptTextReference[]
  loading?: boolean
  placeholder: string
  ariaLabel: string
  className?: string
  compact?: boolean
  showActions?: boolean
  iconOnlyActions?: boolean
  maxImages?: number
  mentionOptions?: PromptMentionOption[]
  contextSlot?: ReactNode
  actionSlot?: ReactNode
  onChange: (value: string) => void
  onMentionsChange?: (mentions: ComposerMention[]) => void
  onEditorStateChange?: (editorState: string) => void
  onImagesChange: (images: string[], imageNames?: string[]) => void
  onImageRoleChange?: (index: number, role: ReferenceImageRole) => void
  onImageClick?: (image: { src: string; name: string; index: number }) => boolean | void
  onTextReferenceClick?: (reference: PromptTextReference) => void
  onTextReferenceRemove?: (id: string) => void
  onCursorChange?: (offset: number) => void
  onSubmit: () => void
  onStop?: () => void
  onMentionSelect?: (option: PromptMentionOption) => void
  onImportComponent?: (file: File) => Promise<PromptMentionOption | void>
  onFocus?: () => void
  onBlur?: (event: FocusEvent<HTMLElement>) => void
}

type SerializedPromptMentionNode = Spread<
  {
    type: 'prompt-mention'
    version: 1
    mention: Omit<ComposerMention, 'start' | 'end'>
  },
  SerializedTextNode
>

class PromptMentionNode extends TextNode {
  __mention: Omit<ComposerMention, 'start' | 'end'>

  static getType() {
    return 'prompt-mention'
  }

  static clone(node: PromptMentionNode) {
    return new PromptMentionNode(node.__mention, node.__key)
  }

  static importJSON(serialized: SerializedPromptMentionNode) {
    return new PromptMentionNode(serialized.mention)
  }

  constructor(mention: Omit<ComposerMention, 'start' | 'end'>, key?: NodeKey) {
    super(`@${mention.label}`, key)
    this.__mention = mention
    this.__mode = 1
  }

  exportJSON(): SerializedPromptMentionNode {
    return {
      ...super.exportJSON(),
      type: 'prompt-mention',
      version: 1,
      mention: this.__mention,
    }
  }

  createDOM(config: EditorConfig) {
    const dom = super.createDOM(config)
    dom.className = 'prompt-inline-reference-mention'
    dom.dataset.referenceId = this.__mention.resourceId
    dom.dataset.referenceType = this.__mention.type
    dom.title = this.__mention.label
    return dom
  }

  updateDOM(previousNode: this, dom: HTMLElement, config: EditorConfig) {
    const updated = super.updateDOM(previousNode, dom, config)
    dom.dataset.referenceId = this.__mention.resourceId
    dom.dataset.referenceType = this.__mention.type
    dom.title = this.__mention.label
    return updated
  }

  getMention() {
    return this.getLatest().__mention
  }

  isTextEntity() {
    return true
  }

  canInsertTextBefore() {
    return false
  }

  canInsertTextAfter() {
    return false
  }
}

function $isPromptMentionNode(node: LexicalNode | null | undefined): node is PromptMentionNode {
  return node instanceof PromptMentionNode
}

function $createPromptMentionNode(option: PromptMentionOption) {
  return new PromptMentionNode({
    id: `mention-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: option.type ?? (option.image ? 'image' : 'canvas-node'),
    resourceId: option.resourceId ?? option.id,
    label: normalizeImageName(option.label || option.name),
    packId: option.packId,
    componentName: option.componentName,
  })
}

export function PromptComposer({
  value,
  images,
  imageNames = [],
  imageRoles = [],
  mentions = [],
  textReferences = [],
  loading,
  placeholder,
  ariaLabel,
  className,
  compact,
  showActions = true,
  iconOnlyActions,
  maxImages = 8,
  mentionOptions = [],
  contextSlot,
  actionSlot,
  onChange,
  onMentionsChange,
  onEditorStateChange,
  onImagesChange,
  onImageRoleChange,
  onImageClick,
  onTextReferenceClick,
  onTextReferenceRemove,
  onCursorChange,
  onSubmit,
  onStop,
  onMentionSelect,
  onImportComponent,
  onFocus,
  onBlur,
}: PromptComposerProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const componentInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<LexicalEditor | null>(null)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [referenceDeckOpen, setReferenceDeckOpen] = useState(false)
  const [draggingImageIndex, setDraggingImageIndex] = useState<number | null>(null)
  const [previewImage, setPreviewImage] = useState<{ src: string; name: string } | null>(null)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    if (!mentionOpen) return
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !formRef.current?.contains(target)) {
        setMentionOpen(false)
      }
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setMentionOpen(false)
    }
    globalThis.document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    globalThis.document.addEventListener('keydown', closeOnEscape)
    return () => {
      globalThis.document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
      globalThis.document.removeEventListener('keydown', closeOnEscape)
    }
  }, [mentionOpen])
  const getImageName = (index: number) =>
    normalizeImageName(imageNames[index] || `参考图 ${index + 1}`)
  const options: PromptMentionOption[] = mentionOptions.length
    ? mentionOptions
    : images.map((image, index) => ({
        id: `image-${index}`,
        resourceId: `image-${index}`,
        type: 'image' as const,
        name: getImageName(index),
        label: `图${index + 1}`,
        image,
      }))
  const filteredOptions = options.filter(
    (option) =>
      !mentionQuery ||
      `${option.name} ${option.label ?? ''} ${option.description ?? ''}`
        .toLowerCase()
        .includes(mentionQuery.toLowerCase()),
  )
  const groupedOptions = groupMentionOptions(filteredOptions.slice(0, 18))
  const initialConfig = useMemo(
    () => ({
      namespace: 'StudioPromptComposer',
      nodes: [PromptMentionNode],
      theme: { paragraph: 'prompt-rich-editor-line' },
      onError(error: Error) {
        console.error('[prompt-composer] lexical error', error)
      },
    }),
    [],
  )

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).slice(
      0,
      Math.max(0, maxImages - images.length),
    )
    const entries = await Promise.all(
      files.map(async (file) => ({
        src: await readFileAsDataUrl(file),
        name: file.name,
      })),
    )
    onImagesChange(
      [...images, ...entries.map((entry) => entry.src)].slice(0, maxImages),
      [...imageNames, ...entries.map((entry) => entry.name)].slice(0, maxImages),
    )
    setSubmitError('')
    event.target.value = ''
  }

  async function onComponentFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !onImportComponent) return
    try {
      const option = await onImportComponent(file)
      setSubmitError('')
      if (option) selectMention(option)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '组件 JSON 导入失败')
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!value.trim() && !images.length && !textReferences.length) {
      setSubmitError('请输入提示词')
      editorRef.current?.focus()
      return
    }
    setSubmitError('')
    onSubmit()
  }

  function selectMention(option: PromptMentionOption) {
    const editor = editorRef.current
    if (!editor) return
    onMentionSelect?.(option)
    editor.update(() => {
      let selection = $getSelection()
      if (!$isRangeSelection(selection)) {
        $getRoot().selectEnd()
        selection = $getSelection()
      }
      if (!$isRangeSelection(selection)) return
      const anchor = selection.anchor
      const node = anchor.getNode()
      if ($isTextNode(node) && !$isPromptMentionNode(node)) {
        const before = node.getTextContent().slice(0, anchor.offset)
        const match = before.match(/(?:^|\s)@([^\s@]*)$/)
        if (match) {
          const start = anchor.offset - match[0].length + (match[0].startsWith(' ') ? 1 : 0)
          selection.setTextNodeRange(node, start, node, anchor.offset)
        }
      }
      selection.insertNodes([$createPromptMentionNode(option), $createTextNode(' ')])
    })
    setMentionOpen(false)
    setMentionQuery('')
    editor.focus()
  }

  function removeImage(index: number) {
    const option = options.find((item) => item.image === images[index])
    if (option) removeMentionsForResource(editorRef.current, option.resourceId ?? option.id)
    onImagesChange(
      images.filter((_, itemIndex) => itemIndex !== index),
      imageNames.filter((_, itemIndex) => itemIndex !== index),
    )
  }

  function reorderImages(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    const nextImages = [...images]
    const nextNames = images.map((_, index) => imageNames[index] || `参考图 ${index + 1}`)
    const [image] = nextImages.splice(fromIndex, 1)
    const [name] = nextNames.splice(fromIndex, 1)
    nextImages.splice(toIndex, 0, image)
    nextNames.splice(toIndex, 0, name)
    onImagesChange(nextImages, nextNames)
  }

  return (
    <form
      ref={formRef}
      className={cn(
        'prompt-composer',
        compact && 'compact',
        iconOnlyActions && 'icon-only-actions',
        className,
      )}
      onSubmit={submit}
    >
      <div className="prompt-composer-main">
        <div className="prompt-reference-stack">
          {images.length ? (
            <div
              className={cn('prompt-reference-deck', referenceDeckOpen && 'expanded')}
              style={{ '--reference-count': images.length + 1 } as CSSProperties}
              onMouseEnter={() => setReferenceDeckOpen(true)}
              onMouseLeave={() => setReferenceDeckOpen(false)}
              onFocus={() => setReferenceDeckOpen(true)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                  setReferenceDeckOpen(false)
              }}
            >
              {images.map((image, index) => (
                <span
                  key={`${image.slice(0, 40)}-${index}`}
                  className={cn(
                    'prompt-reference-item',
                    draggingImageIndex === index && 'dragging',
                  )}
                  data-name={`图${index + 1} · ${getImageName(index)}`}
                  draggable
                  style={{ '--reference-index': index } as CSSProperties}
                  onDragStart={(event: DragEvent<HTMLSpanElement>) => {
                    setDraggingImageIndex(index)
                    event.dataTransfer.setData('text/plain', String(index))
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    reorderImages(Number(event.dataTransfer.getData('text/plain')), index)
                    setDraggingImageIndex(null)
                  }}
                  onDragEnd={() => setDraggingImageIndex(null)}
                  onClick={() =>
                    onImageClick?.({ src: image, name: getImageName(index), index }) ||
                    setPreviewImage({ src: image, name: getImageName(index) })
                  }
                >
                  <img src={image} alt="" draggable={false} />
                  {onImageRoleChange ? (
                    <select
                      className="prompt-reference-role"
                      aria-label={`${getImageName(index)}的职责`}
                      title="设置参考图职责"
                      value={imageRoles[index] ?? 'visual'}
                      data-role={imageRoles[index] ?? 'visual'}
                      draggable={false}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        event.stopPropagation()
                        onImageRoleChange(index, event.target.value as ReferenceImageRole)
                      }}
                    >
                      <option value="kv">KV · 视觉主题</option>
                      <option value="prototype">原型 · 页面结构</option>
                      <option value="visual">Visual · 局部风格</option>
                      <option value="edit-base">Edit Base · 编辑底图</option>
                    </select>
                  ) : null}
                  <button
                    className="prompt-reference-delete"
                    type="button"
                    title={`删除${getImageName(index)}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      removeImage(index)
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              {images.length < maxImages ? (
                <button
                  className="prompt-reference-add-button"
                  type="button"
                  title="继续上传参考图"
                  style={{ '--reference-index': images.length } as CSSProperties}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Plus size={17} />
                </button>
              ) : null}
            </div>
          ) : (
            <button
              className="prompt-reference-upload"
              type="button"
              title="上传参考图"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus size={22} />
              <em>
                <Plus size={13} />
              </em>
            </button>
          )}
        </div>

        <div className="prompt-composer-content">
          {contextSlot}
          {textReferences.length ? (
            <div className="prompt-text-reference-row">
              {textReferences.map((reference) => (
                <span className="prompt-text-reference" key={reference.id}>
                  <button
                    className="prompt-text-reference-main"
                    type="button"
                    onClick={() => onTextReferenceClick?.(reference)}
                  >
                    <span>@</span>
                    <strong>{reference.text}</strong>
                  </button>
                  <button
                    className="prompt-text-reference-delete"
                    type="button"
                    title="移除引用"
                    onClick={() => onTextReferenceRemove?.(reference.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="prompt-input-stack">
            <LexicalComposer initialConfig={initialConfig}>
              <PlainTextPlugin
                contentEditable={
                  <ContentEditable
                    className="prompt-rich-editor"
                    aria-label={ariaLabel}
                    onFocus={onFocus}
                    onBlur={onBlur}
                  />
                }
                placeholder={<div className="prompt-rich-placeholder">{placeholder}</div>}
                ErrorBoundary={LexicalErrorBoundary}
              />
              <HistoryPlugin />
              <ComposerBridge
                value={value}
                mentions={mentions}
                onReady={(editor) => {
                  editorRef.current = editor
                }}
                onChange={onChange}
                onMentionsChange={onMentionsChange}
                onEditorStateChange={onEditorStateChange}
                onCursorChange={onCursorChange}
                onMentionQuery={(query) => {
                  setMentionQuery(query)
                  setMentionOpen(true)
                }}
                onMentionClose={() => setMentionOpen(false)}
                onSubmit={() => submit()}
              />
            </LexicalComposer>
            {submitError ? <div className="prompt-submit-error">{submitError}</div> : null}
          </div>
        </div>

        {showActions ? (
          <div className="prompt-composer-actions">
            <button
              className="prompt-action-button"
              type="button"
              title="引用图片、组件或画布"
              onClick={() => {
                editorRef.current?.focus()
                setMentionQuery('')
                window.requestAnimationFrame(() => setMentionOpen(true))
              }}
            >
              <AtSign size={17} />
            </button>
            {actionSlot ? <div className="prompt-action-slot">{actionSlot}</div> : null}
            <button
              className={cn('prompt-submit-button', loading && 'is-stop')}
              type={loading ? 'button' : 'submit'}
              title={loading ? '停止当前任务' : '发送'}
              disabled={!loading && !value.trim() && !images.length && !textReferences.length}
              onClick={loading ? onStop : undefined}
            >
              {loading ? (
                <Square size={16} fill="currentColor" />
              ) : (
                <ArrowUp size={25} strokeWidth={2.5} />
              )}
            </button>
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={onFileChange}
        />
        <input
          ref={componentInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={onComponentFileChange}
        />
        {mentionOpen ? (
          <div
            className="prompt-mention-menu below"
            onMouseDown={(event) => event.preventDefault()}
          >
            {groupedOptions.length ? (
              groupedOptions.map((group) => (
                <section className="prompt-mention-group" key={group.id}>
                  <header>{group.label}</header>
                  {group.options.map((option) => (
                    <button
                      key={`${option.type ?? 'reference'}-${option.id}`}
                      type="button"
                      title={option.name}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        selectMention(option)
                      }}
                    >
                      {option.image ? (
                        <img src={option.image} alt="" />
                      ) : (
                        <span
                          className={cn(
                            'mention-fallback',
                            `is-${option.group ?? mentionGroup(option)}`,
                          )}
                        >
                          {option.type === 'component' ? (
                            <Blocks size={16} />
                          ) : option.group === 'canvas' ? (
                            <Layers3 size={16} />
                          ) : (
                            '@'
                          )}
                        </span>
                      )}
                      <span className="mention-option-copy">
                        <strong>{normalizeImageName(option.name)}</strong>
                        {option.description ? <small>{option.description}</small> : null}
                      </span>
                    </button>
                  ))}
                </section>
              ))
            ) : (
              <div className="mention-empty-state">
                <strong>暂无可引用内容</strong>
                <small>上传图片、导入组件或从画布添加引用</small>
              </div>
            )}
            {onImportComponent ? (
              <button
                className="mention-import-component"
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault()
                  componentInputRef.current?.click()
                }}
              >
                <span className="mention-fallback is-component">
                  <FileUp size={16} />
                </span>
                <span className="mention-option-copy">
                  <strong>导入组件 JSON</strong>
                  <small>注册到当前项目</small>
                </span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {previewImage
        ? createPortal(
            <div
              className="prompt-image-preview-backdrop"
              role="dialog"
              aria-modal="true"
              aria-label={previewImage.name}
              onClick={() => setPreviewImage(null)}
            >
              <div className="prompt-image-preview" onClick={(event) => event.stopPropagation()}>
                <button type="button" title="关闭预览" onClick={() => setPreviewImage(null)}>
                  <X size={18} />
                </button>
                <img src={previewImage.src} alt={previewImage.name} />
                <span>{previewImage.name}</span>
              </div>
            </div>,
            window.document.body,
          )
        : null}
    </form>
  )
}

function ComposerBridge({
  value,
  mentions,
  onReady,
  onChange,
  onMentionsChange,
  onEditorStateChange,
  onCursorChange,
  onMentionQuery,
  onMentionClose,
  onSubmit,
}: {
  value: string
  mentions: ComposerMention[]
  onReady: (editor: LexicalEditor) => void
  onChange: (value: string) => void
  onMentionsChange?: (mentions: ComposerMention[]) => void
  onEditorStateChange?: (editorState: string) => void
  onCursorChange?: (offset: number) => void
  onMentionQuery: (query: string) => void
  onMentionClose: () => void
  onSubmit: () => void
}) {
  const [editor] = useLexicalComposerContext()
  const syncingRef = useRef(false)
  const mentionsKey = JSON.stringify(
    mentions.map(({ id, type, resourceId, label, packId, componentName, start, end }) => ({
      id,
      type,
      resourceId,
      label,
      packId,
      componentName,
      start,
      end,
    })),
  )

  useEffect(() => onReady(editor), [editor, onReady])

  useEffect(() => {
    editor.getEditorState().read(() => {
      const current = $getRoot().getTextContent()
      // The text and mention metadata are controlled by separate callbacks. During
      // that hand-off the metadata can briefly lag behind the Lexical document;
      // rebuilding here would downgrade a newly inserted mention to plain text.
      if (current === value) return
      syncingRef.current = true
      editor.update(() => restoreEditor(value, mentions), { discrete: true })
      syncingRef.current = false
    })
  }, [editor, mentions, mentionsKey, value])

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const root = $getRoot()
          const text = root.getTextContent()
          const nextMentions = collectMentions(text)
          const selection = $getSelection()
          if ($isRangeSelection(selection)) {
            onCursorChange?.(selection.anchor.offset)
            const node = selection.anchor.getNode()
            if ($isTextNode(node) && !$isPromptMentionNode(node)) {
              const before = node.getTextContent().slice(0, selection.anchor.offset)
              const match = before.match(/(?:^|\s)@([^\s@]*)$/)
              if (match) onMentionQuery(match[1])
              else onMentionClose()
            } else {
              onMentionClose()
            }
          }
          if (syncingRef.current) return
          onMentionsChange?.(nextMentions)
          onChange(text)
          onEditorStateChange?.(JSON.stringify(editorState.toJSON()))
        })
      }),
    [
      editor,
      onChange,
      onEditorStateChange,
      onMentionClose,
      onMentionQuery,
      onMentionsChange,
      onCursorChange,
    ],
  )

  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (event?.shiftKey || editor.isComposing()) return false
          event?.preventDefault()
          onSubmit()
          return true
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor, onSubmit],
  )

  return null
}

function restoreEditor(value: string, mentions: ComposerMention[]) {
  const root = $getRoot()
  root.clear()
  const paragraph = $createParagraphNode()
  let cursor = 0
  mentions
    .filter((mention) => mention.start >= cursor && mention.end <= value.length)
    .sort((a, b) => a.start - b.start)
    .forEach((mention) => {
      if (mention.start > cursor)
        paragraph.append($createTextNode(value.slice(cursor, mention.start)))
      paragraph.append(
        new PromptMentionNode({
          id: mention.id,
          type: mention.type,
          resourceId: mention.resourceId,
          label: mention.label,
          packId: mention.packId,
          componentName: mention.componentName,
        }),
      )
      cursor = mention.end
    })
  if (cursor < value.length) paragraph.append($createTextNode(value.slice(cursor)))
  root.append(paragraph)
  paragraph.selectEnd()
}

function collectMentions(text: string) {
  let cursor = 0
  const result: ComposerMention[] = []
  $getRoot()
    .getAllTextNodes()
    .forEach((node) => {
      if (!$isPromptMentionNode(node)) return
      const token = node.getTextContent()
      const start = text.indexOf(token, cursor)
      if (start < 0) return
      const mention = node.getMention()
      result.push({ ...mention, start, end: start + token.length })
      cursor = start + token.length
    })
  return result
}

function removeMentionsForResource(editor: LexicalEditor | null | undefined, resourceId: string) {
  editor?.update(() => {
    $getRoot()
      .getAllTextNodes()
      .forEach((node) => {
        if ($isPromptMentionNode(node) && node.getMention().resourceId === resourceId) node.remove()
      })
  })
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function normalizeImageName(value: string) {
  return value.replace(/^@/, '').trim() || '未命名引用'
}

function mentionGroup(option: PromptMentionOption): 'component' | 'image' | 'canvas' {
  if (option.group) return option.group
  if (option.type === 'component') return 'component'
  if (option.type === 'image') return 'image'
  return 'canvas'
}

function groupMentionOptions(options: PromptMentionOption[]) {
  const labels = { component: '组件', image: '图片', canvas: '画布' }
  return (['component', 'image', 'canvas'] as const)
    .map((id) => ({
      id,
      label: labels[id],
      options: options.filter((option) => mentionGroup(option) === id),
    }))
    .filter((group) => group.options.length)
}
