import type {
  ComponentDesignMeta,
  DesignDocument,
  GenerationMeta,
  PageDesignMeta,
} from '../editor/types'
import type { PromptTextReference } from '../../components/ui/PromptComposer'
import type { PlacementMode } from '../editor/utils/placement-intent'

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
}

export interface ChatEditRequest {
  sessionId?: string
  provider?: string
  model?: string
  imageProvider?: string
  imageModel?: string
  skillNames?: string[]
  prompt: string
  document: DesignDocument
  history?: ChatHistoryMessage[]
  referenceImages?: string[]
  referenceImageNames?: string[]
  textReferences?: PromptTextReference[]
  selectedElementIds?: string[]
  canvasTarget?: {
    artboardId: string
    createdForThread: boolean
    width: number
    height: number
    autoHeight?: boolean
    placementMode?: Exclude<PlacementMode, 'auto'>
    placementSource?: 'prompt' | 'control' | 'default'
  }
  editScope?: ComponentEditScope
  blueprintOverride?: import('../editor/types').PageCompositionBlueprint
  enableVisionReview?: boolean
}

export interface ChatEditCallbacks {
  onToken?: (token: string) => void
  onAgentEvent?: (event: AgentEvent) => void
  onDeliverable?: (
    deliverable: IncrementalCanvasDeliverable,
  ) => Promise<CanvasWriteObservation> | CanvasWriteObservation
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
    elements?: Array<{
      id: string
      type: string
      name?: string
      designRole?: string
      parentId?: string
      componentName?: string
      instanceId?: string
      pageSectionId?: string
      renderMode?: string
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

export type IncrementalCanvasDeliverable =
  | IncrementalPageComponentDeliverable
  | IncrementalPageShellDeliverable

export interface AgentEvent {
  type: string
  sessionId: string
  status?: string
  step?: { id: string; title: string; tool: string; status: string; error?: string }
  decision?: {
    mode: string
    tool?: string
    stepId?: string
    confidence?: number
    reason?: string
    source?: string
  }
  observation?: {
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
  kind: 'text' | 'image' | 'component' | 'component-slot' | 'page-shell' | 'page' | 'confirmation'
  document: DesignDocument
  message: string
  source: 'copilot' | 'runtime'
  image?: GeneratedCanvasImage
  images?: GeneratedCanvasImage[]
  visualShell?: GeneratedCanvasImage
  componentDesign?: ComponentDesignMeta
  editScope?: ComponentEditScope
  pageDesign?: PageDesignMeta
  pageComponents?: GeneratedPageComponent[]
  pageShell?: GeneratedCanvasImage
  confirmation?: BlueprintConfirmation
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
  visualShell?: GeneratedCanvasImage
}

export type ComponentEditScope = ComponentRegionEditScope | ComponentInstanceEditScope | PageShellEditScope

export interface PageShellEditScope {
  type: 'page-shell'
  elementId: string
  artboardId: string
  targetSize: { width: number; height: number }
  currentImage?: string
}

export interface ComponentRegionEditScope {
  type: 'component-region'
  elementId: string
  instanceId: string
  componentName: string
  profile: string
  regionId: string
  slotId: string
  propPath: string
  fallbackPath?: string
  targetSize: { width: number; height: number }
  exactText?: string
  currentImage?: string
}

export interface ComponentInstanceEditScope {
  type: 'component-instance'
  elementId: string
  instanceId: string
  componentName: string
  profile: string
  pageSectionId?: string
  locked?: boolean
}
