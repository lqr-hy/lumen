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
  visualBriefTemplates?: Array<{
    id: string
    name: string
    brief: import('./utils/visual-brief').VisualRedesignBrief
  }>
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
  variantParentArtboardId?: string
  variantStatus?: 'candidate' | 'reviewing' | 'blocked' | 'accepted' | 'archived'
  variantLabel?: string
  variantCreatedAt?: string
  visualOptimizationBrief?: import('./utils/visual-brief').VisualRedesignBrief
  generationMeta?: GenerationMeta
  pageDesign?: PageDesignMeta
  designSpec?: DesignSpec
  designBreakpointId?: DesignBreakpointId
  responsiveBaselines?: Record<string, ResponsiveVisualBaseline>
  runtimeScene?: {
    graphId: string
    sourceAdapterId: string
    nodeCount: number
  }
  /** @deprecated 使用 designSpec。 */
  genericUiSchema?: GenericUiSchema
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

export type DesignSurfaceKind = 'desktop-admin' | 'desktop-web' | 'mobile'
export type BuiltinDesignBreakpointId = 'mobile' | 'tablet' | 'desktop'
export type DesignBreakpointId = BuiltinDesignBreakpointId | (string & {})

export interface DesignBreakpoint {
  id: DesignBreakpointId
  label: string
  viewport: { width: number; height: number }
  minWidth?: number
  maxWidth?: number
  overrides?: DesignBreakpointOverrides
}

export interface DesignBreakpointOverrides {
  theme?: Partial<DesignSpec['theme']>
  layout?: Partial<DesignSpecLayout>
}

export interface DesignSpecLayout {
  contentPadding?: number
  blockGap?: number
  sidebarMode?: 'auto' | 'expanded' | 'collapsed'
  hiddenBlockIds?: string[]
  blockColumns?: Record<string, number>
}

export interface ResponsiveVisualBaseline {
  breakpointId: DesignBreakpointId
  fingerprint: string
  documentRevision: number
  capturedAt: string
  viewport: { width: number; height: number }
  elementCount: number
}

export interface ResponsiveTokenBatchPatch {
  primaryColor?: string
  radius?: number
  density?: 'compact' | 'comfortable'
  contentPadding?: number
  blockGap?: number
  sidebarMode?: 'auto' | 'expanded' | 'collapsed'
}

export interface DesignBlock {
  id: string
  kind:
    | 'container'
    | 'stack'
    | 'grid'
    | 'hero'
    | 'text'
    | 'image'
    | 'button-group'
    | 'divider'
    | 'spacer'
    | 'sidebar'
    | 'header'
    | 'section-header'
    | 'tabs'
    | 'stats'
    | 'filter-bar'
    | 'data-table'
    | 'form'
    | 'content-grid'
    | 'chart'
    | 'tree'
    | 'detail-panel'
    | 'timeline'
    | 'kanban'
    | 'calendar'
    | 'map'
    | 'modal'
    | 'drawer'
    | 'toast'
    | 'pagination'
    | 'footer'
    | (string & {})
  label: string
  title?: string
  items: string[]
  fields: string[]
  actions: string[]
  columns: string[]
  rows: string[][]
  children?: DesignBlock[]
  media?: { src?: string; alt?: string }
  layout?: {
    direction?: 'horizontal' | 'vertical'
    columns?: number
    gap?: number
    padding?: number
    height?: number
  }
}

export interface DesignSpec {
  version: 1
  surfaceKind: DesignSurfaceKind
  title: string
  designArchetype?: string
  viewport: { width: number; height: number }
  theme: {
    mode: 'light' | 'dark'
    colors: string[]
    radius: number
    density: 'compact' | 'comfortable'
  }
  layout?: DesignSpecLayout
  blocks: DesignBlock[]
  responsive?: {
    strategy: 'fluid'
    breakpoints: DesignBreakpoint[]
  }
}

/** @deprecated 使用 DesignSurfaceKind。 */
export type GenericUiSurfaceKind = DesignSurfaceKind
/** @deprecated 使用 DesignBlock。 */
export type GenericUiBlock = DesignBlock
/** @deprecated 使用 DesignSpec。 */
export type GenericUiSchema = DesignSpec

export interface GenerationBrief {
  version: 1
  goal: string
  outputKind: 'full-image' | 'section' | 'asset'
  target: { width: number; height: number; placementMode: string }
  references: Array<{
    id: string
    name: string
    role: 'kv' | 'prototype' | 'visual' | 'edit-base' | 'unknown'
    responsibility: 'visual-theme' | 'structure' | 'edit-base' | 'visual-reference'
  }>
  constraints: string[]
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
  generationBrief?: GenerationBrief
  /** @deprecated 普通图片生成改用 generationBrief，仅用于旧项目。 */
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
    exactText?: string
    parentId?: string
    assetSource?: string
    bounds: { x: number; y: number; width: number; height: number }
    slotId?: string
    repeaterPath?: string
    repeatIndex?: number
    templateId?: string
    propBindings: string[]
    renderMode: 'runtime' | 'text' | 'color' | 'button' | 'generated-asset'
    designOnly?: boolean
    confidence: number
    visible?: boolean
    styleRole?: 'heading' | 'body' | 'caption' | 'button'
    textAlign?: 'left' | 'center' | 'right'
    style?: Record<string, unknown>
    preview?: {
      variant: 'cards' | 'list' | 'plain'
      items: string[]
    }
  }>
  propertyValues: Record<string, unknown>
  diagnostics: Array<{ code?: string; path?: string; message: string }>
}

export interface ComponentDesignTreeNode {
  id: string
  type: string
  role: string
  parentId?: string
  slotId?: string
  repeaterPath?: string
  repeatIndex?: number
  templateId?: string
  bounds: { x: number; y: number; width: number; height: number }
  content?: string
  assetSource?: string
  propPath?: string
  bindingStatus: 'bound' | 'visual-only' | 'unresolved'
  source: 'contract' | 'thumbnail-vision' | 'runtime-inspect' | 'merged'
  confidence: number
  editable?: boolean
  visible?: boolean
  style?: Record<string, unknown>
}

export interface ComponentDesignTree {
  version: 1
  componentName: string
  width: number
  height: number
  nodes: ComponentDesignTreeNode[]
  diagnostics?: Array<{ code?: string; path?: string; message: string }>
}

export interface VisualThemeContract {
  source: 'kv' | 'visual' | 'prompt' | 'thumbnail' | 'style-pack'
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
  evidence?: {
    method: string
    referenceName?: string
    colors: string[]
    modelAffinity: number
    calibrated: boolean
  }
}

export interface DesignQualityReview {
  evalVersion?: 1
  passed: boolean
  deliveryStatus?: DeliveryStatus
  overall?: number
  dimensions?: {
    themeAlignment: number
    layoutCompleteness: number
    componentIntegrity: number
    editableCoverage: number
    readability: number
  }
  thresholds?: Record<string, number>
  scores: {
    structure: number
    theme: number
    readability: number
    completeness: number
    developmentReadiness: number
    editableCoverage?: number
  }
  issues: Array<{
    code: string
    severity: 'error' | 'warning'
    scope: 'page' | 'component' | 'asset' | 'props' | 'runtime'
    targetId?: string
    message: string
    repairAction?: string
    metric?: string
  }>
  repairPlan?: Array<{
    kind: string
    targetId?: string
    issueCodes: string[]
    reason: string
    action?: string
    automatic: boolean
  }>
  repairCount: number
}

export type DeliveryStatus = 'design-ready' | 'runtime-verified' | 'diagnostic-only' | 'blocked'

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
    component?: {
      componentName: string
      profile?: string
      reference?: { packId: string; componentName: string; label?: string }
    }
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
  deliveryMode?: 'editable-scene' | 'raster-component' | 'hybrid-component'
  instanceId?: string
  packId?: string
  componentName: string
  profile: string
  sourceHash: string
  sourceFormat?: 'json-schema'
  schemaVersion?: string
  repeaters?: Array<{
    path: string
    role: string
    itemRole: string
    controller?: string
    minItems?: number
    maxItems?: number
  }>
  blueprint: ComponentBlueprint
  designTree?: ComponentDesignTree
  sourceSceneGraph?: import('./scene/scene-graph').SceneGraph
  assetTasks: Array<{
    id: string
    slotId: string
    label: string
    propPath?: string
    fallbackPath?: string
    role: string
    targetSize: { width: number; height: number }
    transparent: boolean
    exactText?: string
    designOnly?: boolean
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
  repeaterPath?: string
  repeatIndex?: number
  templateId?: string
  renderMode: 'root' | 'shell' | 'runtime' | 'text' | 'color' | 'button' | 'generated-asset'
  rootElementId: string
  pageSectionId?: string
  propPaths: string[]
  bindings: Partial<Record<'width' | 'height' | 'x' | 'y' | 'color' | 'image' | 'visible', string>>
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
  | InputElement
  | SectionElement
  | RuntimePlaceholderElement

export type ElementSizeMode = 'fixed' | 'hug' | 'fill'

export interface ElementLayoutSizing {
  widthMode: ElementSizeMode
  heightMode: ElementSizeMode
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
}

export interface EdgeValues {
  top: number
  right: number
  bottom: number
  left: number
}

export interface CornerValues {
  topLeft: number
  topRight: number
  bottomRight: number
  bottomLeft: number
}

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
  layoutSizing?: ElementLayoutSizing
  cornerRadii?: CornerValues
  rotation?: number
  flipX?: boolean
  flipY?: boolean
  opacity?: number
  locked?: boolean
  visible?: boolean
  zIndex: number
  componentBinding?: ComponentBinding
  designRole?: 'page-shell' | 'container' | 'design-block' | 'component-decoration'
  designBlockId?: string
  layoutConstraints?: {
    horizontal: 'left' | 'right' | 'center' | 'stretch'
    vertical: 'top' | 'bottom' | 'center' | 'stretch'
  }
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

export interface InputElement extends BaseElement {
  type: 'input'
  content: string
  style: {
    background: string
    color: string
    fontSize: number
    fontWeight?: number
    borderRadius?: number
    borderColor?: string
    borderWidth?: number
  }
}

export interface SectionElement extends BaseElement {
  type: 'section'
  label: string
  autoLayout?: {
    direction: 'vertical' | 'horizontal'
    gap: number
    padding: EdgeValues
    align: 'start' | 'center' | 'end'
    justify: 'start' | 'center' | 'end' | 'space-between'
  }
}

export interface RuntimePlaceholderElement extends BaseElement {
  type: 'runtime-placeholder'
  label: string
  preview?: {
    variant: 'cards' | 'list' | 'plain'
    items: string[]
  }
  textColor?: string
}

export type EditorTool = 'select' | 'hand' | 'text' | 'shape' | 'image' | 'slice'
