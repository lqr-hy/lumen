import type { PointerEvent } from 'react'

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface SelectionTarget {
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  flipX?: boolean
  flipY?: boolean
}

interface SelectionBoxProps {
  target: SelectionTarget
  onResizeStart: (event: PointerEvent<HTMLButtonElement>, handle: ResizeHandle) => void
}

const handles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function SelectionBox({ target, onResizeStart }: SelectionBoxProps) {
  return (
    <div
      className="selection-box"
      style={{
        left: target.x,
        top: target.y,
        width: target.width,
        height: target.height,
        transform: `rotate(${target.rotation ?? 0}deg) scale(${target.flipX ? -1 : 1}, ${
          target.flipY ? -1 : 1
        })`,
      }}
    >
      {handles.map((handle) => (
        <button
          key={handle}
          className={`resize-handle ${handle}`}
          aria-label={`resize ${handle}`}
          onPointerDown={(event) => onResizeStart(event, handle)}
        />
      ))}
    </div>
  )
}

export type { ResizeHandle, SelectionTarget }
