import type { Artboard, DesignElement, DesignSurfaceKind } from '../types'
import type { SceneGraph, SceneNode, SceneNodeType } from './scene-graph'

interface ToSceneGraphOptions {
  graphId: string
  rootNodeId: string
  artboard: Artboard
  surfaceKind: DesignSurfaceKind | 'custom'
  contentHeight: number
  adapterId: string
  mode?: SceneGraph['mode']
}

export function designElementsToSceneGraph(
  elements: DesignElement[],
  options: ToSceneGraphOptions,
): SceneGraph {
  return {
    version: 1,
    id: options.graphId,
    rootNodeId: options.rootNodeId,
    mode: options.mode ?? 'editable-scene',
    surface: {
      kind: options.surfaceKind,
      width: options.artboard.width,
      height: options.contentHeight,
      originX: options.artboard.x,
      originY: options.artboard.y,
    },
    nodes: elements.map((element) => designElementToSceneNode(element, options.adapterId)),
  }
}

export function designElementToSceneNode(element: DesignElement, adapterId: string): SceneNode {
  const type = toSceneNodeType(element)
  const regionId =
    element.designBlockId ?? (element.designRole === 'page-shell' ? 'page-shell' : 'scene-root')
  const style =
    element.type === 'shape'
      ? {
          fill: element.fill,
          stroke: element.stroke,
          strokeWidth: element.strokeWidth,
          shape: element.shape,
          borderRadius: element.borderRadius,
          cornerRadii: element.cornerRadii,
          shadow: element.shadow,
        }
      : element.type === 'text'
        ? { ...element.style, cornerRadii: element.cornerRadii, shadow: element.shadow }
        : element.type === 'button'
          ? { ...element.style, cornerRadii: element.cornerRadii, shadow: element.shadow }
          : element.type === 'input'
            ? {
                background: element.style.background,
                color: element.style.color,
                fontSize: element.style.fontSize,
                fontWeight: element.style.fontWeight,
                borderRadius: element.style.borderRadius,
                stroke: element.style.borderColor,
                strokeWidth: element.style.borderWidth,
                cornerRadii: element.cornerRadii,
                shadow: element.shadow,
              }
            : element.type === 'image'
              ? {
                  borderRadius: element.borderRadius,
                  cornerRadii: element.cornerRadii,
                  shadow: element.shadow,
                }
              : { cornerRadii: element.cornerRadii, shadow: element.shadow }

  return {
    id: element.id,
    type,
    parentId: element.parentId,
    name: element.name,
    bounds: { x: element.x, y: element.y, width: element.width, height: element.height },
    zIndex: element.zIndex,
    content:
      element.type === 'text' || element.type === 'button' || element.type === 'input'
        ? element.content
        : undefined,
    asset:
      element.type === 'image'
        ? { source: element.src, fit: element.objectFit, position: element.objectPosition }
        : undefined,
    style,
    layout: {
      sizing: element.layoutSizing,
      constraints: element.layoutConstraints,
      autoLayout: element.type === 'section' ? element.autoLayout : undefined,
    },
    visible: element.visible,
    locked: element.locked,
    rotation: element.rotation,
    flipX: element.flipX,
    flipY: element.flipY,
    opacity: element.opacity,
    clipContent: element.clipContent,
    source: { adapterId, sourceNodeId: element.id, confidence: 1 },
    ownership: {
      regionId,
      role: 'structure',
    },
    bindings: element.componentBinding
      ? { 'canvas.componentBinding': structuredClone(element.componentBinding) }
      : undefined,
    metadata: {
      artboardId: element.artboardId,
      canvasType:
        element.type === 'section' || element.type === 'runtime-placeholder'
          ? element.type
          : undefined,
      label:
        element.type === 'section' || element.type === 'runtime-placeholder'
          ? element.label
          : undefined,
      preview: element.type === 'runtime-placeholder' ? element.preview : undefined,
      textColor: element.type === 'runtime-placeholder' ? element.textColor : undefined,
      designRole: element.designRole,
      designBlockId: element.designBlockId,
    },
  }
}

export function sceneNodeToDesignElement(node: SceneNode, artboardId?: string): DesignElement {
  const base = {
    id: node.id,
    artboardId: node.metadata?.artboardId ?? artboardId,
    parentId: node.parentId,
    name: node.name,
    x: node.bounds.x,
    y: node.bounds.y,
    width: node.bounds.width,
    height: node.bounds.height,
    zIndex: node.zIndex,
    layoutSizing: node.layout?.sizing,
    cornerRadii: node.style?.cornerRadii,
    rotation: node.rotation,
    flipX: node.flipX,
    flipY: node.flipY,
    opacity: node.opacity,
    locked: node.locked,
    visible: node.visible,
    componentBinding: node.bindings?.[
      'canvas.componentBinding'
    ] as DesignElement['componentBinding'],
    designRole: node.metadata?.designRole,
    designBlockId: node.metadata?.designBlockId,
    layoutConstraints: node.layout?.constraints,
    shadow: node.style?.shadow,
    clipContent: node.clipContent,
  }

  if (node.type === 'text') {
    return {
      ...base,
      type: 'text',
      content: node.content ?? '',
      style: {
        fontSize: node.style?.fontSize ?? 14,
        fontWeight: node.style?.fontWeight,
        color: node.style?.color ?? '#111111',
        lineHeight: node.style?.lineHeight,
        textAlign: node.style?.textAlign,
        fontFamily: node.style?.fontFamily,
        overflow: node.style?.overflow,
      },
    }
  }
  if (node.type === 'button') {
    return {
      ...base,
      type: 'button',
      content: node.content ?? '',
      style: {
        background: node.style?.background ?? '#ffffff',
        color: node.style?.color ?? '#111111',
        fontSize: node.style?.fontSize ?? 14,
        fontWeight: node.style?.fontWeight,
        borderRadius: node.style?.borderRadius,
      },
    }
  }
  if (node.type === 'input') {
    return {
      ...base,
      type: 'input',
      content: node.content ?? '',
      style: {
        background: node.style?.background ?? node.style?.fill ?? '#ffffff',
        color: node.style?.color ?? '#111111',
        fontSize: node.style?.fontSize ?? 14,
        fontWeight: node.style?.fontWeight,
        borderRadius: node.style?.borderRadius,
        borderColor: node.style?.stroke,
        borderWidth: node.style?.strokeWidth,
      },
    }
  }
  if (node.type === 'image') {
    return {
      ...base,
      type: 'image',
      src: node.asset?.source ?? '',
      objectFit: node.asset?.fit,
      objectPosition: node.asset?.position,
      borderRadius: node.style?.borderRadius,
    }
  }
  if (node.type === 'shape') {
    return {
      ...base,
      type: 'shape',
      shape: node.style?.shape ?? 'rect',
      fill: node.style?.fill ?? 'transparent',
      stroke: node.style?.stroke,
      strokeWidth: node.style?.strokeWidth,
      borderRadius: node.style?.borderRadius,
    }
  }
  if (node.metadata?.canvasType === 'runtime-placeholder') {
    return {
      ...base,
      type: 'runtime-placeholder',
      label: node.metadata.label ?? node.name,
      preview: node.metadata.preview,
      textColor: node.metadata.textColor,
    }
  }
  return {
    ...base,
    type: 'section',
    label: node.metadata?.label ?? node.name,
    autoLayout: node.layout?.autoLayout,
  }
}

function toSceneNodeType(element: DesignElement): SceneNodeType {
  if (element.type === 'section') return 'frame'
  if (element.type === 'runtime-placeholder') return 'group'
  return element.type
}
