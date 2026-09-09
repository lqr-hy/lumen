import type {
  ComponentDesignMeta,
  DesignDocument,
  GenerationMeta,
  PageDesignMeta,
  VisualThemeContract,
} from '../editor/types'
import type { PromptTextReference } from '../../components/ui/PromptComposer'
import type { PlacementMode } from '../editor/utils/placement-intent'
import type { ComposerMention } from './composer-draft'

export interface ComponentReference {
  packId: string
  componentName: string
  label?: string
}

export interface RuntimeModelSelection {
  provider: string
  model: string
}

export type ResolvedReferenceImageRole = 'content' | 'kv' | 'prototype' | 'visual' | 'edit-base'

export type ReferenceImageRole = 'auto' | ResolvedReferenceImageRole

export interface GenerateRequest {
  prompt: string
  type: 'landing-page' | 'poster' | 'banner' | 'social-cover'
  size: { width: number; height: number }
  style?: string
  industry?: string
  referenceImages?: string[]
}

export interface GenerateResult {
  projectId: string
  document: DesignDocument
}

export interface ChatHistoryMessage {
  role: 'user' | 'agent'
  text: string
  referenceImages?: Array<{ name: string; src: string }>
  componentReferences?: ComponentReference[]
}

export interface ChatEditRequest {
  sessionId?: string
  provider?: string
  model?: string
  imageProvider?: string
  imageModel?: string
  skillNames?: string[]
  stylePackId?: string
  prompt: string
  document: DesignDocument
  history?: ChatHistoryMessage[]
  mentions?: ComposerMention[]
  componentReferences?: ComponentReference[]
  referenceImages?: string[]
  referenceImageNames?: string[]
  referenceImageRoles?: ReferenceImageRole[]
  textReferences?: PromptTextReference[]
  selectedElementIds?: string[]
  activeArtboardId?: string
  selectedArtboardId?: string
  canvasTarget?: {
    artboardId: string
    createdForThread: boolean
    width: number
    height: number
    autoHeight?: boolean
    placementMode?: Exclude<PlacementMode, 'auto'>
    placementSource?: 'prompt' | 'selection' | 'thread' | 'override' | 'default'
    operationId?: string
    leaseId?: string
    documentRevision?: number
  }
  editScope?: SelectionScope
  componentRegionAction?: {
    kind: 'regenerate-component-regions'
    targets: ComponentRegionEditScope[]
  }
  blueprintOverride?: import('../editor/types').PageCompositionBlueprint
  /** 视觉优化 Brief 的结构化快照，供 Runtime 在生成 Variant 时读取。 */
  visualBrief?: import('../editor/utils/visual-brief').VisualRedesignBrief
  /** 视觉优化的结构化资产计划；由入口生成，Runtime 不再仅依赖自然语言推断。 */
  visualAssetPlan?: import('../editor/utils/visual-brief').VisualAssetPlan
  /** 区分空白创建与基于原画板生成 Variant，避免仅凭当前选中画板猜测放置方式。 */
  visualOptimizationContext?: {
    mode: 'new-design' | 'variant'
    sourceArtboardId?: string
  }
  enableVisionReview?: boolean
}

export type CanvasPlacementOperation =
  'create' | 'insert' | 'revise' | 'variant' | 'assets' | 'resume'

export type CanvasPlacementScope = 'document' | 'artboard' | 'selection' | 'asset-board'

export interface CanvasPlacementDecision {
  operation: CanvasPlacementOperation
  scope: CanvasPlacementScope
  targetArtboardId?: string
  targetElementIds?: string[]
  reason: string
  confidence: number
}

export interface CanvasContext {
  documentRevision: number
  activeArtboardId?: string
  selectedArtboardId?: string
  selectedElementIds: string[]
  artboards: Array<{
    id: string
    name: string
    width: number
    height: number
    empty: boolean
    hasDesignSpec: boolean
  }>
}

export interface ChatEditCallbacks {
  onToken?: (token: string) => void
  onAgentEvent?: (event: AgentEvent) => void
  onDeliverable?: (
    deliverable: IncrementalCanvasDeliverable,
  ) => Promise<CanvasWriteObservation> | CanvasWriteObservation
  onCanvasTargetRequest?: (
    request: CanvasTargetRequest,
  ) => Promise<CanvasTargetResolution> | CanvasTargetResolution
  onCanvasSnapshotRequest?: (
    request: CanvasSnapshotRequest,
  ) => Promise<CanvasSnapshotResolution> | CanvasSnapshotResolution
}

export interface CanvasSnapshotRequest {
  id: string
  sessionId: string
  runId: string
  artboardId: string
  purpose: 'vision-review'
  scale: 1 | 2
}

export interface CanvasSnapshotResolution {
  status: 'ready' | 'failed'
  snapshot?: { data: string; mime: 'image/png'; width: number; height: number }
  reason?: string
  errorCode?: string
}

export interface CanvasTargetRequest {
  id: string
  turnId: string
  sessionId: string
  projectId?: string
  action: string
  taskKind?: string
  operationId: string
  placement: CanvasPlacementDecision
  preferredArtboardId?: string
  editScope?: SelectionScope
  baseDocumentRevision: number
  logicalSize: { width: number; initialHeight: number; autoHeight: boolean }
}

export interface CanvasTargetResolution {
  status: 'ready' | 'failed'
  target?: NonNullable<ChatEditRequest['canvasTarget']>
  summary?: string
  reason?: string
  errorCode?: string
}

export interface CanvasWriteObservation {
  status: 'success' | 'failed'
  summary: string
  errorCode?: string
  data?: {
    artboardId?: string
    rootElementId?: string
    instanceId?: string
    pageSectionId?: string
    elementCount?: number
    shellElementId?: string
    hasPageShell?: boolean
    componentCount?: number
    documentRevision?: number
    sectionId?: string
    sectionIndex?: number
    deliveredSectionCount?: number
    failedSectionCount?: number
    editableNodeCount?: number
    sourceAdapterId?: string
    replacedArtboard?: boolean
    artboardWidth?: number
    artboardHeight?: number
    blockRootElementId?: string
    affectedElementIds?: string[]
    qualityReport?: import('../editor/utils/visual-quality-gate').DesignGateReport
    affectedBlockIds?: string[]
    removedBlockIds?: string[]
    designSpec?: import('../editor/types').DesignSpec
    rebasedFromRevision?: number
    rebasedToRevision?: number
    designSpecConflicts?: import('../editor/utils/design-spec-patch').DesignSpecConflict[]
    designSpecConflictResolution?: {
      artboardId: string
      currentRevision: number
      patch: DesignSpecPatch
      conflicts: import('../editor/utils/design-spec-patch').DesignSpecConflict[]
    }
    elements?: Array<{
      id: string
      type: string
      name?: string
      designRole?: string
      designBlockId?: string
      parentId?: string
      componentName?: string
      instanceId?: string
      pageSectionId?: string
      renderMode?: string
      componentImageBinding?: boolean
      bounds: { x: number; y: number; width: number; height: number }
    }>
  }
}

export interface IncrementalPageComponentDeliverable {
  id: string
  kind: 'page-component'
  sessionId: string
  runId: string
  stepId: string
  target?: ChatEditRequest['canvasTarget']
  component: GeneratedPageComponent
}

export interface IncrementalPageShellDeliverable {
  id: string
  kind: 'page-shell'
  sessionId: string
  runId: string
  stepId: string
  target?: ChatEditRequest['canvasTarget']
  blueprint: PageDesignMeta['blueprint']
  pageShell: GeneratedCanvasImage
}

export interface ImageCanvasDeliverable {
  id: string
  kind: 'image'
  sessionId: string
  runId: string
  stepId: string
  target?: ChatEditRequest['canvasTarget']
  images: GeneratedCanvasImage[]
}

export interface AssetSetCanvasDeliverable extends Omit<ImageCanvasDeliverable, 'kind'> {
  kind: 'asset-set'
}

export interface ComponentCanvasDeliverable {
  id: string
  kind: 'component'
  sessionId: string
  runId: string
  stepId: string
  target?: ChatEditRequest['canvasTarget']
  componentDesign: ComponentDesignMeta
  images: GeneratedCanvasImage[]
  editScope?: SelectionScope
}

export interface ComponentSlotCanvasDeliverable {
  id: string
  kind: 'component-slot'
  sessionId: string
  runId: string
  stepId: string
  target?: ChatEditRequest['canvasTarget']
  image: GeneratedCanvasImage
  editScope: SelectionScope
}

export interface ComponentSlotBatchCanvasDeliverable {
  id: string
  kind: 'component-slot-batch'
  sessionId: string
  runId: string
  stepId: string
  target?: ChatEditRequest['canvasTarget']
  items: Array<{
    image: GeneratedCanvasImage
    editScope: ComponentRegionEditScope
  }>
  editScope: ComponentRegionBatchEditScope
}

export interface PageShellEditCanvasDeliverable extends Omit<
  ComponentSlotCanvasDeliverable,
  'kind'
> {
  kind: 'page-shell-edit'
}

export interface GenericUiCanvasDeliverable {
  id: string
  kind: 'generic-ui'
  sessionId: string
  runId: string
  stepId: string
  target?: ChatEditRequest['canvasTarget']
  uiSchema: import('../editor/types').GenericUiSchema
}

export interface GenericUiSectionCanvasDeliverable extends Omit<
  GenericUiCanvasDeliverable,
  'kind'
> {
  kind: 'generic-ui-section'
  section: { index: number; id: string; kind: string; label: string }
  deliveredBlockIds: string[]
}

export interface GenericUiFinalizeCanvasDeliverable extends Omit<
  GenericUiCanvasDeliverable,
  'kind'
> {
  kind: 'generic-ui-finalize'
  expectedBlockIds: string[]
  failedSectionIndexes: number[]
}

export interface GenericUiRuntimeCanvasDeliverable {
  id: string
  kind: 'generic-ui-runtime'
  sessionId: string
  runId: string
  stepId: string
  target?: ChatEditRequest['canvasTarget']
  sceneGraph: import('../editor/scene/scene-graph').SceneGraph
  runtimeDraft?: { version: 1; title: string; viewport: { width: number; height: number } }
  expectedNodeCount: number
  visualAssetReport?: {
    version: 1
    imagery: string
    plannedCount: number
    generatedCount: number
    boundCount: number
    targetViewport: { width: number; height: number }
    assets: Array<{ id: string; nodeId: string; targetSize: { width: number; height: number } }>
  }
}

export interface DesignPatchCanvasDeliverable {
  id: string
  kind: 'design-patch'
  sessionId: string
  runId: string
  stepId: string
  target?: ChatEditRequest['canvasTarget']
  patch: DesignPatch
  images: Record<string, GeneratedCanvasImage>
}

export interface DesignSpecPatchCanvasDeliverable {
  id: string
  kind: 'design-spec-patch'
  sessionId: string
  runId: string
  stepId: string
  target?: ChatEditRequest['canvasTarget']
  patch: DesignSpecPatch
  baseDesignSpec: import('../editor/types').DesignSpec
  nextDesignSpec: import('../editor/types').DesignSpec
}

export interface PageFinalizeCanvasDeliverable {
  id: string
  kind: 'page-finalize'
  sessionId: string
  runId: string
  stepId: string
  target?: ChatEditRequest['canvasTarget']
  blueprint: PageDesignMeta['blueprint']
  expectedComponentCount: number
  expectedPageSectionIds: string[]
}

export type IncrementalCanvasDeliverable =
  | IncrementalPageComponentDeliverable
  | IncrementalPageShellDeliverable
  | ImageCanvasDeliverable
  | AssetSetCanvasDeliverable
  | ComponentCanvasDeliverable
  | ComponentSlotCanvasDeliverable
  | ComponentSlotBatchCanvasDeliverable
  | PageShellEditCanvasDeliverable
  | GenericUiCanvasDeliverable
  | GenericUiSectionCanvasDeliverable
  | GenericUiFinalizeCanvasDeliverable
  | GenericUiRuntimeCanvasDeliverable
  | DesignPatchCanvasDeliverable
  | DesignSpecPatchCanvasDeliverable
  | PageFinalizeCanvasDeliverable

export interface AgentEvent {
  version?: 1
  type: string
  sessionId: string
  runId?: string
  sequence?: number
  timestamp?: number
  status?: string
  steps?: Array<{
    id: string
    title: string
    tool: string
    status: string
    error?: string
    startedAt?: string
    completedAt?: string
    partialFailure?: boolean
    partialSummary?: string
  }>
  step?: {
    id: string
    title: string
    tool: string
    status: string
    error?: string
    attempt?: number
    startedAt?: string
    completedAt?: string
    partialFailure?: boolean
    partialSummary?: string
  }
  attempt?: number
  stepId?: string
  trace?: {
    id: string
    stage: string
    tool: string
    operation?: string
    taskId?: string
    slotId?: string
    label?: string
    status: 'started' | 'retrying' | 'completed' | 'fallback' | 'failed'
    attempt?: number
    maxAttempts?: number
    elapsedMs?: number
    targetSize?: { width: number; height: number }
    errorCode?: string
    message: string
    timestamp: number
  }
  decision?: {
    mode: string
    tool?: string
    stepId?: string
    confidence?: number
    reason?: string
    source?: string
  }
  observation?: {
    stepId?: string
    tool: string
    status: string
    summary: string
    errorCode?: string
    retryable?: boolean
  }
  error?: string
}

export type RuntimeImageArtifact =
  | { kind: 'svg'; content: string; name?: string }
  | {
      kind: 'raster'
      content: string
      mime: 'image/png' | 'image/jpeg' | 'image/webp'
      width: number
      height: number
      name?: string
      analysis?: RasterAnalysis
    }

export interface RasterAnalysis {
  width?: number
  height?: number
  targetWidth?: number
  targetHeight?: number
  ratioError?: number
  contentRatioError?: number
  alphaCoverage?: number
  opaqueCoverage?: number
  transparentCoverage?: number
  translucentCoverage?: number
  whiteBackgroundCoverage?: number
  edgeTouchRate?: number
  colorComplexity?: number
  dominantColors?: string[]
  checkerboardCoverage?: number
  checkerboardScale?: number
  contentBounds?: { x: number; y: number; width: number; height: number }
  source?: RasterAnalysis
  normalized?: RasterAnalysis
  transform?: {
    mode: 'contain' | 'cover'
    sourceBounds: { x: number; y: number; width: number; height: number }
    sourceSize: { width: number; height: number }
    targetSize: { width: number; height: number }
  }
}

export interface GeneratedCanvasImage {
  src: string
  width: number
  height: number
  mime: 'image/png'
  name: string
  placement?: 'design' | 'asset'
  generationMeta?: Omit<GenerationMeta, 'parentArtboardId'>
  componentDesign?: ComponentDesignMeta
}

export interface ChatEditResult {
  kind:
    | 'text'
    | 'image'
    | 'component'
    | 'component-slot'
    | 'page-shell'
    | 'page'
    | 'generic-ui'
    | 'confirmation'
  document: DesignDocument
  message: string
  source: 'runtime'
  image?: GeneratedCanvasImage
  images?: GeneratedCanvasImage[]
  componentDesign?: ComponentDesignMeta
  editScope?: SelectionScope
  pageDesign?: PageDesignMeta
  pageComponents?: GeneratedPageComponent[]
  pageShell?: GeneratedCanvasImage
  confirmation?: BlueprintConfirmation
  genericUiSchema?: import('../editor/types').GenericUiSchema
  visualAssetReport?: GenericUiRuntimeCanvasDeliverable['visualAssetReport']
}

export interface BlueprintConfirmation {
  type: 'blueprint-confirmation'
  blueprint: import('../editor/types').PageCompositionBlueprint
  message: string
}

export interface GeneratedPageComponent {
  index?: number
  pageSectionId?: string
  bounds?: { x: number; y: number; width: number; height: number }
  componentDesign: ComponentDesignMeta
  images: GeneratedCanvasImage[]
}

export interface SelectionScopeBase {
  scopeId: string
  artboardId: string
  documentRevision: number
  targetHash: string
  targetElementIds: string[]
}

export type SelectionScope =
  | ComponentRegionEditScope
  | ComponentRegionBatchEditScope
  | ComponentInstanceEditScope
  | PageShellEditScope
  | DesignBlockEditScope
  | GenericNodeEditScope
  | MultiNodeEditScope
  | TextRangeEditScope
  | ImageRegionEditScope

export interface GenericNodeEditScope extends SelectionScopeBase {
  type: 'generic-node'
  elementId: string
  elementType: string
  name: string
  bounds: { x: number; y: number; width: number; height: number }
}

export interface DesignBlockEditScope extends SelectionScopeBase {
  type: 'design-block'
  elementId: string
  blockId: string
  name: string
  bounds: { x: number; y: number; width: number; height: number }
  imageElementIds: string[]
}

export interface MultiNodeEditScope extends SelectionScopeBase {
  type: 'multi-node'
  elementIds: string[]
  names: string[]
  bounds: { x: number; y: number; width: number; height: number }
}

export interface TextRangeEditScope extends SelectionScopeBase {
  type: 'text-range'
  elementId: string
  elementType: 'text'
  name: string
  start: number
  end: number
  selectedText: string
  prefix: string
  suffix: string
  bounds: { x: number; y: number; width: number; height: number }
}

export interface ImageRegionEditScope extends SelectionScopeBase {
  type: 'image-region'
  elementId: string
  elementType: 'image'
  name: string
  normalizedRect: { x: number; y: number; width: number; height: number }
  pixelRect: { x: number; y: number; width: number; height: number }
  targetSize: { width: number; height: number }
  currentImage: string
  maskImage: string
}

export interface DesignPatch {
  version: 1
  baseRevision: number
  artboardId: string
  scopeId?: string
  targetHash?: string
  targetElementIds?: string[]
  summary: string
  operations: Array<
    | {
        id: string
        kind: 'update'
        elementId: string
        elementType?: string
        changes: Record<string, unknown>
      }
    | {
        id: string
        kind: 'semantic-update'
        elementId: string
        semantic: {
          layout?: {
            widthMode?: import('../editor/types').ElementSizeMode
            heightMode?: import('../editor/types').ElementSizeMode
            minWidth?: number
            maxWidth?: number
            minHeight?: number
            maxHeight?: number
            horizontalConstraint?: NonNullable<
              import('../editor/types').DesignElement['layoutConstraints']
            >['horizontal']
            verticalConstraint?: NonNullable<
              import('../editor/types').DesignElement['layoutConstraints']
            >['vertical']
            gap?: number
            padding?: import('../editor/types').EdgeValues
            alignment?: string
          }
          appearance?: {
            opacity?: number
            cornerRadii?: import('../editor/types').CornerValues
          }
        }
      }
    | { id: string; kind: 'move'; elementId: string; x?: number; y?: number; parentId?: string }
    | { id: string; kind: 'delete'; elementId: string }
    | {
        id: string
        kind: 'add'
        element: Partial<import('../editor/types').DesignElement> & { id: string; type: string }
      }
    | {
        id: string
        kind: 'add-image'
        prompt: string
        element: Partial<import('../editor/types').ImageElement> & {
          id: string
          type: 'image'
          parentId: string
        }
      }
    | { id: string; kind: 'replace-image'; elementId: string; prompt: string }
    | {
        id: string
        kind: 'replace-text-range'
        elementId: string
        start: number
        end: number
        expectedText: string
        replacement: string
      }
    | {
        id: string
        kind: 'replace-image-region'
        elementId: string
        prompt: string
        normalizedRect: { x: number; y: number; width: number; height: number }
      }
  >
}

export interface DesignSpecPatch {
  version: 1
  baseRevision: number
  artboardId: string
  summary: string
  operations: Array<
    | {
        id: string
        kind: 'insert-block'
        block: import('../editor/types').DesignBlock
        beforeBlockId?: string
        afterBlockId?: string
      }
    | {
        id: string
        kind: 'update-block'
        blockId: string
        changes: Partial<Omit<import('../editor/types').DesignBlock, 'id' | 'kind'>>
      }
    | { id: string; kind: 'remove-block'; blockId: string }
    | {
        id: string
        kind: 'move-block'
        blockId: string
        beforeBlockId?: string
        afterBlockId?: string
      }
  >
}

export interface PageShellEditScope extends SelectionScopeBase {
  type: 'page-shell'
  elementId: string
  targetSize: { width: number; height: number }
  currentImage?: string
}

export interface ComponentRegionEditScope extends SelectionScopeBase {
  type: 'component-region'
  elementId: string
  instanceId: string
  componentName: string
  profile: string
  regionId: string
  repeaterPath?: string
  repeatIndex?: number
  templateId?: string
  slotId: string
  propPath: string
  fallbackPath?: string
  targetSize: { width: number; height: number }
  transparent?: boolean
  exactText?: string
  assetRole?: string
  currentImage?: string
  visualTheme?: VisualThemeContract
}

export interface ComponentRegionBatchEditScope extends SelectionScopeBase {
  type: 'component-region-batch'
  elementIds: string[]
  targets: ComponentRegionEditScope[]
}

export interface ComponentInstanceEditScope extends SelectionScopeBase {
  type: 'component-instance'
  elementId: string
  instanceId: string
  componentName: string
  profile: string
  pageSectionId?: string
  locked?: boolean
}
