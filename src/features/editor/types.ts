export interface Point {
  x: number
  y: number
}

export interface ViewportState {
  x: number
  y: number
  zoom: number
}

export interface DesignDocument {
  id: string
  title: string
  version: number
  viewport?: ViewportState
  settings?: ProjectSettings
  artboards: Artboard[]
  elements: DesignElement[]
  assets: DesignAsset[]
  componentInstances?: Record<string, ComponentInstance>
  structuralInstances?: Record<string, StructuralInstance>
  createdAt: string
  updatedAt: string
}

export interface ProjectSettings {
  globalPrompt?: string
  canvasMode?: 'light' | 'dark' | 'system-light'
  gridVisible?: boolean
}

export interface Artboard {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  background: string
  borderRadius?: number
  overflow?: 'visible' | 'hidden'
  autoHeight?: boolean
  generationMeta?: GenerationMeta
  pageDesign?: PageDesignMeta
  /** @deprecated 仅用于加载旧项目，组件元数据已迁移到 DesignDocument.componentInstances。 */
  componentDesign?: ComponentDesignMeta
  /** @deprecated 仅用于加载旧项目，组件元数据已迁移到 DesignDocument.componentInstances。 */
  componentDesigns?: ComponentDesignMeta[]
}

export interface ComponentInstance {
  id: string
  artboardId: string
  rootElementId: string
  componentName: string
  profile: string
  design: ComponentDesignMeta
}

export interface StructuralInstance {
  id: string
  artboardId: string
  rootElementId: string
  componentName: string
  nodeType: 'page-root' | 'container'
  designPaths: string[]
  propsPatch: Record<string, unknown>
}

export interface DesignBlueprint {
  version: 1
  mode: 'new-artboard' | 'append-section' | 'duplicate-variant' | 'asset-board'
  canvas: { width: number; estimatedHeight: number }
  theme: { colors: string[]; visualStyle: string; typography?: string[] }
  sections: Array<{
    id: string
    type: string
    purpose: string
    estimatedHeight: number
    source: 'prototype' | 'prompt' | 'existing-canvas'
  }>
  constraints: {
    prototypeIsStructureSource: boolean
    forbiddenAdditions: string[]
  }
}

export interface ArtifactQualityReview {
  passed: boolean
  issues: Array<{
    code: string
    message: string
    severity: 'error' | 'warning'
  }>
  metrics: {
    width: number
    height: number
    visibleNodeCount: number
    textNodeCount: number
    byteLength: number
  }
}

export interface GenerationMeta {
  sessionId: string
  prompt: string
  provider: string
  model: string
  placementMode: 'new-artboard' | 'append-section' | 'duplicate-variant' | 'asset-board'
  parentArtboardId?: string
  createdAt: string
  refined: boolean
  blueprint?: DesignBlueprint
  qualityReview?: ArtifactQualityReview
}

export interface ComponentBlueprint {
  version: 1
  componentName: string
  profile: string
  width: number
  height: number
  visualTheme?: VisualThemeContract
  regions: Array<{
    id: string
    role: string
    content?: string
    bounds: { x: number; y: number; width: number; height: number }
    slotId?: string
    propBindings: string[]
    renderMode: 'runtime' | 'text' | 'color' | 'generated-asset'
    confidence: number
  }>
  propertyValues: Record<string, unknown>
  diagnostics: Array<{ code?: string; path?: string; message: string }>
}

export interface VisualThemeContract {
  source: 'kv' | 'visual' | 'prompt' | 'thumbnail'
  referenceImageIndex?: number
  colors: string[]
  colorTokens?: Array<{
    role: 'primary' | 'secondary' | 'background' | 'surface' | 'text' | 'accent'
    value: string
  }>
  typography?: Array<{
    role: 'display' | 'heading' | 'body' | 'caption' | 'button'
    family?: string
    weight: number
    size?: number
    lineHeight?: number
  }>
  surfaces?: Array<{
    role: string
    fill: string
    radius: number
    border?: string
  }>
  effects?: Array<{
    type: 'shadow' | 'glow' | 'gradient' | 'texture'
    value: string
  }>
  imagery?: { style: string; rendering: string; keywords: string[] }
  decoration?: {
    language: string
    motifs: string[]
    density: 'low' | 'medium' | 'high'
  }
  spacing?: {
    base: number
    scale: number[]
    density: 'compact' | 'comfortable' | 'spacious'
  }
  visualStyle: string
  confidence?: number
}

export interface DesignQualityReview {
  passed: boolean
  deliveryStatus?: DeliveryStatus
  scores: {
    structure: number
    theme: number
    readability: number
    completeness: number
    developmentReadiness: number
  }
  issues: Array<{
    code: string
    severity: 'error' | 'warning'
    scope: 'page' | 'component' | 'asset' | 'props' | 'runtime'
    targetId?: string
    message: string
    repairAction?: string
  }>
  repairCount: number
}

export type DeliveryStatus =
  | 'design-ready'
  | 'runtime-verified'
  | 'diagnostic-only'
  | 'blocked'

export interface PageCompositionBlueprint {
  version: 1
  width: 375
  estimatedHeight: number
  visualTheme?: VisualThemeContract
  pageRoot?: {
    componentName: string
    fileName?: string
    designPaths?: string[]
  }
  containers?: Array<{
    componentName: string
    fileName?: string
    designPaths?: string[]
    bounds?: { x: number; y: number; width: number; height: number }
  }>
  sections: Array<{
    id: string
    role: string
    kind: 'page-content' | 'component-instance' | 'runtime-region'
    bounds: { x: number; y: number; width: number; height: number }
    source: 'prototype' | 'prompt' | 'component-thumbnail'
    component?: { componentName: string; profile?: string }
    locked?: boolean
  }>
  constraints: Array<{ type: string; from: string; to?: string; value?: number }>
}

export interface PageDesignMeta {
  blueprint: PageCompositionBlueprint
  qualityReview: DesignQualityReview
}

export interface RuntimeValidationResult {
  status: 'passed' | 'failed' | 'unsupported'
  adapterId?: string
  screenshot?: string
  consoleErrors: string[]
  unknownProps: string[]
  missingAssets: string[]
  comparison?: {
    passed: boolean
    scores: { size: number; structure: number; props: number }
    issues: string[]
  }
  message: string
}

export interface ComponentDesignMeta {
  instanceId?: string
  componentName: string
  profile: string
  sourceHash: string
  visualShell?: {
    role: 'component-shell'
    generated: boolean
  }
  blueprint: ComponentBlueprint
  assetTasks: Array<{
    id: string
    slotId: string
    label: string
    propPath: string
    fallbackPath?: string
    role: string
    targetSize: { width: number; height: number }
    transparent: boolean
    exactText?: string
  }>
  propsPatch: Record<string, unknown>
  properties?: Array<{
    path: string
    kind: 'width' | 'height' | 'x' | 'y' | 'spacing' | 'radius' | 'color' | 'visibility'
  }>
  unresolved: unknown[]
  diagnostics: Array<{ code?: string; path?: string; message: string }>
  qualityReview?: DesignQualityReview
  runtimeValidation?: RuntimeValidationResult
}

export interface ComponentBinding {
  instanceId: string
  componentName: string
  profile: string
  regionId: string
  slotId?: string
  renderMode: 'root' | 'shell' | 'runtime' | 'text' | 'color' | 'generated-asset'
  rootElementId: string
  pageSectionId?: string
  propPaths: string[]
  bindings: Partial<Record<
    'width' | 'height' | 'x' | 'y' | 'color' | 'image' | 'visible',
    string
  >>
}

export interface DesignAsset {
  id: string
  type: 'image'
  name: string
  src: string
}

export type DesignElement =
  | TextElement
  | ImageElement
  | ShapeElement
  | ButtonElement
  | SectionElement
  | RuntimePlaceholderElement

export interface BaseElement {
  id: string
  artboardId?: string
  parentId?: string
  type: string
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  flipX?: boolean
  flipY?: boolean
  opacity?: number
  locked?: boolean
  visible?: boolean
  zIndex: number
  componentBinding?: ComponentBinding
  designRole?: 'page-shell' | 'container'
  shadow?: { x: number; y: number; blur: number; spread?: number; color: string }
  clipContent?: boolean
}

export interface TextElement extends BaseElement {
  type: 'text'
  content: string
  style: {
    fontSize: number
    fontWeight?: number
    color: string
    lineHeight?: number
    textAlign?: 'left' | 'center' | 'right'
    fontFamily?: string
    overflow?: 'visible' | 'hidden' | 'ellipsis'
  }
}

export interface ImageElement extends BaseElement {
  type: 'image'
  src: string
  objectFit?: 'cover' | 'contain' | 'fill'
  objectPosition?: string
  borderRadius?: number
}

export interface ShapeElement extends BaseElement {
  type: 'shape'
  shape: 'rect' | 'circle'
  fill: string
  stroke?: string
  strokeWidth?: number
  borderRadius?: number
}

export interface ButtonElement extends BaseElement {
  type: 'button'
  content: string
  style: {
    background: string
    color: string
    fontSize: number
    fontWeight?: number
    borderRadius?: number
  }
}

export interface SectionElement extends BaseElement {
  type: 'section'
  label: string
  autoLayout?: {
    direction: 'vertical' | 'horizontal'
    gap: number
    padding: number
    align: 'start' | 'center' | 'end'
  }
}

export interface RuntimePlaceholderElement extends BaseElement {
  type: 'runtime-placeholder'
  label: string
}

export type EditorTool = 'select' | 'hand' | 'text' | 'shape' | 'image' | 'slice'
