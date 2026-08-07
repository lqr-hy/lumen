import { ChangeEvent, CompositionEvent, DragEvent, FormEvent, FocusEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowUp,
  AtSign,
  FolderOpen,
  ImagePlus,
  Loader2,
  Plus,
  UploadCloud,
  WandSparkles,
  X,
} from 'lucide-react'
import { cn } from '../../lib/cn'

export interface PromptMentionOption {
  id: string
  name: string
  image?: string
}

export interface PromptTextReference {
  id: string
  text: string
  elementId?: string
  insertOffset?: number
}

interface PromptComposerProps {
  value: string
  images: string[]
  imageNames?: string[]
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
  actionSlot?: ReactNode
  onChange: (value: string) => void
  onImagesChange: (images: string[], imageNames?: string[]) => void
  onImageClick?: (image: { src: string; name: string; index: number }) => boolean | void
  onTextReferenceClick?: (reference: PromptTextReference) => void
  onTextReferenceRemove?: (id: string) => void
  onCursorChange?: (offset: number) => void
  onSubmit: () => void
  onMentionSelect?: (option: PromptMentionOption) => void
  onFocus?: () => void
  onBlur?: (event: FocusEvent<HTMLElement>) => void
}

export function PromptComposer({
  value,
  images,
  imageNames = [],
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
  actionSlot,
  onChange,
  onImagesChange,
  onImageClick,
  onTextReferenceClick,
  onTextReferenceRemove,
  onCursorChange,
  onSubmit,
  onMentionSelect,
  onFocus,
  onBlur,
}: PromptComposerProps) {
  const mainRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const atButtonRef = useRef<HTMLButtonElement>(null)
  const selectionOffsetRef = useRef<number | null>(null)
  const composingRef = useRef(false)
  const editorStructureKeyRef = useRef('')
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionAnchor, setMentionAnchor] = useState({ left: 86, top: 58, placement: 'below' })
  const [subjectCreateOpen, setSubjectCreateOpen] = useState(false)
  const [draggingImageIndex, setDraggingImageIndex] = useState<number | null>(null)
  const [referenceDeckOpen, setReferenceDeckOpen] = useState(false)
  const [previewImage, setPreviewImage] = useState<{ src: string; name: string } | null>(null)
  const [submitError, setSubmitError] = useState('')
  const [uploadedImageNames, setUploadedImageNames] = useState<Record<string, string>>({})
  const getImageName = (image: string, index: number) =>
    normalizeImageName(uploadedImageNames[image] || imageNames[index] || `参考图 ${index + 1}`)
  const availableMentionOptions =
    mentionOptions.length > 0
      ? mentionOptions
      : images.map((image, index) => ({
          id: `image-${index}`,
          name: getImageName(image, index),
          image,
        }))
  const mentionSize = {
    width: 260,
    height: availableMentionOptions.length ? Math.min(250, availableMentionOptions.slice(0, 8).length * 40 + 16) : 246,
  }
  const imageMentionTags = images.map((image, index) => ({
    src: image,
    name: getImageName(image, index),
    label: `@${truncateMiddle(getImageName(image, index), 18)}`,
  }))
  const textMentionTags = textReferences.map((reference) => ({
    id: reference.id,
    text: reference.text,
    label: truncateMiddle(reference.text, 22),
    insertOffset: reference.insertOffset,
  }))
  const editorEmpty = !value.trim() && !textReferences.length
  const editorStructureKey = [
    imageMentionTags.map((tag) => `${tag.label}:${tag.src}`).join('|'),
    textMentionTags.map((tag) => `${tag.id}:${tag.insertOffset ?? 0}:${tag.text}`).join('|'),
  ].join('::')
  const editorHtml = renderEditorContent(value, imageMentionTags, textMentionTags)

  useEffect(() => {
    if (!compact && showActions) return
    setMentionOpen(false)
    setSubjectCreateOpen(false)
  }, [compact, showActions])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || composingRef.current) return

    const focused = window.document.activeElement === editor
    const currentValue = getEditablePlainText(editor)
    const structureChanged = editorStructureKeyRef.current !== editorStructureKey
    const shouldSync =
      editor.innerHTML !== editorHtml &&
      (!focused || structureChanged || currentValue !== value)

    editorStructureKeyRef.current = editorStructureKey
    if (!shouldSync) return

    const cursor = focused
      ? selectionOffsetRef.current ?? getEditableSelectionOffset(editor)
      : null
    editor.innerHTML = editorHtml
    if (focused && cursor !== null) {
      setEditableSelectionOffset(editor, Math.min(cursor, getEditableLength(editor)))
    }
  }, [editorHtml, editorStructureKey, value])

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    const nextEntries = await Promise.all(
      files.slice(0, maxImages).map(async (file) => ({
        src: await readFileAsDataUrl(file),
        name: file.name,
      })),
    )
    setUploadedImageNames((current) => ({
      ...current,
      ...Object.fromEntries(nextEntries.map((entry) => [entry.src, entry.name])),
    }))
    const nextImages = [...images, ...nextEntries.map((entry) => entry.src)].slice(0, maxImages)
    const nextNames = [
      ...images.map((image, index) => uploadedImageNames[image] || imageNames[index] || `参考图 ${index + 1}`),
      ...nextEntries.map((entry) => entry.name),
    ].slice(0, maxImages)
    onImagesChange(nextImages, nextNames)
    setSubmitError('')
    setSubjectCreateOpen(false)
    setMentionOpen(false)
    event.target.value = ''
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmitPrompt()) {
      showSubmitError()
      return
    }
    setSubmitError('')
    onSubmit()
  }

  function canSubmitPrompt() {
    return Boolean(value.trim() || images.length || textReferences.length)
  }

  function showSubmitError() {
    setSubmitError('请输入提示词')
    window.requestAnimationFrame(() => editorRef.current?.focus())
  }

  function handleAtClick() {
    const editor = editorRef.current
    const cursor = editor ? getEditableSelectionOffset(editor) : value.length
    const beforeCursor = value.slice(0, cursor)
    const afterCursor = value.slice(cursor)
    const shouldInsertAt = !beforeCursor.endsWith('@')
    const prefix = shouldInsertAt
      ? `${beforeCursor}${beforeCursor.endsWith(' ') || !beforeCursor ? '' : ' '}@`
      : beforeCursor
    const nextValue = `${prefix}${afterCursor}`
    onChange(nextValue)
    setMentionAnchor(getButtonAnchor())
    setMentionOpen(true)
    setSubjectCreateOpen(false)
    window.requestAnimationFrame(() => {
      const nextEditor = editorRef.current
      if (!nextEditor) return
      nextEditor.focus()
      setEditableSelectionOffset(nextEditor, prefix.length)
    })
  }

  function handleEditorInput(event: FormEvent<HTMLDivElement>) {
    const editor = event.currentTarget
    removeOrphanCaretText(editor)
    const nextValue = textReferences.length
      ? getEditablePlainText(editor).replace(/^\s+/, '')
      : getEditablePlainText(editor)
    const cursor = getEditableSelectionOffset(editor)
    selectionOffsetRef.current = cursor
    onCursorChange?.(cursor)
    if (composingRef.current) return
    onChange(nextValue)
    if (submitError && nextValue.trim()) setSubmitError('')
    if (getActiveMentionQueryFromSelection(editor)) {
      setMentionAnchor(getCaretAnchor(editor))
      setMentionOpen(true)
      setSubjectCreateOpen(false)
      return
    }
    setMentionOpen(false)
  }

  function handleTextKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (composingRef.current || event.nativeEvent.isComposing) return
    if (event.key === 'Backspace' || event.key === 'Delete') {
      if (removeSelectedReferenceChips(event.currentTarget)) {
        event.preventDefault()
        return
      }
      if (removeAdjacentReferenceChip(event.key)) {
        event.preventDefault()
        return
      }
    }
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (mentionOpen) {
      if (availableMentionOptions.length) {
        selectMention(availableMentionOptions[0])
      }
      return
    }
    if (!canSubmitPrompt()) {
      showSubmitError()
      return
    }
    setSubmitError('')
    onSubmit()
  }

  function handleCursorChange() {
    const editor = editorRef.current
    if (!editor) return
    const cursor = getEditableSelectionOffset(editor)
    selectionOffsetRef.current = cursor
    onCursorChange?.(cursor)
  }

  function handleCompositionStart() {
    composingRef.current = true
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLDivElement>) {
    composingRef.current = false
    handleEditorInput(event)
  }

  function handleEditorClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null
    const textChip = target?.closest<HTMLElement>('[data-reference-chip="text"]')
    if (textChip?.dataset.referenceId && textChip.dataset.referenceText) {
      onTextReferenceClick?.({
        id: textChip.dataset.referenceId,
        text: textChip.dataset.referenceText,
      })
    }
  }

  function removeAdjacentReferenceChip(direction: 'Backspace' | 'Delete') {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection?.rangeCount || !selection.isCollapsed) return false

    const range = selection.getRangeAt(0)
    const chip = findAdjacentReferenceChip(editor, range, direction)
    if (!chip) return false

    const imageLabel = chip.dataset.mentionLabel
    if (imageLabel) {
      onChange(value.replace(imageLabel, '').replace(/\s{2,}/g, ' ').trimStart())
      removeChipNodeAndRestoreCursor(chip)
      setMentionOpen(false)
      return true
    }

    const textId = chip.dataset.referenceId
    if (textId) {
      onTextReferenceRemove?.(textId)
      removeChipNodeAndRestoreCursor(chip)
      return true
    }

    return false
  }

  function removeSelectedReferenceChips(editor: HTMLElement) {
    const selection = window.getSelection()
    if (!selection?.rangeCount || selection.isCollapsed) return false

    const range = selection.getRangeAt(0)
    const chips = Array.from(
      editor.querySelectorAll<HTMLElement>('[data-mention-label], [data-reference-chip="text"]'),
    ).filter((chip) => range.intersectsNode(chip))

    if (!chips.length) return false

    const textIds = chips
      .map((chip) => chip.dataset.referenceId)
      .filter((id): id is string => Boolean(id))

    range.deleteContents()
    removeOrphanCaretText(editor)
    const nextValue = getEditablePlainText(editor).replace(/\s{2,}/g, ' ').trimStart()
    onChange(nextValue)
    textIds.forEach((id) => onTextReferenceRemove?.(id))
    setMentionOpen(false)

    const nextCursor = getEditableSelectionOffset(editor)
    selectionOffsetRef.current = nextCursor
    onCursorChange?.(nextCursor)
    return true
  }

  function selectMention(option: PromptMentionOption) {
    onMentionSelect?.(option)
    let nextValue = value
    let nextCursor = editorRef.current ? getEditableSelectionOffset(editorRef.current) : value.length
    if (option.image) {
      setUploadedImageNames((current) => ({
        ...current,
        [option.image as string]: option.name,
      }))
      if (!images.includes(option.image)) {
        onImagesChange(
          [...images, option.image].slice(0, maxImages),
          [...images.map((image, index) => getImageName(image, index)), option.name].slice(0, maxImages),
        )
      }
      nextValue = replaceActiveMentionQuery(
        value,
        editorRef.current ? getEditableSelectionOffset(editorRef.current) : value.length,
        `@${truncateMiddle(normalizeImageName(option.name), 18)}`,
      )
      nextCursor = getActiveMentionEndOffset(nextValue)
      onChange(nextValue)
    } else if (!onMentionSelect) {
      const editor = editorRef.current
      const cursor = editor ? getEditableSelectionOffset(editor) : value.length
      const prefix = value.slice(0, cursor).replace(/@\S*$/, '')
      const suffix = value.slice(cursor)
      nextValue = `${prefix}@${option.name} ${suffix}`
      nextCursor = `${prefix}@${option.name} `.length
      onChange(nextValue)
    }
    setMentionOpen(false)
    setSubjectCreateOpen(false)
    window.requestAnimationFrame(() => {
      const editor = editorRef.current
      if (!editor) return
      editor.innerHTML = renderEditorContent(nextValue, imageMentionTags, textMentionTags)
      editor.focus()
      setEditableSelectionOffset(editor, Math.min(nextCursor, getEditableLength(editor)))
      selectionOffsetRef.current = nextCursor
      onCursorChange?.(nextCursor)
    })
  }

  function openLocalSubjectPicker() {
    fileInputRef.current?.click()
  }

  function addAssetSubject() {
    selectMention({ id: 'asset-subject', name: '资产主体' })
  }

  function removeImage(index: number) {
    const removedLabel = imageMentionTags[index]?.label
    onImagesChange(
      images.filter((_, imageIndex) => imageIndex !== index),
      images
        .map((image, imageIndex) => getImageName(image, imageIndex))
        .filter((_, imageIndex) => imageIndex !== index),
    )
    if (removedLabel && value.includes(removedLabel)) {
      onChange(value.replace(removedLabel, '').replace(/\s{2,}/g, ' ').trimStart())
    }
    setSubmitError('')
    setReferenceDeckOpen(false)
    setMentionOpen(false)
    setSubjectCreateOpen(false)
  }

  function handleImageClick(image: string, index: number) {
    const name = getImageName(image, index)
    const handled = onImageClick?.({ src: image, name, index })
    if (handled) return
    setPreviewImage({ src: image, name })
  }

  function reorderImages(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    const nextImages = [...images]
    const [movedImage] = nextImages.splice(fromIndex, 1)
    nextImages.splice(toIndex, 0, movedImage)
    onImagesChange(nextImages, nextImages.map((image, index) => getImageName(image, index)))
    setSubmitError('')
    setReferenceDeckOpen(false)
    setMentionOpen(false)
    setSubjectCreateOpen(false)
  }

  function onImageDragStart(event: DragEvent<HTMLSpanElement>, index: number) {
    setDraggingImageIndex(index)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }

  function onImageDrop(event: DragEvent<HTMLSpanElement>, index: number) {
    event.preventDefault()
    const fromIndex = Number(event.dataTransfer.getData('text/plain') || draggingImageIndex)
    if (Number.isFinite(fromIndex)) {
      reorderImages(fromIndex, index)
    }
    setDraggingImageIndex(null)
  }

  return (
    <form
      className={cn(
        'prompt-composer',
        compact && 'compact',
        iconOnlyActions && 'icon-only-actions',
        className,
      )}
      onSubmit={submit}
    >
      <div className="prompt-composer-main" ref={mainRef}>
        <div className="prompt-reference-stack">
          {images.length ? (
            <div
              className={cn('prompt-reference-deck', referenceDeckOpen && 'expanded')}
              style={{ '--reference-count': images.length + 1 } as CSSProperties}
              onMouseLeave={() => setReferenceDeckOpen(false)}
            >
              {images.map((image, index) => (
                <span
                  key={`${image}-${index}`}
                  className={cn(
                    'prompt-reference-item',
                    draggingImageIndex === index && 'dragging',
                  )}
                  data-name={getImageName(image, index)}
                  draggable
                  style={{ '--reference-index': index } as CSSProperties}
                  onMouseEnter={() => setReferenceDeckOpen(true)}
                  onFocus={() => setReferenceDeckOpen(true)}
                  onDragStart={(event) => onImageDragStart(event, index)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => onImageDrop(event, index)}
                  onDragEnd={() => setDraggingImageIndex(null)}
                  onClick={() => handleImageClick(image, index)}
                >
                  <img src={image} alt="" draggable={false} />
                  <button
                    className="prompt-reference-delete"
                    type="button"
                    title={`删除${getImageName(image, index)}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      removeImage(index)
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                className="prompt-reference-add-button"
                type="button"
                title="上传参考图"
                style={{ '--reference-index': images.length } as CSSProperties}
                onClick={() => fileInputRef.current?.click()}
              >
                <Plus size={18} />
              </button>
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
          <div className="prompt-input-stack">
            <div
              ref={editorRef}
              className="prompt-rich-editor"
              role="textbox"
              aria-label={ariaLabel}
              contentEditable
              suppressContentEditableWarning
              data-placeholder={placeholder}
              data-empty={editorEmpty}
              onFocus={onFocus}
              onBlur={onBlur}
              onInput={handleEditorInput}
              onKeyDown={handleTextKeyDown}
              onKeyUp={handleCursorChange}
              onMouseUp={handleCursorChange}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              onClick={handleEditorClick}
            />
            {submitError ? <div className="prompt-submit-error">{submitError}</div> : null}
          </div>
          {showActions ? (
            <div className="prompt-composer-actions">
              {actionSlot}
              <button className="mode-button active" type="button" title="Agent 模式">
                <WandSparkles size={15} />
                <span>Agent 模式</span>
              </button>
              <button
                ref={atButtonRef}
                className="mode-button icon-only"
                type="button"
                title="@主体"
                onClick={handleAtClick}
              >
                <AtSign size={15} />
              </button>
            </div>
          ) : null}
        </div>
        <button className="prompt-send-button" type="submit" disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <ArrowUp size={20} />}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={onFileChange}
        />
        {mentionOpen ? (
          <div
            className={`prompt-mention-menu ${mentionAnchor.placement}`}
            style={{
              left: mentionAnchor.left,
              top: mentionAnchor.top,
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            {availableMentionOptions.length ? (
              availableMentionOptions.slice(0, 8).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  title={option.name}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    selectMention(option)
                  }}
                >
                  {option.image ? <img src={option.image} alt="" /> : <span className="mention-fallback">@</span>}
                  <span>{truncateMiddle(option.name, 18)}</span>
                </button>
              ))
            ) : (
              <div className="mention-empty-state">
                <span className="mention-empty-label">可能@的内容</span>
                <div className="mention-empty-illustration">
                  <UploadCloud size={28} />
                </div>
                <strong>你还没有创建过主体</strong>
                {subjectCreateOpen ? (
                  <div className="mention-create-options">
                    <button type="button" onClick={openLocalSubjectPicker}>
                      <UploadCloud size={16} />
                      <span>本地添加</span>
                    </button>
                    <button type="button" onClick={addAssetSubject}>
                      <FolderOpen size={16} />
                      <span>资产添加</span>
                    </button>
                  </div>
                ) : null}
                <button
                  className="mention-create-button"
                  type="button"
                  onClick={() => setSubjectCreateOpen((open) => !open)}
                >
                  <Plus size={15} />
                  <span>创建主体</span>
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
      {previewImage ? createPortal(
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
      ) : null}
    </form>
  )

  function getButtonAnchor() {
    const button = atButtonRef.current
    const main = mainRef.current
    if (!button || !main) return { left: 86, top: 58, placement: 'below' }

    const buttonRect = button.getBoundingClientRect()
    const mainRect = main.getBoundingClientRect()
    return clampMentionAnchor({
      viewportLeft: buttonRect.left,
      viewportTop: buttonRect.bottom + 8,
      triggerTop: buttonRect.top,
      triggerBottom: buttonRect.bottom,
      mainRect,
      preferredPlacement: 'below',
    })
  }

  function getCaretAnchor(editor: HTMLDivElement) {
    const main = mainRef.current
    if (!main) return { left: 86, top: 58, placement: 'below' }

    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null
    const editorRect = editor.getBoundingClientRect()
    const mainRect = main.getBoundingClientRect()
    let rect = range?.getBoundingClientRect()

    if (range && (!rect || (rect.width === 0 && rect.height === 0))) {
      const restoreRange = range.cloneRange()
      const marker = window.document.createElement('span')
      marker.className = 'prompt-caret-marker'
      marker.textContent = '\u200b'
      range.insertNode(marker)
      rect = marker.getBoundingClientRect()
      marker.remove()
      selection?.removeAllRanges()
      selection?.addRange(restoreRange)
    }

    const triggerLeft = rect && Number.isFinite(rect.left) ? rect.left : editorRect.left
    const triggerTop = rect && Number.isFinite(rect.top) ? rect.top : editorRect.top

    return clampMentionAnchor({
      viewportLeft: triggerLeft,
      viewportTop: triggerTop + 26,
      triggerTop,
      triggerBottom: triggerTop + 22,
      mainRect,
      preferredPlacement: 'below',
    })
  }

  function clampMentionAnchor({
    viewportLeft,
    viewportTop,
    triggerTop,
    triggerBottom,
    mainRect,
    preferredPlacement,
  }: {
    viewportLeft: number
    viewportTop: number
    triggerTop: number
    triggerBottom: number
    mainRect: DOMRect
    preferredPlacement: 'above' | 'below'
  }) {
    const viewportPadding = 10
    const clampedViewportLeft = Math.min(
      window.innerWidth - mentionSize.width - viewportPadding,
      Math.max(viewportPadding, viewportLeft),
    )
    const belowTop = triggerBottom + 8
    const aboveTop = triggerTop - 8
    const canShowBelow = belowTop + mentionSize.height <= window.innerHeight - viewportPadding
    const canShowAbove = triggerTop - mentionSize.height - 8 >= viewportPadding
    const placement =
      preferredPlacement === 'above'
        ? canShowAbove || !canShowBelow
          ? 'above'
          : 'below'
        : canShowBelow || !canShowAbove
          ? 'below'
          : 'above'
    const nextViewportTop =
      placement === 'above'
        ? Math.max(viewportPadding + mentionSize.height, aboveTop)
        : Math.min(window.innerHeight - mentionSize.height - viewportPadding, viewportTop)

    return {
      left: Math.round(clampedViewportLeft - mainRect.left),
      top: Math.round(nextViewportTop - mainRect.top),
      placement,
    }
  }
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function normalizeImageName(name: string) {
  return name.replace(/\.[a-z0-9]{1,8}$/i, '')
}

function normalizeEditableText(text: string) {
  return text.replace(/\u00a0/g, ' ').replace(/\u200b/g, '').replace(/\n{3,}/g, '\n\n')
}

function getEditablePlainText(root: HTMLElement) {
  return normalizeEditableText(getNodePlainText(getEditableLine(root)))
}

function renderEditorContent(
  value: string,
  imageTags: Array<{ src: string; name: string; label: string }>,
  textTags: Array<{ id: string; text: string; label: string; insertOffset?: number }>,
) {
  const textChips = textTags.map((tag) => ({
    html:
    `<span class="prompt-inline-text-mention" contenteditable="false" data-reference-chip="text" data-reference-id="${escapeHtml(tag.id)}" data-reference-text="${escapeHtml(tag.text)}" title="${escapeHtml(tag.text)}">` +
    '<span>T</span>' +
    `<strong>${escapeHtml(tag.label)}</strong>` +
    '</span>',
    offset: clampNumber(tag.insertOffset ?? 0, 0, value.length),
  }))

  if (!value) return wrapEditorLine(textChips.map((chip) => chip.html).join(''))
  const tags = imageTags
    .filter((tag) => tag.label.trim())
    .sort((a, b) => b.label.length - a.label.length)
  const parts: string[] = []
  let cursor = 0
  let chipIndex = 0
  const sortedTextChips = textChips.sort((a, b) => a.offset - b.offset)
  const pushTextChipsAt = (offset: number) => {
    while (chipIndex < sortedTextChips.length && sortedTextChips[chipIndex].offset <= offset) {
      parts.push(sortedTextChips[chipIndex].html)
      chipIndex += 1
    }
  }

  pushTextChipsAt(0)

  while (cursor < value.length) {
    const nextMatch = tags
      .map((tag) => ({ tag, index: value.indexOf(tag.label, cursor) }))
      .filter((match) => match.index >= 0)
      .sort((a, b) => a.index - b.index)[0]

    if (!nextMatch) {
      appendTextWithChips(parts, value.slice(cursor), cursor, pushTextChipsAt)
      cursor = value.length
      break
    }

    if (nextMatch.index > cursor) {
      appendTextWithChips(parts, value.slice(cursor, nextMatch.index), cursor, pushTextChipsAt)
    }

    pushTextChipsAt(nextMatch.index)
    parts.push(
      `<span class="prompt-inline-image-mention" contenteditable="false" data-mention-label="${escapeHtml(nextMatch.tag.label)}" title="${escapeHtml(nextMatch.tag.name)}">` +
      '<span class="prompt-inline-image-trigger">' +
      `<img src="${escapeHtml(nextMatch.tag.src)}" alt="" />` +
      `<strong>${escapeHtml(nextMatch.tag.label.slice(1))}</strong>` +
      '</span>' +
      `<em><img src="${escapeHtml(nextMatch.tag.src)}" alt="${escapeHtml(nextMatch.tag.name)}" /></em>` +
      '</span>',
      '\u200b',
    )
    cursor = nextMatch.index + nextMatch.tag.label.length
    pushTextChipsAt(cursor)
  }
  pushTextChipsAt(value.length)

  return wrapEditorLine(parts.join(''))
}

function appendTextWithChips(
  parts: string[],
  text: string,
  baseOffset: number,
  pushTextChipsAt: (offset: number) => void,
) {
  for (let index = 0; index < text.length; index += 1) {
    pushTextChipsAt(baseOffset + index)
    parts.push(escapeHtml(text[index]))
  }
  pushTextChipsAt(baseOffset + text.length)
}

function wrapEditorLine(content: string) {
  return `<p class="prompt-rich-editor-line">${content || '<br />'}</p>`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function truncateMiddle(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  const headLength = Math.ceil((maxLength - 1) / 2)
  const tailLength = Math.floor((maxLength - 1) / 2)
  return `${value.slice(0, headLength)}…${value.slice(-tailLength)}`
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function replaceActiveMentionQuery(value: string, cursor: number, replacement: string) {
  const beforeCursor = value.slice(0, cursor)
  const afterCursor = value.slice(cursor)
  const nextBeforeCursor = beforeCursor.replace(/@[^@\s]*$/, replacement)
  return `${nextBeforeCursor}${afterCursor}`.replace(/\s{2,}/g, ' ')
}

function getActiveMentionQuery(value: string, cursor: number) {
  const beforeCursor = value.slice(0, cursor)
  const match = beforeCursor.match(/@[^@\s]*$/)
  return match?.[0] ?? ''
}

function getActiveMentionEndOffset(value: string) {
  const match = Array.from(value.matchAll(/@[^@\s]+/g)).at(-1)
  return match ? match.index + match[0].length : value.length
}

function getActiveMentionQueryFromSelection(root: HTMLElement) {
  const selection = window.getSelection()
  if (!selection?.anchorNode || !root.contains(selection.anchorNode)) return ''

  const node = selection.anchorNode
  if (node.nodeType === Node.TEXT_NODE) {
    return getActiveMentionQuery(node.textContent ?? '', selection.anchorOffset)
  }

  if (node instanceof HTMLElement) {
    const child = node.childNodes[Math.max(0, selection.anchorOffset - 1)]
    if (child?.nodeType === Node.TEXT_NODE) {
      return getActiveMentionQuery(child.textContent ?? '', child.textContent?.length ?? 0)
    }
  }

  return ''
}

function removeChipNodeAndRestoreCursor(chip: HTMLElement) {
  const range = window.document.createRange()
  const selection = window.getSelection()
  const previous = chip.previousSibling
  const parent = chip.parentNode
  const nextText = chip.nextSibling?.nodeType === Node.TEXT_NODE ? chip.nextSibling : null
  chip.remove()
  if (nextText?.textContent === '\u200b') nextText.remove()

  if (previous?.nodeType === Node.TEXT_NODE) {
    range.setStart(previous, previous.textContent?.length ?? 0)
  } else if (parent) {
    range.setStart(parent, 0)
  } else {
    return
  }

  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function removeOrphanCaretText(root: HTMLElement) {
  const walker = window.document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let node = walker.nextNode()
  while (node) {
    if (node instanceof Text && node.textContent?.includes('\u200b')) {
      nodes.push(node)
    }
    node = walker.nextNode()
  }

  nodes.forEach((node) => {
    const previous = node.previousSibling
    const followsImageChip = previous instanceof HTMLElement && Boolean(previous.dataset.mentionLabel)
    const nextText = (node.textContent ?? '').replace(/\u200b/g, '')
    if (followsImageChip) {
      const normalizedText = `\u200b${nextText}`
      if (node.textContent !== normalizedText) {
        node.textContent = normalizedText
      }
      return
    }
    if (nextText) {
      node.textContent = nextText
    } else {
      node.remove()
    }
  })
}

function getFollowingCaretText(node: HTMLElement) {
  const sibling = node.nextSibling
  return sibling?.nodeType === Node.TEXT_NODE
    ? sibling
    : null
}

function getEditableLine(root: HTMLElement) {
  return root.querySelector<HTMLElement>('.prompt-rich-editor-line') ?? root
}

function getEditableLength(root: HTMLElement) {
  return getNodePlainText(getEditableLine(root)).length
}

function getNodePlainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\u200b/g, '')
  if (!(node instanceof HTMLElement)) return ''
  if (node.dataset.mentionLabel) return node.dataset.mentionLabel
  if (node.dataset.referenceChip === 'text') return ''
  if (node.tagName === 'BR') return '\n'
  return Array.from(node.childNodes).map(getNodePlainText).join('')
}

function getNodePlainTextLength(node: Node): number {
  return getNodePlainText(node).length
}

function getDomOffsetFromPlainOffset(text: string, plainOffset: number) {
  let visibleCount = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\u200b') visibleCount += 1
    if (visibleCount >= plainOffset) return index + 1
  }
  return text.length
}

function getEditableSelectionOffset(root: HTMLElement) {
  const selection = window.getSelection()
  const line = getEditableLine(root)
  if (!selection?.anchorNode || !root.contains(selection.anchorNode)) return getEditableLength(root)
  return getOffsetToPosition(line, selection.anchorNode, selection.anchorOffset) ?? getEditableLength(root)
}

function setEditableSelectionOffset(root: HTMLElement, offset: number) {
  const range = window.document.createRange()
  const selection = window.getSelection()
  let remaining = offset
  const line = getEditableLine(root)
  const walker = window.document.createTreeWalker(line, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let node = walker.nextNode()
  while (node) {
    if (node instanceof HTMLElement && node.dataset.mentionLabel) {
      const labelLength = node.dataset.mentionLabel.length
      if (remaining <= labelLength) {
        const spacerText = getFollowingCaretText(node)
        if (spacerText?.nodeType === Node.TEXT_NODE) {
          range.setStart(spacerText, spacerText.textContent?.length ?? 0)
        } else {
          range.setStartAfter(node)
        }
        range.collapse(true)
        selection?.removeAllRanges()
        selection?.addRange(range)
        return
      }
      remaining -= labelLength
      node = walker.nextSibling()
      continue
    }
    if (node instanceof HTMLElement && node.dataset.referenceChip === 'text') {
      node = walker.nextSibling()
      continue
    }
    if (isInsideTextReferenceChip(node)) {
      node = walker.nextNode()
      continue
    }
    const text = node.textContent ?? ''
    const length = node.nodeType === Node.TEXT_NODE ? text.replace(/\u200b/g, '').length : text.length
    if (remaining <= length) {
      range.setStart(node, getDomOffsetFromPlainOffset(text, remaining))
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    remaining -= length
    node = walker.nextNode()
  }
  range.selectNodeContents(line)
  range.collapse(false)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function getOffsetToPosition(root: Node, target: Node, targetOffset: number) {
  let offset = 0
  let found = false

  function walk(node: Node) {
    if (found) return

    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        offset += (node.textContent ?? '').slice(0, targetOffset).replace(/\u200b/g, '').length
      } else {
        const children = Array.from(node.childNodes).slice(0, targetOffset)
        offset += children.reduce((sum, child) => sum + getNodePlainTextLength(child), 0)
      }
      found = true
      return
    }

    if (node.nodeType === Node.TEXT_NODE) {
      offset += (node.textContent ?? '').replace(/\u200b/g, '').length
      return
    }

    if (!(node instanceof HTMLElement)) return
    if (node.dataset.mentionLabel) {
      offset += node.dataset.mentionLabel.length
      return
    }
    if (node.dataset.referenceChip === 'text') return
    if (node.tagName === 'BR') {
      offset += 1
      return
    }
    node.childNodes.forEach(walk)
  }

  walk(root)
  return found ? offset : null
}

function isInsideTextReferenceChip(node: Node) {
  return Boolean(node.parentElement?.closest('[data-reference-chip="text"]'))
}

function findAdjacentReferenceChip(
  root: HTMLElement,
  range: Range,
  direction: 'Backspace' | 'Delete',
) {
  const container = range.startContainer
  const offset = range.startOffset
  const parent = container.nodeType === Node.TEXT_NODE ? container.parentElement : container as HTMLElement

  if (!parent || !root.contains(parent)) return null

  if (container.nodeType === Node.TEXT_NODE) {
    const text = container.textContent ?? ''
    const beforeCursor = text.slice(0, offset)
    const afterCursor = text.slice(offset)
    if (direction === 'Backspace' && beforeCursor.replace(/\u200b/g, '') === '') {
      const spacerChip = getReferenceChip(container.previousSibling)
      if (spacerChip) return spacerChip
    }
    if (direction === 'Delete' && afterCursor.replace(/\u200b/g, '') === '') {
      const spacerChip = getReferenceChip(container.nextSibling)
      if (spacerChip) return spacerChip
    }
    if (direction === 'Backspace' && offset > 0) return null
    if (direction === 'Delete' && offset < (container.textContent?.length ?? 0)) return null
  }

  const boundaryNode =
    container.nodeType === Node.TEXT_NODE
      ? container
      : parent.childNodes[Math.max(0, direction === 'Backspace' ? offset - 1 : offset)]
  const directChip = getReferenceChip(boundaryNode)
  if (directChip) return directChip

  const sibling = direction === 'Backspace'
    ? previousMeaningfulSibling(boundaryNode)
    : nextMeaningfulSibling(boundaryNode)
  return getReferenceChip(sibling)
}

function getReferenceChip(node: Node | null | undefined) {
  if (!(node instanceof HTMLElement)) return null
  if (node.dataset.mentionLabel || node.dataset.referenceChip === 'text') return node
  return node.closest<HTMLElement>('[data-mention-label], [data-reference-chip="text"]')
}

function previousMeaningfulSibling(node: Node | null | undefined) {
  let current = node?.previousSibling ?? null
  while (
    current &&
    (
      current.nodeType === Node.TEXT_NODE && !current.textContent?.replace(/\u200b/g, '').trim()
    )
  ) {
    current = current.previousSibling
  }
  return current
}

function nextMeaningfulSibling(node: Node | null | undefined) {
  let current = node?.nextSibling ?? null
  while (
    current &&
    (
      current.nodeType === Node.TEXT_NODE && !current.textContent?.replace(/\u200b/g, '').trim()
    )
  ) {
    current = current.nextSibling
  }
  return current
}
