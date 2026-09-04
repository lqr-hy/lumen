import type { CSSProperties, PointerEvent, ReactNode } from 'react'
import type { Artboard } from '../types'
import { cn } from '../../../lib/cn'

export function ArtboardFrame({
  artboard,
  active = false,
  onPointerDown,
  children,
  showLabel = false,
}: {
  artboard: Artboard
  active?: boolean
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void
  children?: ReactNode
  showLabel?: boolean
}) {
  const style: CSSProperties = {
    position: 'absolute',
    left: artboard.x,
    top: artboard.y,
    width: artboard.width,
    height: artboard.height,
    background: artboard.background,
    borderRadius: artboard.borderRadius ?? 0,
    overflow: artboard.overflow ?? 'hidden',
    boxSizing: 'border-box',
    isolation: 'isolate',
  }
  return (
    <div
      className={cn('artboard', active && 'active')}
      data-artboard-id={artboard.id}
      onPointerDown={onPointerDown}
      style={style}
    >
      {showLabel ? <div className="artboard-label">{artboard.name}</div> : null}
      {children}
    </div>
  )
}
