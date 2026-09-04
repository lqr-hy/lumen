import { useLayoutEffect, useRef } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import type { DesignElement } from '../types'
import {
  buildRenderBox,
  toReactStyle,
  type RenderBox,
  type RenderDiagnostic,
} from '../render/render-box'
import { RenderBoxView } from '../render/RenderBoxView'

export interface ElementRendererProps {
  element: DesignElement
  selected: boolean
  editing: boolean
  onPointerDown: (event: PointerEvent<HTMLDivElement>, element: DesignElement) => void
  onEditStart: (element: DesignElement) => void
  onTextChange: (id: string, content: string) => void
  onTextSelectionChange?: (selection: {
    elementId: string
    start: number
    end: number
    selectedText: string
    prefix: string
    suffix: string
    content: string
  }) => void
  onTextEditEnd: () => void
}

/**
 * 画布元素渲染器。视觉全部来自 Render IR，本组件只负责叠加编辑器交互态。
 * 元素在画布上使用世界坐标，故 origin 为零点。
 */
export function ElementRenderer({
  element,
  selected,
  editing,
  onPointerDown,
  onEditStart,
  onTextChange,
  onTextSelectionChange,
  onTextEditEnd,
}: ElementRendererProps) {
  const diagnostics: RenderDiagnostic[] = []
  const box = buildRenderBox(element, {
    mode: 'canvas',
    origin: { x: 0, y: 0 },
    diagnostics,
  })
  if (!box) return null

  const override = (target: RenderBox) => {
    if (target.role === 'box') {
      return {
        className: [selected && 'selected', editing && 'editing'].filter(Boolean).join(' '),
        style: {
          cursor: editing ? 'text' : element.locked ? 'default' : 'move',
          ...(element.type === 'runtime-placeholder'
            ? { pointerEvents: 'none' as const }
            : undefined),
        },
        props: {
          onDoubleClick: (event: React.MouseEvent) => {
            if (element.type !== 'text' || element.locked) return
            event.preventDefault()
            event.stopPropagation()
            onEditStart(element)
          },
          onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
            if (editing) {
              event.stopPropagation()
              return
            }
            onPointerDown(event, element)
          },
        },
      }
    }
    // 文本编辑态用 contentEditable 接管内容层，样式仍取 IR。
    if (target.role === 'content' && editing && element.type === 'text') {
      return {
        children: (
          <EditableTextElement
            element={element}
            style={toReactStyle(target.css)}
            onTextChange={onTextChange}
            onTextSelectionChange={onTextSelectionChange}
            onTextEditEnd={onTextEditEnd}
          />
        ),
        style: { display: 'contents' as const },
      }
    }
    return undefined
  }

  return <RenderBoxView box={box} override={override} />
}

function EditableTextElement({
  element,
  style,
  onTextChange,
  onTextSelectionChange,
  onTextEditEnd,
}: {
  element: Extract<DesignElement, { type: 'text' }>
  style: CSSProperties
  onTextChange: (id: string, content: string) => void
  onTextSelectionChange: ElementRendererProps['onTextSelectionChange']
  onTextEditEnd: () => void
}) {
  const textRef = useRef<HTMLDivElement>(null)
  const initialTextRef = useRef(element.content)
  const textDraftRef = useRef(initialTextRef.current)

  useLayoutEffect(() => {
    const node = textRef.current
    if (!node) return
    node.textContent = initialTextRef.current
    node.focus()
    const range = window.document.createRange()
    range.selectNodeContents(node)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [])

  const commitText = () => {
    onTextChange(element.id, textDraftRef.current)
  }

  const captureSelection = (node: HTMLDivElement) => {
    const range = readTextSelection(node)
    if (range) onTextSelectionChange?.({ elementId: element.id, ...range })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onTextEditEnd()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      commitText()
      onTextEditEnd()
    }
  }

  return (
    <div
      ref={textRef}
      className="text-element"
      contentEditable
      suppressContentEditableWarning
      onInput={(event) => {
        textDraftRef.current = event.currentTarget.textContent ?? ''
      }}
      onBlur={() => {
        commitText()
        onTextEditEnd()
      }}
      onKeyDown={handleKeyDown}
      onPointerUp={(event) => {
        event.stopPropagation()
        captureSelection(event.currentTarget)
      }}
      onKeyUp={(event) => {
        if (!event.shiftKey) return
        captureSelection(event.currentTarget)
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
      style={style}
    />
  )
}

function readTextSelection(root: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return undefined
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return undefined
  const before = window.document.createRange()
  before.selectNodeContents(root)
  before.setEnd(range.startContainer, range.startOffset)
  const start = before.toString().length
  const selectedText = range.toString()
  const end = start + selectedText.length
  const content = root.textContent ?? ''
  if (!selectedText || content.slice(start, end) !== selectedText) return undefined
  return {
    start,
    end,
    selectedText,
    prefix: content.slice(Math.max(0, start - 24), start),
    suffix: content.slice(end, end + 24),
    content,
  }
}
