import type { CSSProperties } from 'react'
import type { Artboard, DesignElement } from '../types'
import { cornerRadiiToCss, resolveCornerRadii, textLineHeightToCss } from './design-properties'

export function elementCanvasPosition(element: DesignElement, artboard: Artboard) {
  return { left: element.x - artboard.x, top: element.y - artboard.y }
}

export function elementVisualStyle(element: DesignElement): CSSProperties {
  const style: CSSProperties = {
    position: 'absolute',
    display: 'flex',
    alignItems: 'stretch',
    justifyContent: 'stretch',
    width: element.width,
    height: element.height,
    opacity: element.opacity ?? 1,
    zIndex: element.zIndex,
    transform: `rotate(${element.rotation ?? 0}deg) scale(${element.flipX ? -1 : 1}, ${element.flipY ? -1 : 1})`,
    transformOrigin: 'center',
    overflow: element.clipContent ? 'hidden' : 'visible',
    borderRadius: cornerRadiiToCss(resolveCornerRadii(element)),
  }
  if (element.shadow)
    style.boxShadow = `${element.shadow.x}px ${element.shadow.y}px ${element.shadow.blur}px ${element.shadow.spread ?? 0}px ${element.shadow.color}`

  if (element.type === 'text') {
    Object.assign(style, {
      whiteSpace: 'pre-wrap',
      color: element.style.color,
      fontFamily: element.style.fontFamily,
      fontSize: element.style.fontSize,
      fontWeight: element.style.fontWeight ?? 400,
      lineHeight: textLineHeightToCss(element.style.lineHeight) ?? 1.2,
      textAlign: element.style.textAlign ?? 'left',
      overflow: element.style.overflow === 'visible' ? 'visible' : 'hidden',
    })
  } else if (element.type === 'image') {
    Object.assign(style, { display: 'block' })
  } else if (element.type === 'button') {
    Object.assign(style, {
      display: 'grid',
      placeItems: 'center',
      border: '0',
      background: element.style.background,
      color: element.style.color,
      fontSize: element.style.fontSize,
      fontWeight: element.style.fontWeight ?? 700,
      textAlign: 'center',
    })
  } else if (element.type === 'input') {
    Object.assign(style, {
      display: 'flex',
      alignItems: 'center',
      width: '100%',
      height: '100%',
      padding: '0 10px',
      background: element.style.background,
      color: element.style.color,
      fontSize: element.style.fontSize,
      fontWeight: element.style.fontWeight ?? 400,
      border: `${element.style.borderWidth ?? 1}px solid ${element.style.borderColor ?? '#d1d5db'}`,
    })
  } else if (element.type === 'shape') {
    Object.assign(style, {
      background: element.fill,
      borderStyle: element.stroke ? 'solid' : 'none',
      borderColor: element.stroke ?? 'transparent',
      borderWidth: element.strokeWidth ?? 0,
      border: element.stroke
        ? `${element.strokeWidth ?? 0}px solid ${element.stroke}`
        : '0 solid transparent',
      borderRadius: element.shape === 'circle' ? '50%' : style.borderRadius,
    })
  }
  return style
}
