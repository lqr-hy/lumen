import { useEffect, useRef } from 'react'
import type { CSSProperties, KeyboardEvent, MutableRefObject, PointerEvent, RefObject } from 'react'
import type { DesignElement } from '../types'
import { cn } from '../../../lib/cn'

interface ElementRendererProps {
  element: DesignElement
  selected: boolean
  editing: boolean
  onPointerDown: (event: PointerEvent<HTMLDivElement>, element: DesignElement) => void
  onEditStart: (element: DesignElement) => void
  onTextChange: (id: string, content: string) => void
  onTextEditEnd: () => void
}

export function ElementRenderer({
  element,
  selected,
  editing,
  onPointerDown,
  onEditStart,
  onTextChange,
  onTextEditEnd,
}: ElementRendererProps) {
  const textRef = useRef<HTMLDivElement>(null)
  const textDraftRef = useRef('')
  const textContent = element.type === 'text' ? element.content : ''

  useEffect(() => {
    if (!editing || element.type !== 'text') return
    const node = textRef.current
    if (!node) return
    textDraftRef.current = textContent
    node.textContent = textContent
    node.focus()
    const range = window.document.createRange()
    range.selectNodeContents(node)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [editing, element.id, element.type, textContent])

  if (element.visible === false) return null

  const baseStyle: CSSProperties = {
    position: 'absolute',
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    opacity: element.opacity ?? 1,
    zIndex: element.zIndex,
    transform: `rotate(${element.rotation ?? 0}deg) scale(${element.flipX ? -1 : 1}, ${
      element.flipY ? -1 : 1
    })`,
    cursor: editing ? 'text' : element.locked ? 'default' : 'move',
    overflow: element.clipContent ? 'hidden' : undefined,
    boxShadow: element.shadow
      ? `${element.shadow.x}px ${element.shadow.y}px ${element.shadow.blur}px ${element.shadow.spread ?? 0}px ${element.shadow.color}`
      : undefined,
  }

  function handleTextKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      onTextEditEnd()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onTextChange(element.id, textDraftRef.current)
      onTextEditEnd()
    }
  }

  return (
    <div
      data-element-id={element.id}
      className={cn('design-element', selected && 'selected', editing && 'editing')}
      style={baseStyle}
      onDoubleClick={(event) => {
        if (element.type !== 'text' || element.locked) return
        event.preventDefault()
        event.stopPropagation()
        onEditStart(element)
      }}
      onPointerDown={(event) => {
        if (editing) {
          event.stopPropagation()
          return
        }
        onPointerDown(event, element)
      }}
    >
      {renderElement(element, {
        editing,
        textRef,
        onTextChange,
        onTextEditEnd,
        onTextKeyDown: handleTextKeyDown,
        textDraftRef,
      })}
    </div>
  )
}

function renderElement(
  element: DesignElement,
  options: {
    editing: boolean
    textRef: RefObject<HTMLDivElement | null>
    onTextChange: (id: string, content: string) => void
    onTextEditEnd: () => void
    onTextKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
    textDraftRef: MutableRefObject<string>
  },
) {
  if (element.type === 'text') {
    const style = element.style ?? {
      color: '#111827',
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 1.4,
      textAlign: 'left' as const,
    }
    return (
      <div
        ref={options.textRef}
        className="text-element"
        contentEditable={options.editing}
        suppressContentEditableWarning
        onInput={(event) => {
          options.textDraftRef.current = event.currentTarget.textContent ?? ''
        }}
        onBlur={() => {
          options.onTextChange(element.id, options.textDraftRef.current)
          options.onTextEditEnd()
        }}
        onKeyDown={options.onTextKeyDown}
        onPointerDown={(event) => {
          if (options.editing) event.stopPropagation()
        }}
        style={{
          color: style.color,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          textAlign: style.textAlign,
          overflow: style.overflow === 'visible' ? 'visible' : 'hidden',
          textOverflow: style.overflow === 'ellipsis' ? 'ellipsis' : undefined,
        }}
      >
        {options.editing ? null : element.content}
      </div>
    )
  }

  if (element.type === 'image') {
    return (
      <img
        className="image-element"
        src={element.src}
        crossOrigin="anonymous"
        style={{
          objectFit: element.objectFit ?? 'cover',
          objectPosition: element.objectPosition ?? '50% 50%',
          borderRadius: element.borderRadius,
        }}
        alt=""
        draggable={false}
      />
    )
  }

  if (element.type === 'button') {
    const style = element.style ?? {
      background: '#111827',
      color: '#ffffff',
      fontSize: 14,
      fontWeight: 700,
      borderRadius: 8,
    }
    return (
      <button
        className="button-element"
        style={{
          background: style.background,
          color: style.color,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          borderRadius: style.borderRadius,
        }}
      >
        {element.content}
      </button>
    )
  }

  if (element.type === 'section') {
    return <div className="component-section-element" aria-label={element.label} />
  }

  if (element.type === 'runtime-placeholder') {
    return (
      <div className="runtime-placeholder-element">
        <span>{element.label}</span>
      </div>
    )
  }

  return (
    <div
      className={cn('shape-element', element.shape === 'circle' && 'circle')}
      style={{
        background: element.fill,
        borderColor: element.stroke,
        borderWidth: element.strokeWidth,
        borderRadius: element.shape === 'circle' ? '50%' : element.borderRadius,
      }}
    />
  )
}
