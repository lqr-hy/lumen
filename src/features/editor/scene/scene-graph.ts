import type { CornerValues, EdgeValues, ElementLayoutSizing } from '../types'

export type SceneDeliveryMode = 'editable-scene' | 'raster-composition' | 'runtime-snapshot'

export type SceneNodeType = 'frame' | 'group' | 'text' | 'shape' | 'image' | 'button' | 'input'

export interface SceneBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface SceneSource {
  adapterId: string
  sourceNodeId?: string
  confidence: number
}

export interface SceneOwnership {
  regionId: string
  role: 'structure' | 'raster' | 'snapshot'
}

export interface SceneNodeStyle {
  fill?: string
  stroke?: string
  strokeWidth?: number
  shape?: 'rect' | 'circle'
  borderRadius?: number
  cornerRadii?: CornerValues
  color?: string
  background?: string
  fontSize?: number
  fontWeight?: number
  lineHeight?: number
  textAlign?: 'left' | 'center' | 'right'
  fontFamily?: string
  overflow?: 'visible' | 'hidden' | 'ellipsis'
  shadow?: { x: number; y: number; blur: number; spread?: number; color: string }
}

export interface SceneNodeLayout {
  sizing?: ElementLayoutSizing
  constraints?: {
    horizontal: 'left' | 'right' | 'center' | 'stretch'
    vertical: 'top' | 'bottom' | 'center' | 'stretch'
  }
  autoLayout?: {
    direction: 'vertical' | 'horizontal'
    gap: number
    padding: EdgeValues
    align: 'start' | 'center' | 'end'
    justify: 'start' | 'center' | 'end' | 'space-between'
  }
}

export interface SceneNode {
  id: string
  type: SceneNodeType
  parentId?: string
  name: string
  bounds: SceneBounds
  zIndex: number
  content?: string
  asset?: {
    source: string
    fit?: 'cover' | 'contain' | 'fill'
    position?: string
  }
  style?: SceneNodeStyle
  layout?: SceneNodeLayout
  visible?: boolean
  locked?: boolean
  rotation?: number
  flipX?: boolean
  flipY?: boolean
  opacity?: number
  clipContent?: boolean
  source: SceneSource
  ownership: SceneOwnership
  bindings?: Record<string, unknown>
  metadata?: {
    artboardId?: string
    canvasType?: 'section' | 'runtime-placeholder'
    label?: string
    preview?: { variant: 'cards' | 'list' | 'plain'; items: string[] }
    textColor?: string
    designRole?: 'page-shell' | 'container' | 'design-block' | 'component-decoration'
    designBlockId?: string
  }
}

export interface SceneDiagnostic {
  code: string
  severity: 'warning' | 'error'
  message: string
  nodeId?: string
  relatedNodeIds?: string[]
}

export interface SceneGraph {
  version: 1
  id: string
  rootNodeId: string
  mode: SceneDeliveryMode
  surface: {
    kind: 'mobile' | 'desktop-web' | 'desktop-admin' | 'custom'
    width: number
    height: number
    originX?: number
    originY?: number
  }
  nodes: SceneNode[]
  tokens?: Record<string, unknown>
  diagnostics?: SceneDiagnostic[]
}

export interface SceneCommit {
  graphId: string
  rootNodeId: string
  elements: import('../types').DesignElement[]
  contentHeight: number
  sourceAdapterId: string
  diagnostics: SceneDiagnostic[]
}

export interface SceneTransactionCommit extends SceneCommit {
  transactionId: string
  kind: 'replace' | 'merge-regions'
  nextElements: import('../types').DesignElement[]
  affectedElementIds: string[]
  affectedRegionIds: string[]
  removedRegionIds: string[]
  blockRootIds: Record<string, string>
}
