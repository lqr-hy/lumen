import { create } from 'zustand'
import type {
  DesignDocument,
  DesignElement,
  Artboard,
  ComponentDesignMeta,
  EditorTool,
  GenerationMeta,
  PageDesignMeta,
  ProjectSettings,
  StructuralInstance,
  ViewportState,
} from '../types'
import {
  ARTBOARD_GAP,
  DEFAULT_CANVAS_VIEWPORT,
  DEFAULT_ARTBOARD_HEIGHT,
  DEFAULT_ARTBOARD_WIDTH,
  GENERATED_CONTENT_GAP,
} from '../constants'
import type { PlacementMode } from '../utils/placement-intent'
import type { BlueprintConfirmation } from '../../ai/types'
import type { ChatRun } from '../../ai/agent-run'
import type { ComposerMention } from '../../ai/composer-draft'
import { createComponentInstance, normalizeComponentInstances } from '../utils/component-instances'
import {
  DEFAULT_DESIGN_BREAKPOINTS,
  resolveDesignSpecBreakpoint,
} from '../utils/generic-ui-compiler'
import { applyDesignPatchToDocument, type DesignPatchApplyResult } from '../utils/design-patch'
import type { MutationLedgerEntry } from '../utils/mutation-ledger'
import { normalizeMutationLedger } from '../utils/mutation-ledger'
import { compileResponsivePreviews } from '../utils/responsive-preview'
import { compileDesignSpecToSceneCommit } from '../scene/design-spec-adapter'
import { compileDesignSpecSceneTransaction } from '../scene/design-spec-transaction'
import { compileComponentDesignToSceneCommit } from '../scene/component-design-adapter'
import { compileSceneCommit } from '../scene/scene-commit'
import {
  changeLayerOrder as changeLayerOrderInTree,
  groupLayerElements,
  moveLayerElement,
  ungroupLayerElement,
  type LayerDropPosition,
  type LayerOrderAction,
} from '../utils/layer-tree'
import { createEditorId as createStoreId } from '../utils/id'
import {
  applyElementPatches,
  applySectionAutoLayoutToElements,
  constrainElementsToArtboard,
  relayoutLayerParents,
  setNestedPatchValue,
  syncComponentInstancesFromElements,
} from '../utils/document-transforms'
import {
  bindThreadToArtboard,
  createDefaultChatThread,
  focusConversationArtboard,
  normalizePersistedChatThreads,
} from '../utils/editor-workspace'

export interface QueuedReferenceImage {
  id: string
  name: string
  src: string
  elementId?: string
  target: 'bottom' | 'panel'
}

export interface QueuedChatText {
  id: string
  text: string
  elementId?: string
  target: 'bottom' | 'panel'
  kind?: 'text' | 'component-region-regeneration'
}

export interface EditorChatImage {
  id: string
  name: string
  src: string
  elementId?: string
  role?: import('../../ai/types').ReferenceImageRole
}

export interface EditorChatTextReference {
  id: string
  text: string
  elementId?: string
  insertOffset?: number
  kind?: 'text' | 'component-region-regeneration'
}

export interface EditorTextRangeSelection {
  elementId: string
  start: number
  end: number
  selectedText: string
  prefix: string
  suffix: string
}

export interface EditorImageRegionSelection {
  elementId: string
  sourceSrc: string
  normalizedRect: { x: number; y: number; width: number; height: number }
  pixelRect: { x: number; y: number; width: number; height: number }
  targetSize: { width: number; height: number }
  currentImage: string
  maskImage: string
}

export interface EditorChatMessage {
  id: string
  role: 'user' | 'agent'
  text: string
  referenceImages?: EditorChatImage[]
  mentions?: ComposerMention[]
  pending?: boolean
  runId?: string
  confirmation?: BlueprintConfirmation
  selectionScope?: import('../../ai/types').SelectionScope
}

export interface EditorChatThread {
  id: string
  title: string
  targetArtboardId?: string
  artboardIds?: string[]
  activeTargetArtboardId?: string
  assetArtboardId?: string
  placementMode?: PlacementMode
  lastPlacementMode?: Exclude<PlacementMode, 'auto'>
  visualOptimizationDraft?: {
    mode?: 'new-design' | 'variant'
    sourceArtboardId: string
    sourceArtboardName: string
    brief: import('../utils/visual-brief').VisualRedesignBrief
  }
  prompt: string
  editorState?: string
  mentions?: ComposerMention[]
  referenceImages: EditorChatImage[]
  textReferences: EditorChatTextReference[]
  messages: EditorChatMessage[]
  runs?: Record<string, ChatRun>
}

export interface ChatArtboardTarget {
  artboardId: string
  created: boolean
  mode: Exclude<PlacementMode, 'auto'>
  parentArtboardId?: string
  /** Agent Lease 当前已确认的 DesignDocument 版本。 */
  documentRevision?: number
  leaseSnapshot?: import('../../ai/canvas-rebase').CanvasLeaseSnapshot
}

export interface GeneratedArtboardImage {
  src: string
  width: number
  height: number
  name: string
  placement?: 'design' | 'asset'
  generationMeta?: Omit<GenerationMeta, 'parentArtboardId'>
  componentDesign?: ComponentDesignMeta
}

export interface GeneratedPageComponent {
  index?: number
  pageSectionId?: string
  componentDesign: ComponentDesignMeta
  assets: GeneratedArtboardImage[]
}

export interface EditorWorkspaceSnapshot {
  document: DesignDocument
  chatThreads: EditorChatThread[]
  activeChatThreadId: string
  mutationLedger?: MutationLedgerEntry[]
}

interface EditorState {
  document: DesignDocument | null
  viewport: ViewportState
  selectedElementIds: string[]
  selectionScopeArmed: boolean
  textRangeSelection?: EditorTextRangeSelection
  imageRegionSelection?: EditorImageRegionSelection
  activeArtboardId?: string
  selectedArtboardId?: string
  tool: EditorTool
  queuedReferenceImages: QueuedReferenceImage[]
  queuedChatTexts: QueuedChatText[]
  chatThreads: EditorChatThread[]
  activeChatThreadId: string
  mutationLedger: MutationLedgerEntry[]
  history: DesignDocument[]
  future: DesignDocument[]
  propertyTransaction?: { baseline: DesignDocument }
  setDocument: (document: DesignDocument) => void
  hydrateWorkspace: (snapshot: EditorWorkspaceSnapshot) => void
  setMutationLedger: (ledger: MutationLedgerEntry[]) => void
  updateDocumentMeta: (patch: { title?: string; settings?: ProjectSettings }) => void
  setViewport: (viewport: ViewportState) => void
  addQueuedReferenceImage: (image: QueuedReferenceImage) => void
  consumeQueuedReferenceImages: (target: QueuedReferenceImage['target']) => QueuedReferenceImage[]
  addQueuedChatText: (text: QueuedChatText) => void
  consumeQueuedChatTexts: (target: QueuedChatText['target']) => QueuedChatText[]
  setActiveChatThread: (id: string) => void
  addChatThread: (thread: EditorChatThread) => void
  updateChatThread: (id: string, updater: (thread: EditorChatThread) => EditorChatThread) => void
  deleteChatThread: (id: string) => void
  appendChatMessage: (threadId: string, message: EditorChatMessage) => void
  ensureChatThreadArtboard: (
    threadId: string,
    mode?: PlacementMode,
    preferredArtboardId?: string,
    reuseEmpty?: boolean,
    logicalSize?: { width: number; initialHeight: number; autoHeight: boolean },
  ) => ChatArtboardTarget | undefined
  applyGenericUiDesign: (
    target: ChatArtboardTarget,
    schema: import('../types').GenericUiSchema,
  ) => string | undefined
  applyGenericUiRuntimeScene: (
    target: ChatArtboardTarget,
    sceneGraph: import('../scene/scene-graph').SceneGraph,
  ) =>
    | {
        rootId: string
        elementCount: number
        editableNodeCount: number
        sourceAdapterId: string
        documentRevision: number
      }
    | undefined
  applyGenericUiBlock: (
    target: ChatArtboardTarget,
    schema: import('../types').GenericUiSchema,
    blockIndex: number,
    deliveredBlockIds: string[],
  ) =>
    | {
        rootId: string
        blockRootId: string
        affectedElementIds: string[]
        affectedBlockIds: string[]
        removedBlockIds: string[]
        documentRevision: number
      }
    | undefined
  applyGenericUiStructure: (
    target: ChatArtboardTarget,
    schema: import('../types').DesignSpec,
    baseRevision: number,
  ) =>
    | {
        rootId: string
        affectedElementIds: string[]
        affectedBlockIds: string[]
        removedBlockIds: string[]
        documentRevision: number
      }
    | undefined
  applyDesignPatch: (
    patch: import('../../ai/types').DesignPatch,
    images: Record<string, import('../../ai/types').GeneratedCanvasImage>,
  ) => DesignPatchApplyResult
  applyGeneratedImage: (
    target: ChatArtboardTarget,
    image: GeneratedArtboardImage,
  ) => string | undefined
  applyComponentDesign: (
    target: ChatArtboardTarget,
    componentDesign: ComponentDesignMeta,
    assets: GeneratedArtboardImage[],
    replaceInstanceId?: string,
    pageSectionId?: string,
  ) => string | undefined
  applyPageDesign: (
    target: ChatArtboardTarget,
    pageDesign: PageDesignMeta,
    components: GeneratedPageComponent[],
    pageShell: GeneratedArtboardImage,
  ) => string[]
  applyIncrementalPageShell: (
    target: ChatArtboardTarget,
    blueprint: PageDesignMeta['blueprint'],
    pageShell: GeneratedArtboardImage,
  ) => string | undefined
  setPageSectionLocked: (sectionId: string, locked: boolean) => void
  setSectionAutoLayout: (
    elementId: string,
    autoLayout: import('../types').SectionElement['autoLayout'],
  ) => void
  applyComponentSlotImage: (elementId: string, image: GeneratedArtboardImage) => boolean
  applyComponentSlotImages: (
    items: Array<{
      scope: import('../../ai/types').ComponentRegionEditScope
      image: GeneratedArtboardImage
    }>,
  ) => { ok: boolean; affectedElementIds: string[] }
  applyPageShellImage: (elementId: string, image: GeneratedArtboardImage) => boolean
  setTool: (tool: EditorTool) => void
  selectElement: (id: string, options?: { append?: boolean }) => void
  setSelectedElements: (ids: string[], options?: { append?: boolean }) => void
  setTextRangeSelection: (selection?: EditorTextRangeSelection) => void
  setImageRegionSelection: (selection?: EditorImageRegionSelection) => void
  selectArtboard: (id: string) => void
  clearSelection: () => void
  clearArtboardSelection: () => void
  consumeSelectionScope: () => void
  updateElement: (id: string, patch: Partial<DesignElement>) => void
  replaceElementImage: (
    id: string,
    image: { name: string; src: string; mimeType: string; bytes: number },
  ) => void
  updateElements: (patches: Array<{ id: string; patch: Partial<DesignElement> }>) => void
  beginPropertyTransaction: () => void
  previewElementProperties: (patches: Array<{ id: string; patch: Partial<DesignElement> }>) => void
  previewSectionAutoLayout: (
    elementId: string,
    autoLayout: import('../types').SectionElement['autoLayout'],
  ) => void
  commitPropertyTransaction: () => void
  cancelPropertyTransaction: () => void
  addArtboard: (artboard: Artboard) => void
  updateArtboard: (id: string, patch: Partial<Artboard>) => void
  setDesignBreakpoint: (id: string, breakpointId: import('../types').DesignBreakpointId) => void
  upsertDesignBreakpoint: (id: string, breakpoint: import('../types').DesignBreakpoint) => void
  removeDesignBreakpoint: (id: string, breakpointId: import('../types').DesignBreakpointId) => void
  captureResponsiveBaseline: (
    id: string,
    breakpointId: import('../types').DesignBreakpointId,
  ) => void
  clearResponsiveBaseline: (id: string, breakpointId: import('../types').DesignBreakpointId) => void
  applyResponsiveTokenBatch: (
    id: string,
    breakpointIds: import('../types').DesignBreakpointId[],
    patch: import('../types').ResponsiveTokenBatchPatch,
  ) => void
  addElement: (element: DesignElement) => void
  groupElements: (ids: string[]) => string | undefined
  ungroupElement: (id: string) => boolean
  moveLayer: (draggedId: string, targetId: string, position: LayerDropPosition) => boolean
  changeLayerOrder: (ids: string[], action: LayerOrderAction) => boolean
  removeElements: (ids: string[]) => void
  removeArtboard: (id: string) => void
  undo: () => void
  redo: () => void
}

function pushHistory(state: EditorState) {
  return state.document ? [...state.history, state.document].slice(-60) : state.history
}

export const useEditorStore = create<EditorState>((set, get) => ({
  document: null,
  viewport: { ...DEFAULT_CANVAS_VIEWPORT },
  selectedElementIds: [],
  selectionScopeArmed: false,
  textRangeSelection: undefined,
  imageRegionSelection: undefined,
  tool: 'select',
  queuedReferenceImages: [],
  queuedChatTexts: [],
  chatThreads: [createDefaultChatThread()],
  activeChatThreadId: 'panel-thread-default',
  mutationLedger: [],
  history: [],
  future: [],
  propertyTransaction: undefined,

  setDocument: (document) =>
    set((state) => {
      const normalizedDocument = normalizeComponentInstances(document)
      return {
        document: normalizedDocument,
        viewport:
          state.document?.id === document.id
            ? state.viewport
            : (normalizedDocument.viewport ?? { ...DEFAULT_CANVAS_VIEWPORT }),
        selectedElementIds: [],
        selectionScopeArmed: false,
        activeArtboardId: normalizedDocument.artboards[0]?.id,
        selectedArtboardId: undefined,
        history: [],
        future: [],
        propertyTransaction: undefined,
      }
    }),

  hydrateWorkspace: (snapshot) => {
    const normalizedDocument = normalizeComponentInstances(snapshot.document)
    set({
      document: normalizedDocument,
      viewport: normalizedDocument.viewport ?? { ...DEFAULT_CANVAS_VIEWPORT },
      selectedElementIds: [],
      selectionScopeArmed: false,
      activeArtboardId: normalizedDocument.artboards[0]?.id,
      selectedArtboardId: undefined,
      queuedReferenceImages: [],
      queuedChatTexts: [],
      chatThreads: snapshot.chatThreads.length
        ? normalizePersistedChatThreads(snapshot.chatThreads)
        : [createDefaultChatThread()],
      activeChatThreadId: snapshot.chatThreads.some(
        (thread) => thread.id === snapshot.activeChatThreadId,
      )
        ? snapshot.activeChatThreadId
        : (snapshot.chatThreads[0]?.id ?? 'panel-thread-default'),
      mutationLedger: normalizeMutationLedger(snapshot.mutationLedger),
      history: [],
      future: [],
      propertyTransaction: undefined,
    })
  },

  setMutationLedger: (mutationLedger) =>
    set({ mutationLedger: normalizeMutationLedger(mutationLedger) }),

  updateDocumentMeta: (patch) =>
    set((state) => {
      if (!state.document) return state

      return {
        document: {
          ...state.document,
          title: patch.title ?? state.document.title,
          settings: patch.settings
            ? { ...state.document.settings, ...patch.settings }
            : state.document.settings,
          updatedAt: new Date().toISOString(),
        },
      }
    }),

  setViewport: (viewport) => set({ viewport }),

  addQueuedReferenceImage: (image) =>
    set((state) => {
      if (
        state.queuedReferenceImages.some(
          (item) => item.src === image.src && item.target === image.target,
        )
      ) {
        return state
      }
      return {
        queuedReferenceImages: [...state.queuedReferenceImages, image],
      }
    }),

  consumeQueuedReferenceImages: (target) => {
    let queuedReferenceImages: QueuedReferenceImage[] = []
    set((state) => {
      queuedReferenceImages = state.queuedReferenceImages.filter((image) => image.target === target)
      return {
        queuedReferenceImages: state.queuedReferenceImages.filter(
          (image) => image.target !== target,
        ),
      }
    })
    return queuedReferenceImages
  },

  addQueuedChatText: (text) =>
    set((state) => ({
      queuedChatTexts: [...state.queuedChatTexts, text],
    })),

  consumeQueuedChatTexts: (target) => {
    let queuedChatTexts: QueuedChatText[] = []
    set((state) => {
      queuedChatTexts = state.queuedChatTexts.filter((text) => text.target === target)
      return {
        queuedChatTexts: state.queuedChatTexts.filter((text) => text.target !== target),
      }
    })
    return queuedChatTexts
  },

  setActiveChatThread: (id) =>
    set((state) => {
      const thread = state.chatThreads.find((item) => item.id === id)
      const targetArtboardId = thread?.activeTargetArtboardId ?? thread?.targetArtboardId
      const targetExists = state.document?.artboards.some(
        (artboard) => artboard.id === targetArtboardId,
      )
      return {
        activeChatThreadId: id,
        activeArtboardId: targetExists ? targetArtboardId : state.activeArtboardId,
        selectedArtboardId: targetExists ? targetArtboardId : state.selectedArtboardId,
        selectedElementIds: targetExists ? [] : state.selectedElementIds,
      }
    }),

  addChatThread: (thread) =>
    set((state) => ({
      chatThreads: [thread, ...state.chatThreads.filter((item) => item.id !== thread.id)],
      activeChatThreadId: thread.id,
    })),

  updateChatThread: (id, updater) =>
    set((state) => ({
      chatThreads: state.chatThreads.map((thread) => (thread.id === id ? updater(thread) : thread)),
    })),

  deleteChatThread: (id) =>
    set((state) => {
      if (state.chatThreads.length <= 1) {
        const fallback = createDefaultChatThread()
        return {
          chatThreads: [fallback],
          activeChatThreadId: fallback.id,
        }
      }
      const nextThreads = state.chatThreads.filter((thread) => thread.id !== id)
      return {
        chatThreads: nextThreads,
        activeChatThreadId:
          state.activeChatThreadId === id
            ? (nextThreads[0]?.id ?? 'panel-thread-default')
            : state.activeChatThreadId,
      }
    }),

  appendChatMessage: (threadId, message) =>
    set((state) => ({
      chatThreads: state.chatThreads.map((thread) =>
        thread.id === threadId ? { ...thread, messages: [...thread.messages, message] } : thread,
      ),
    })),

  ensureChatThreadArtboard: (
    threadId,
    requestedMode = 'auto',
    preferredArtboardId,
    reuseEmpty = true,
    logicalSize,
  ) => {
    let target: ChatArtboardTarget | undefined
    set((state) => {
      if (!state.document) return state
      const thread = state.chatThreads.find((item) => item.id === threadId)
      if (!thread) return state

      const mode = requestedMode === 'auto' ? 'new-artboard' : requestedMode

      const selectedElement = state.document.elements.find((element) =>
        state.selectedElementIds.includes(element.id),
      )
      const explicitTargetMode = mode === 'append-section' || mode === 'duplicate-variant'
      const candidates = explicitTargetMode
        ? [preferredArtboardId, selectedElement?.artboardId, state.selectedArtboardId]
        : [
            preferredArtboardId,
            selectedElement?.artboardId,
            state.selectedArtboardId,
            state.activeArtboardId,
          ]
      const selectedTargetId = candidates.find((candidate) =>
        state.document?.artboards.some((artboard) => artboard.id === candidate),
      )
      const targetWidth = logicalSize?.width ?? DEFAULT_ARTBOARD_WIDTH
      const targetHeight = logicalSize?.initialHeight ?? DEFAULT_ARTBOARD_HEIGHT
      const reusableEmptyArtboardId =
        mode === 'new-artboard' && reuseEmpty
          ? candidates.find(
              (candidate) =>
                state.document?.artboards.some(
                  (artboard) => artboard.id === candidate && artboard.width === targetWidth,
                ) && !state.document?.elements.some((element) => element.artboardId === candidate),
            )
          : undefined
      const existingArtboardId =
        mode === 'asset-board'
          ? state.document.artboards.some((artboard) => artboard.id === thread.assetArtboardId)
            ? thread.assetArtboardId
            : undefined
          : mode === 'append-section'
            ? selectedTargetId
            : reusableEmptyArtboardId

      if (existingArtboardId) {
        const existingArtboard = state.document.artboards.find(
          (artboard) => artboard.id === existingArtboardId,
        )
        target = { artboardId: existingArtboardId, created: false, mode }
        return {
          chatThreads: state.chatThreads.map((item) =>
            item.id === threadId ? bindThreadToArtboard(item, existingArtboardId, mode) : item,
          ),
          activeArtboardId: existingArtboardId,
          selectedArtboardId: existingArtboardId,
          selectedElementIds: [],
          viewport: existingArtboard
            ? focusConversationArtboard(state.viewport, existingArtboard)
            : state.viewport,
        }
      }

      const maxX = Math.max(
        0,
        ...state.document.artboards.map((artboard) => artboard.x + artboard.width),
      )
      const sourceArtboard = selectedTargetId
        ? state.document.artboards.find((artboard) => artboard.id === selectedTargetId)
        : undefined
      const artboard: Artboard = {
        id: createStoreId('artboard'),
        name:
          mode === 'asset-board'
            ? '独立素材'
            : mode === 'duplicate-variant'
              ? `${sourceArtboard?.name || '页面'} 变体`
              : thread.title === '未命名对话' || thread.title === '新对话'
                ? `AI 页面 ${(thread.artboardIds?.length ?? 0) + 1}`
                : thread.title,
        x: state.document.artboards.length ? maxX + ARTBOARD_GAP : 0,
        y: 0,
        width:
          mode === 'duplicate-variant'
            ? (sourceArtboard?.width ?? DEFAULT_ARTBOARD_WIDTH)
            : targetWidth,
        height: targetHeight,
        background: sourceArtboard?.background ?? '#ffffff',
        borderRadius: 0,
        overflow: 'hidden',
        autoHeight: logicalSize?.autoHeight ?? true,
        variantParentArtboardId: mode === 'duplicate-variant' ? sourceArtboard?.id : undefined,
        variantStatus: mode === 'duplicate-variant' ? 'candidate' : undefined,
        variantLabel:
          mode === 'duplicate-variant' && sourceArtboard
            ? `V${state.document.artboards.filter((item) => item.variantParentArtboardId === sourceArtboard.id).length + 1}`
            : undefined,
        variantCreatedAt: mode === 'duplicate-variant' ? new Date().toISOString() : undefined,
        visualOptimizationBrief:
          mode === 'duplicate-variant' && thread.visualOptimizationDraft
            ? structuredClone(thread.visualOptimizationDraft.brief)
            : undefined,
      }
      const sourceElements =
        mode === 'duplicate-variant' && sourceArtboard
          ? state.document.elements.filter((element) => element.artboardId === sourceArtboard.id)
          : []
      const elementIdMap = new Map(
        sourceElements.map((element, index) => [
          element.id,
          createStoreId(`${element.type}-variant-${index}`),
        ]),
      )
      const sourceInstanceIds = Array.from(
        new Set(
          sourceElements
            .map((element) => element.componentBinding?.instanceId)
            .filter((value): value is string => Boolean(value)),
        ),
      )
      const instanceIdMap = new Map(
        sourceInstanceIds.map((instanceId) => [instanceId, createStoreId('component-instance')]),
      )
      const clonedElements = constrainElementsToArtboard(
        sourceElements.map((element) => {
          const id = elementIdMap.get(element.id)!
          const parentId = element.parentId ? elementIdMap.get(element.parentId) : undefined
          const binding = element.componentBinding
          const nextInstanceId = binding ? instanceIdMap.get(binding.instanceId) : undefined
          return {
            ...element,
            id,
            parentId,
            artboardId: artboard.id,
            x: artboard.x + element.x - (sourceArtboard?.x ?? 0),
            y: artboard.y + element.y - (sourceArtboard?.y ?? 0),
            componentBinding:
              binding && nextInstanceId
                ? {
                    ...binding,
                    instanceId: nextInstanceId,
                    rootElementId: elementIdMap.get(binding.rootElementId) ?? id,
                  }
                : binding,
          } as DesignElement
        }),
        artboard,
      )
      const clonedInstances = Object.fromEntries(
        sourceInstanceIds.flatMap((sourceInstanceId) => {
          const sourceInstance = state.document?.componentInstances?.[sourceInstanceId]
          const instanceId = instanceIdMap.get(sourceInstanceId)
          const rootElementId = sourceInstance
            ? elementIdMap.get(sourceInstance.rootElementId)
            : undefined
          if (!sourceInstance || !instanceId || !rootElementId) return []
          return [
            [
              instanceId,
              createComponentInstance(
                sourceInstance.design,
                artboard.id,
                rootElementId,
                instanceId,
              ),
            ],
          ]
        }),
      )
      target = {
        artboardId: artboard.id,
        created: true,
        mode,
        parentArtboardId: mode === 'duplicate-variant' ? sourceArtboard?.id : undefined,
      }
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: [...state.document.artboards, artboard],
          elements: [...state.document.elements, ...clonedElements],
          componentInstances: {
            ...(state.document.componentInstances ?? {}),
            ...clonedInstances,
          },
          updatedAt: new Date().toISOString(),
        },
        chatThreads: state.chatThreads.map((item) =>
          item.id === threadId ? bindThreadToArtboard(item, artboard.id, mode) : item,
        ),
        activeArtboardId: artboard.id,
        selectedArtboardId: artboard.id,
        selectedElementIds: [],
        viewport: focusConversationArtboard(state.viewport, artboard),
        history: pushHistory(state),
        future: [],
      }
    })
    return target
  },

  applyGenericUiDesign: (target, schema) => {
    let rootId: string | undefined
    set((state) => {
      if (!state.document) return state
      const artboard = state.document.artboards.find((item) => item.id === target.artboardId)
      if (!artboard) return state
      const { commit } = compileDesignSpecToSceneCommit(schema, artboard)
      // 以实际编译出的节点边界为准，避免 viewport 初始高度截断长页面内容。
      const contentHeight = Math.max(
        commit.contentHeight,
        ...commit.elements.map((element) => element.y + element.height - artboard.y),
      )
      const targetWidth =
        target.mode === 'duplicate-variant' ? artboard.width : schema.viewport.width
      rootId = commit.rootNodeId
      const retained = state.document.elements.filter(
        (element) => element.artboardId !== artboard.id,
      )
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: state.document.artboards.map((item) =>
            item.id === artboard.id
              ? {
                  ...item,
                  width: targetWidth,
                  height: contentHeight,
                  autoHeight: target.mode === 'duplicate-variant' ? true : false,
                  background: schema.theme.colors[1] || '#f5f7fa',
                  designSpec: schema,
                  genericUiSchema: schema,
                }
              : item,
          ),
          elements: [...retained, ...constrainElementsToArtboard(commit.elements, artboard)],
          updatedAt: new Date().toISOString(),
        },
        activeArtboardId: artboard.id,
        selectedArtboardId: artboard.id,
        selectedElementIds: [commit.rootNodeId],
        history: pushHistory(state),
        future: [],
      }
    })
    return rootId
  },

  applyGenericUiRuntimeScene: (target, sceneGraph) => {
    let result:
      | {
          rootId: string
          elementCount: number
          editableNodeCount: number
          sourceAdapterId: string
          documentRevision: number
        }
      | undefined
    set((state) => {
      if (!state.document) return state
      const artboard = state.document.artboards.find((item) => item.id === target.artboardId)
      if (!artboard) return state
      const commit = compileSceneCommit(sceneGraph, { artboardId: artboard.id })
      const contentHeight = Math.max(
        sceneGraph.surface.height,
        ...commit.elements.map((element) => element.y + element.height - artboard.y),
      )
      const targetWidth =
        target.mode === 'duplicate-variant' ? artboard.width : sceneGraph.surface.width
      const root = sceneGraph.nodes.find((node) => node.id === sceneGraph.rootNodeId)
      const background = root?.style?.fill ?? root?.style?.background ?? artboard.background
      const documentRevision = state.document.version + 1
      const editableNodeCount = sceneGraph.nodes.filter(
        (node) =>
          node.type === 'text' ||
          node.type === 'button' ||
          node.type === 'input' ||
          node.type === 'image',
      ).length
      result = {
        rootId: commit.rootNodeId,
        elementCount: commit.elements.length,
        editableNodeCount,
        sourceAdapterId: commit.sourceAdapterId,
        documentRevision,
      }
      return {
        document: {
          ...state.document,
          version: documentRevision,
          artboards: state.document.artboards.map((item) =>
            item.id === artboard.id
              ? {
                  ...item,
                  width: targetWidth,
                  height: Math.max(1, contentHeight),
                  autoHeight: target.mode === 'duplicate-variant' ? true : false,
                  background,
                  designSpec: undefined,
                  genericUiSchema: undefined,
                  designBreakpointId: undefined,
                  responsiveBaselines: undefined,
                  pageDesign: undefined,
                  runtimeScene: {
                    graphId: commit.graphId,
                    sourceAdapterId: commit.sourceAdapterId,
                    nodeCount: commit.elements.length,
                  },
                }
              : item,
          ),
          elements: [
            ...state.document.elements.filter((element) => element.artboardId !== artboard.id),
            ...constrainElementsToArtboard(commit.elements, artboard),
          ],
          componentInstances: Object.fromEntries(
            Object.entries(state.document.componentInstances ?? {}).filter(
              ([, instance]) => instance.artboardId !== artboard.id,
            ),
          ),
          structuralInstances: Object.fromEntries(
            Object.entries(state.document.structuralInstances ?? {}).filter(
              ([, instance]) => instance.artboardId !== artboard.id,
            ),
          ),
          updatedAt: new Date().toISOString(),
        },
        activeArtboardId: artboard.id,
        selectedArtboardId: artboard.id,
        selectedElementIds: [commit.rootNodeId],
        history: pushHistory(state),
        future: [],
      }
    })
    return result
  },

  applyGenericUiBlock: (target, schema, blockIndex, deliveredBlockIds) => {
    let result:
      | {
          rootId: string
          blockRootId: string
          affectedElementIds: string[]
          affectedBlockIds: string[]
          removedBlockIds: string[]
          documentRevision: number
        }
      | undefined
    set((state) => {
      if (!state.document) return state
      const artboard = state.document.artboards.find((item) => item.id === target.artboardId)
      const block = schema.blocks[blockIndex]
      if (!artboard || !block || !deliveredBlockIds.includes(block.id)) return state

      const deliveredIds = new Set(deliveredBlockIds)
      if (
        deliveredIds.size !== deliveredBlockIds.length ||
        deliveredBlockIds.some((id) => !schema.blocks.some((item) => item.id === id))
      )
        return state

      const renderSchema = resolveDesignSpecBreakpoint(schema, artboard.designBreakpointId)
      const transaction = compileDesignSpecSceneTransaction({
        artboard,
        renderSchema,
        comparisonSchema: schema,
        previousSchema: artboard.designSpec,
        currentElements: state.document.elements,
        desiredBlockIds: deliveredBlockIds,
        forceBlockIds: [block.id],
      })
      const blockRootId = transaction.blockRootIds[block.id]
      if (!blockRootId) return state
      const nextElementIds = new Set(transaction.nextElements.map((element) => element.id))
      const selectedElementIds = state.selectedElementIds.filter((id) => nextElementIds.has(id))
      const deliveredBlocks = schema.blocks.filter((item) => deliveredIds.has(item.id))
      const documentRevision = state.document.version + 1
      result = {
        rootId: transaction.rootNodeId,
        blockRootId,
        affectedElementIds: transaction.affectedElementIds,
        affectedBlockIds: transaction.affectedRegionIds,
        removedBlockIds: transaction.removedRegionIds,
        documentRevision,
      }
      return {
        document: {
          ...state.document,
          version: documentRevision,
          artboards: state.document.artboards.map((item) =>
            item.id === artboard.id
              ? {
                  ...item,
                  width:
                    target.mode === 'duplicate-variant'
                      ? artboard.width
                      : renderSchema.viewport.width,
                  height: transaction.contentHeight,
                  autoHeight: target.mode === 'duplicate-variant' ? true : false,
                  background: schema.theme.colors[1] || '#f5f7fa',
                  designSpec: { ...schema, blocks: deliveredBlocks },
                  genericUiSchema: { ...schema, blocks: deliveredBlocks },
                }
              : item,
          ),
          elements: constrainElementsToArtboard(transaction.nextElements, artboard),
          updatedAt: new Date().toISOString(),
        },
        activeArtboardId: artboard.id,
        selectedArtboardId: artboard.id,
        selectedElementIds: selectedElementIds.length ? selectedElementIds : [blockRootId],
        history: pushHistory(state),
        future: [],
      }
    })
    return result
  },

  applyGenericUiStructure: (target, schema, baseRevision) => {
    let result:
      | {
          rootId: string
          affectedElementIds: string[]
          affectedBlockIds: string[]
          removedBlockIds: string[]
          documentRevision: number
        }
      | undefined
    set((state) => {
      if (!state.document || state.document.version !== baseRevision) return state
      const artboard = state.document.artboards.find((item) => item.id === target.artboardId)
      if (!artboard?.designSpec || !schema.blocks.length) return state

      const renderSchema = resolveDesignSpecBreakpoint(schema, artboard.designBreakpointId)
      const transaction = compileDesignSpecSceneTransaction({
        artboard,
        renderSchema,
        comparisonSchema: schema,
        previousSchema: artboard.designSpec,
        currentElements: state.document.elements,
      })
      const nextElementIds = new Set(transaction.nextElements.map((element) => element.id))
      const selectedElementIds = state.selectedElementIds.filter((id) => nextElementIds.has(id))
      const documentRevision = state.document.version + 1
      result = {
        rootId: transaction.rootNodeId,
        affectedElementIds: transaction.affectedElementIds,
        affectedBlockIds: transaction.affectedRegionIds,
        removedBlockIds: transaction.removedRegionIds,
        documentRevision,
      }
      return {
        document: {
          ...state.document,
          version: documentRevision,
          artboards: state.document.artboards.map((item) =>
            item.id === artboard.id
              ? {
                  ...item,
                  width:
                    target.mode === 'duplicate-variant'
                      ? artboard.width
                      : renderSchema.viewport.width,
                  height: transaction.contentHeight,
                  autoHeight: target.mode === 'duplicate-variant' ? true : false,
                  background: schema.theme.colors[1] || '#f5f7fa',
                  designSpec: schema,
                  genericUiSchema: schema,
                }
              : item,
          ),
          elements: constrainElementsToArtboard(transaction.nextElements, artboard),
          updatedAt: new Date().toISOString(),
        },
        selectedElementIds,
        history: pushHistory(state),
        future: [],
      }
    })
    return result
  },

  applyDesignPatch: (patch, images) => {
    let result: DesignPatchApplyResult = {
      ok: false,
      errorCode: 'DESIGN_DOCUMENT_MISSING',
      message: '当前没有可修改的设计文档。',
    }
    set((state) => {
      if (!state.document) return state
      result = applyDesignPatchToDocument(state.document, patch, images)
      if (!result.ok) return state
      const document = {
        ...result.document,
        componentInstances: syncComponentInstancesFromElements(
          result.document.componentInstances ?? {},
          result.document.elements,
          new Set(result.affectedElementIds),
        ),
      }
      result = { ...result, document }
      return {
        document,
        selectedElementIds: result.affectedElementIds.filter((id) =>
          document.elements.some((element) => element.id === id),
        ),
        history: pushHistory(state),
        future: [],
      }
    })
    return result
  },

  applyGeneratedImage: (target, image) => {
    let imageElementId: string | undefined
    set((state) => {
      if (!state.document) return state
      const artboard = state.document.artboards.find((item) => item.id === target.artboardId)
      if (!artboard) return state

      const replacesVariant = target.mode === 'duplicate-variant' && image.placement !== 'asset'
      const retainedElements = replacesVariant
        ? state.document.elements.filter((element) => element.artboardId !== target.artboardId)
        : state.document.elements
      const hasExistingElements = retainedElements.some(
        (element) => element.artboardId === target.artboardId,
      )
      const usesAutoHeight = Boolean(artboard.autoHeight || target.created)
      const isIndependentAsset = image.placement === 'asset'
      const assetScale =
        image.width >= DEFAULT_ARTBOARD_WIDTH * 1.8
          ? Math.min(0.5, DEFAULT_ARTBOARD_WIDTH / image.width)
          : Math.min(1, (DEFAULT_ARTBOARD_WIDTH - GENERATED_CONTENT_GAP * 2) / image.width)
      const widthScale = isIndependentAsset ? assetScale : artboard.width / image.width
      // 页面/Variant 必须沿用目标画板的逻辑宽度；只有独立素材才按默认素材宽度缩放。
      // 之前这里固定使用 DEFAULT_ARTBOARD_WIDTH，导致 1440px 原稿的 Variant 被错误压成 375px。
      const autoHeightImageWidth = isIndependentAsset
        ? Math.max(1, image.width * widthScale)
        : artboard.width
      const autoHeightImageHeight = Math.max(1, image.height * widthScale)
      const contentBottom = Math.max(
        artboard.y,
        ...retainedElements
          .filter((element) => element.artboardId === target.artboardId)
          .map((element) => element.y + element.height),
      )
      const autoHeightY = hasExistingElements
        ? contentBottom + GENERATED_CONTENT_GAP
        : artboard.y + (isIndependentAsset ? GENERATED_CONTENT_GAP : 0)
      const fixedScale = Math.min(artboard.width / image.width, artboard.height / image.height)
      const width = usesAutoHeight ? autoHeightImageWidth : Math.max(1, image.width * fixedScale)
      const height = usesAutoHeight ? autoHeightImageHeight : Math.max(1, image.height * fixedScale)
      const x = usesAutoHeight
        ? artboard.x + (artboard.width - width) / 2
        : artboard.x + (artboard.width - width) / 2
      const y = usesAutoHeight ? autoHeightY : artboard.y + (artboard.height - height) / 2
      const targetArtboard = usesAutoHeight
        ? {
            ...artboard,
            width: artboard.width,
            height: Math.max(
              1,
              y - artboard.y + height + (isIndependentAsset ? GENERATED_CONTENT_GAP : 0),
            ),
            borderRadius: 0,
            autoHeight: true,
            generationMeta: image.generationMeta
              ? {
                  ...image.generationMeta,
                  parentArtboardId: target.parentArtboardId,
                }
              : artboard.generationMeta,
          }
        : image.generationMeta
          ? {
              ...artboard,
              generationMeta: {
                ...image.generationMeta,
                parentArtboardId: target.parentArtboardId,
              },
            }
          : artboard
      const zIndex =
        Math.max(
          0,
          ...retainedElements
            .filter((element) => element.artboardId === target.artboardId)
            .map((element) => element.zIndex),
        ) + 1
      const assetId = createStoreId('asset')
      imageElementId = createStoreId('image')

      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: state.document.artboards.map((item) =>
            item.id === target.artboardId ? targetArtboard : item,
          ),
          elements: [
            ...retainedElements,
            {
              id: imageElementId,
              artboardId: target.artboardId,
              type: 'image',
              name: image.name,
              x,
              y,
              width,
              height,
              zIndex,
              src: image.src,
              objectFit: 'fill',
            },
          ],
          assets: [
            ...state.document.assets,
            { id: assetId, type: 'image', name: image.name, src: image.src },
          ],
          updatedAt: new Date().toISOString(),
        },
        activeArtboardId: target.artboardId,
        selectedArtboardId: undefined,
        selectedElementIds: [imageElementId],
        history: pushHistory(state),
        future: [],
      }
    })
    return imageElementId
  },

  applyComponentDesign: (
    target,
    componentDesign,
    assets,
    replaceInstanceId,
    explicitPageSectionId,
  ) => {
    let rootElementId: string | undefined
    set((state) => {
      if (!state.document) return state
      const artboard = state.document.artboards.find((item) => item.id === target.artboardId)
      if (!artboard) return state

      const replacesVariant = target.mode === 'duplicate-variant'
      const replacedRoot =
        !replacesVariant && replaceInstanceId
          ? state.document.elements.find(
              (element) =>
                element.artboardId === target.artboardId &&
                element.componentBinding?.instanceId === replaceInstanceId &&
                element.componentBinding.renderMode === 'root',
            )
          : undefined
      const replacesInstance = Boolean(replacedRoot && replaceInstanceId)
      const retainedElements = replacesVariant
        ? state.document.elements.filter((element) => element.artboardId !== target.artboardId)
        : replacesInstance
          ? state.document.elements.filter(
              (element) => element.componentBinding?.instanceId !== replaceInstanceId,
            )
          : state.document.elements
      const artboardElements = retainedElements.filter(
        (element) => element.artboardId === target.artboardId,
      )
      const contentBottom = Math.max(
        artboard.y,
        ...artboardElements.map((element) => element.y + element.height),
      )
      const originY =
        replacedRoot?.y ??
        (artboardElements.length ? contentBottom + GENERATED_CONTENT_GAP : artboard.y)
      const rootWidth = artboard.width
      const scale = rootWidth / componentDesign.blueprint.width
      const rootHeight = Math.max(1, componentDesign.blueprint.height * scale)
      const originX = replacedRoot?.x ?? artboard.x
      const baseZIndex =
        replacedRoot?.zIndex ??
        Math.max(0, ...artboardElements.map((element) => element.zIndex)) + 1
      const instanceId = replacesInstance ? replaceInstanceId! : createStoreId('component-instance')
      rootElementId = replacedRoot?.id ?? createStoreId('component-section')
      const pageSectionId = explicitPageSectionId ?? replacedRoot?.componentBinding?.pageSectionId
      const pageSectionLocked = replacedRoot?.locked === true
      const nextComponentDesign: ComponentDesignMeta = { ...componentDesign, instanceId }
      const { commit: componentSceneCommit } = compileComponentDesignToSceneCommit({
        componentDesign,
        assets,
        artboard,
        instanceId,
        rootElementId,
        pageSectionId,
        originX,
        originY,
        width: rootWidth,
        height: rootHeight,
        scale,
        baseZIndex,
        locked: pageSectionLocked,
      })
      const nextAssets = assets.map((image) => ({
        id: createStoreId('asset'),
        type: 'image' as const,
        name: image.name,
        src: image.src,
      }))
      const nextArtboard: Artboard = {
        ...artboard,
        width: artboard.width,
        height: Math.max(
          artboard.height,
          originY - artboard.y + rootHeight,
          ...componentSceneCommit.elements.map(
            (element) => element.y + element.height - artboard.y,
          ),
        ),
        autoHeight: true,
      }
      const retainedInstances = Object.fromEntries(
        Object.entries(state.document.componentInstances ?? {}).filter(
          ([id, instance]) =>
            id !== replaceInstanceId && !(replacesVariant && instance.artboardId === artboard.id),
        ),
      )

      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: state.document.artboards.map((item) =>
            item.id === artboard.id ? nextArtboard : item,
          ),
          elements: [
            ...retainedElements,
            ...constrainElementsToArtboard(componentSceneCommit.elements, artboard),
          ],
          componentInstances: {
            ...retainedInstances,
            [instanceId]: createComponentInstance(
              nextComponentDesign,
              artboard.id,
              rootElementId,
              instanceId,
            ),
          },
          assets: [...state.document.assets, ...nextAssets],
          updatedAt: new Date().toISOString(),
        },
        activeArtboardId: artboard.id,
        selectedArtboardId: undefined,
        selectedElementIds: [rootElementId],
        history: pushHistory(state),
        future: [],
      }
    })
    return rootElementId
  },

  applyPageDesign: (target, pageDesign, components, pageShell) => {
    const rootElementIds = components
      .map((component, index) => {
        const pageSectionId =
          component.pageSectionId ?? pageDesign.blueprint.sections[component.index ?? index]?.id
        // 新增页面组件没有 pageSectionId 时，绝不能把另一个同样缺少
        // pageSectionId 的根组件误判为替换目标；只有显式 section ID
        // 才允许进入替换实例流程。
        const existingInstanceId = pageSectionId
          ? get().document?.elements.find(
              (element) =>
                element.artboardId === target.artboardId &&
                element.componentBinding?.pageSectionId === pageSectionId &&
                element.componentBinding.renderMode === 'root',
            )?.componentBinding?.instanceId
          : undefined
        return get().applyComponentDesign(
          index === 0 ? target : { ...target, created: false, mode: 'append-section' },
          component.componentDesign,
          component.assets,
          existingInstanceId,
          pageSectionId,
        )
      })
      .filter((id): id is string => Boolean(id))

    set((state) => {
      if (!state.document) return state
      const artboard = state.document.artboards.find((item) => item.id === target.artboardId)
      if (!artboard) return state
      const artboardElements = state.document.elements.filter(
        (element) => element.artboardId === artboard.id,
      )
      const sectionByInstance = new Map(
        rootElementIds
          .map((rootId, index) => {
            const root = state.document?.elements.find((element) => element.id === rootId)
            const component = components[index]
            return [
              root?.componentBinding?.instanceId,
              pageDesign.blueprint.sections[component.index ?? index],
            ] as const
          })
          .filter(
            (entry): entry is readonly [string, PageDesignMeta['blueprint']['sections'][number]] =>
              Boolean(entry[0] && entry[1]),
          ),
      )
      const contentBottom = Math.max(
        artboard.y + pageDesign.blueprint.estimatedHeight,
        ...artboardElements.map((element) => element.y + element.height),
      )
      const height = Math.max(DEFAULT_ARTBOARD_HEIGHT, contentBottom - artboard.y)
      const structuralElements = (pageDesign.blueprint.containers ?? []).map((container, index) => {
        const structuralId = createStoreId('container-instance')
        const elementId = createStoreId('container-section')
        const bounds = container.bounds ?? {
          x: 0,
          y: 0,
          width: DEFAULT_ARTBOARD_WIDTH,
          height,
        }
        return {
          structuralId,
          instance: {
            id: structuralId,
            artboardId: artboard.id,
            rootElementId: elementId,
            componentName: container.componentName,
            nodeType: 'container' as const,
            designPaths: container.designPaths ?? [],
            propsPatch: {},
          } satisfies StructuralInstance,
          element: {
            id: elementId,
            artboardId: artboard.id,
            type: 'section' as const,
            name: `${container.componentName} 容器`,
            label: `${container.componentName} / 容器结构`,
            x: artboard.x + bounds.x,
            y: artboard.y + bounds.y,
            width: bounds.width,
            height: bounds.height,
            zIndex: index,
            locked: false,
            designRole: 'container' as const,
            componentBinding: {
              instanceId: structuralId,
              componentName: container.componentName,
              profile: 'structural',
              regionId: 'container-root',
              renderMode: 'root' as const,
              rootElementId: elementId,
              propPaths: container.designPaths ?? [],
              bindings: {},
            },
          } satisfies DesignElement,
        }
      })
      const existingShell = state.document.elements.find(
        (element) => element.artboardId === artboard.id && element.designRole === 'page-shell',
      )
      const shellElementId = existingShell?.id ?? createStoreId('page-shell')
      const shellElement: DesignElement = {
        id: shellElementId,
        artboardId: artboard.id,
        type: 'image',
        name: '页面视觉外壳',
        x: artboard.x,
        y: artboard.y,
        width: artboard.width,
        height,
        zIndex: 0,
        src: pageShell.src,
        objectFit: 'fill',
        designRole: 'page-shell',
      }
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: state.document.artboards.map((item) =>
            item.id === artboard.id
              ? { ...item, width: artboard.width, height, autoHeight: true, pageDesign }
              : item,
          ),
          elements: [
            ...state.document.elements
              .filter((element) => element.id !== shellElementId)
              .map((element): DesignElement => {
                const binding = element.componentBinding
                const section = binding ? sectionByInstance.get(binding.instanceId) : undefined
                return section
                  ? ({
                      ...element,
                      locked: section.locked === true,
                      componentBinding: {
                        ...binding,
                        pageSectionId: section.id,
                      },
                    } as DesignElement)
                  : element
              }),
            ...structuralElements.map((item) => item.element),
            shellElement,
          ],
          structuralInstances: {
            ...(state.document.structuralInstances ?? {}),
            ...Object.fromEntries(
              structuralElements.map((item) => [item.structuralId, item.instance]),
            ),
          },
          assets: [
            ...state.document.assets,
            {
              id: createStoreId('asset'),
              type: 'image',
              name: pageShell.name,
              src: pageShell.src,
            },
          ],
          updatedAt: new Date().toISOString(),
        },
        activeArtboardId: artboard.id,
        selectedElementIds: rootElementIds,
        selectedArtboardId: undefined,
        history: pushHistory(state),
        future: [],
      }
    })
    return rootElementIds
  },

  applyIncrementalPageShell: (target, blueprint, pageShell) => {
    let shellElementId: string | undefined
    set((state) => {
      if (!state.document) return state
      const artboard = state.document.artboards.find((item) => item.id === target.artboardId)
      if (!artboard) return state
      const existingShell = state.document.elements.find(
        (element) => element.artboardId === artboard.id && element.designRole === 'page-shell',
      )
      shellElementId = existingShell?.id ?? createStoreId('page-shell')
      const retainedElements = state.document.elements.filter(
        (element) => element.id !== shellElementId,
      )
      const height = Math.max(DEFAULT_ARTBOARD_HEIGHT, blueprint.estimatedHeight)
      const shellElement: DesignElement = {
        id: shellElementId,
        artboardId: artboard.id,
        type: 'image',
        name: pageShell.name || '页面视觉外壳',
        x: artboard.x,
        y: artboard.y,
        width: artboard.width,
        height,
        zIndex: 0,
        src: pageShell.src,
        objectFit: 'fill',
        designRole: 'page-shell',
      }
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: state.document.artboards.map((item) =>
            item.id === artboard.id
              ? { ...item, width: artboard.width, height, autoHeight: true }
              : item,
          ),
          elements: [...retainedElements, shellElement],
          assets: [
            ...state.document.assets,
            {
              id: createStoreId('asset'),
              type: 'image',
              name: pageShell.name,
              src: pageShell.src,
            },
          ],
          updatedAt: new Date().toISOString(),
        },
        activeArtboardId: artboard.id,
        selectedArtboardId: undefined,
        history: pushHistory(state),
        future: [],
      }
    })
    return shellElementId
  },

  setPageSectionLocked: (sectionId, locked) => {
    set((state) => {
      if (!state.document) return state
      const instanceIds = new Set(
        state.document.elements
          .filter((element) => element.componentBinding?.pageSectionId === sectionId)
          .map((element) => element.componentBinding?.instanceId)
          .filter((id): id is string => Boolean(id)),
      )
      if (!instanceIds.size) return state
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: state.document.artboards.map((artboard) =>
            artboard.pageDesign
              ? {
                  ...artboard,
                  pageDesign: {
                    ...artboard.pageDesign,
                    blueprint: {
                      ...artboard.pageDesign.blueprint,
                      sections: artboard.pageDesign.blueprint.sections.map((section) =>
                        section.id === sectionId ? { ...section, locked } : section,
                      ),
                    },
                  },
                }
              : artboard,
          ),
          elements: state.document.elements.map((element) =>
            element.componentBinding && instanceIds.has(element.componentBinding.instanceId)
              ? { ...element, locked }
              : element,
          ),
          updatedAt: new Date().toISOString(),
        },
        history: pushHistory(state),
        future: [],
      }
    })
  },

  setSectionAutoLayout: (elementId, autoLayout) => {
    set((state) => {
      if (!state.document) return state
      const nextElements = applySectionAutoLayoutToElements(
        state.document.elements,
        elementId,
        autoLayout,
      )
      if (!nextElements) return state
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          elements: nextElements,
          updatedAt: new Date().toISOString(),
        },
        history: pushHistory(state),
        future: [],
      }
    })
  },

  applyComponentSlotImage: (elementId, image) => {
    let applied = false
    set((state) => {
      if (!state.document) return state
      const element = state.document.elements.find((item) => item.id === elementId)
      const binding = element?.componentBinding
      if (!element || element.type !== 'image' || !binding?.slotId || !binding.bindings.image) {
        return state
      }
      const instance = state.document.componentInstances?.[binding.instanceId]
      if (!instance) return state
      const propsPatch = structuredClone(instance.design.propsPatch)
      setNestedPatchValue(propsPatch, binding.bindings.image, image.src)
      const task = instance.design.assetTasks.find((item) => item.slotId === binding.slotId)
      if (task?.fallbackPath) setNestedPatchValue(propsPatch, task.fallbackPath, image.src)
      applied = true
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          componentInstances: {
            ...(state.document.componentInstances ?? {}),
            [binding.instanceId]: {
              ...instance,
              design: { ...instance.design, propsPatch },
            },
          },
          elements: state.document.elements.map((item) =>
            item.id === elementId ? { ...item, src: image.src, name: image.name } : item,
          ),
          assets: [
            ...state.document.assets,
            { id: createStoreId('asset'), type: 'image', name: image.name, src: image.src },
          ],
          updatedAt: new Date().toISOString(),
        },
        selectedElementIds: [elementId],
        history: pushHistory(state),
        future: [],
      }
    })
    return applied
  },

  applyComponentSlotImages: (items) => {
    let result = { ok: false, affectedElementIds: [] as string[] }
    set((state) => {
      if (!state.document || !items.length) return state
      const uniqueItems = [...new Map(items.map((item) => [item.scope.elementId, item])).values()]
      if (uniqueItems.length !== items.length) return state
      const resolved = uniqueItems.map((item) => {
        const element = state.document!.elements.find(
          (candidate) => candidate.id === item.scope.elementId,
        )
        const binding = element?.componentBinding
        const instance = binding
          ? state.document!.componentInstances?.[binding.instanceId]
          : undefined
        if (
          !element ||
          element.type !== 'image' ||
          !binding?.slotId ||
          !binding.bindings.image ||
          !instance ||
          binding.instanceId !== item.scope.instanceId ||
          binding.slotId !== item.scope.slotId ||
          binding.bindings.image !== item.scope.propPath ||
          (item.scope.currentImage && element.src !== item.scope.currentImage)
        )
          return undefined
        return { ...item, element, binding, instance }
      })
      if (resolved.some((item) => !item)) return state

      const componentInstances = { ...(state.document.componentInstances ?? {}) }
      for (const item of resolved) {
        if (!item) continue
        const currentInstance = componentInstances[item.binding.instanceId]
        const propsPatch = structuredClone(currentInstance.design.propsPatch)
        setNestedPatchValue(propsPatch, item.binding.bindings.image!, item.image.src)
        const task = currentInstance.design.assetTasks.find(
          (candidate) => candidate.slotId === item.binding.slotId,
        )
        const fallbackPath = item.scope.fallbackPath ?? task?.fallbackPath
        if (fallbackPath) setNestedPatchValue(propsPatch, fallbackPath, item.image.src)
        componentInstances[item.binding.instanceId] = {
          ...currentInstance,
          design: { ...currentInstance.design, propsPatch },
        }
      }
      const imageByElementId = new Map(
        uniqueItems.map((item) => [item.scope.elementId, item.image]),
      )
      const affectedElementIds = [...imageByElementId.keys()]
      result = { ok: true, affectedElementIds }
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          componentInstances,
          elements: state.document.elements.map((element) => {
            const image = imageByElementId.get(element.id)
            return image && element.type === 'image'
              ? { ...element, src: image.src, name: image.name }
              : element
          }),
          assets: [
            ...state.document.assets,
            ...uniqueItems.map((item) => ({
              id: createStoreId('asset'),
              type: 'image' as const,
              name: item.image.name,
              src: item.image.src,
            })),
          ],
          updatedAt: new Date().toISOString(),
        },
        selectedElementIds: affectedElementIds,
        history: pushHistory(state),
        future: [],
      }
    })
    return result
  },

  applyPageShellImage: (elementId, image) => {
    let applied = false
    set((state) => {
      if (!state.document) return state
      const element = state.document.elements.find((item) => item.id === elementId)
      if (!element || element.type !== 'image' || element.designRole !== 'page-shell') return state
      applied = true
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          elements: state.document.elements.map((item) =>
            item.id === elementId ? { ...item, src: image.src, name: image.name } : item,
          ),
          assets: [
            ...state.document.assets,
            {
              id: createStoreId('asset'),
              type: 'image',
              name: image.name,
              src: image.src,
            },
          ],
          updatedAt: new Date().toISOString(),
        },
        history: pushHistory(state),
        future: [],
      }
    })
    return applied
  },

  setTool: (tool) => set({ tool }),

  selectElement: (id, options) =>
    set((state) => {
      const selectedElementIds = options?.append
        ? state.selectedElementIds.includes(id)
          ? state.selectedElementIds.filter((item) => item !== id)
          : [...state.selectedElementIds, id]
        : [id]
      const element = state.document?.elements.find((item) => item.id === id)

      return {
        selectedElementIds,
        selectionScopeArmed: selectedElementIds.length > 0,
        textRangeSelection:
          state.textRangeSelection?.elementId === id && !options?.append
            ? state.textRangeSelection
            : undefined,
        imageRegionSelection:
          state.imageRegionSelection?.elementId === id && !options?.append
            ? state.imageRegionSelection
            : undefined,
        activeArtboardId: element?.artboardId ?? state.activeArtboardId,
        selectedArtboardId: undefined,
        chatThreads: state.chatThreads.map((thread) =>
          thread.id === state.activeChatThreadId && thread.visualOptimizationDraft
            ? { ...thread, visualOptimizationDraft: undefined, prompt: '' }
            : thread,
        ),
      }
    }),

  setSelectedElements: (ids, options) =>
    set((state) => {
      const uniqueIds = Array.from(new Set(ids))
      const selectedElementIds = options?.append
        ? Array.from(new Set([...state.selectedElementIds, ...uniqueIds]))
        : uniqueIds
      const element = state.document?.elements.find((item) => item.id === selectedElementIds[0])

      return {
        selectedElementIds,
        selectionScopeArmed: selectedElementIds.length > 0,
        textRangeSelection:
          selectedElementIds.length === 1 &&
          state.textRangeSelection?.elementId === selectedElementIds[0]
            ? state.textRangeSelection
            : undefined,
        imageRegionSelection:
          selectedElementIds.length === 1 &&
          state.imageRegionSelection?.elementId === selectedElementIds[0]
            ? state.imageRegionSelection
            : undefined,
        activeArtboardId: element?.artboardId ?? state.activeArtboardId,
        selectedArtboardId: undefined,
        chatThreads: state.chatThreads.map((thread) =>
          thread.id === state.activeChatThreadId && thread.visualOptimizationDraft
            ? { ...thread, visualOptimizationDraft: undefined, prompt: '' }
            : thread,
        ),
      }
    }),

  selectArtboard: (id) =>
    set((state) => ({
      activeArtboardId: id,
      selectedArtboardId: id,
      selectedElementIds: [],
      selectionScopeArmed: false,
      textRangeSelection: undefined,
      imageRegionSelection: undefined,
      // 切换画板后，旧画板的待确认视觉优化摘要不再适用。
      chatThreads: state.chatThreads.map((thread) =>
        thread.id === state.activeChatThreadId
          ? {
              ...thread,
              visualOptimizationDraft: undefined,
              prompt: thread.visualOptimizationDraft ? '' : thread.prompt,
            }
          : thread,
      ),
    })),

  clearSelection: () =>
    set({
      selectedElementIds: [],
      selectedArtboardId: undefined,
      selectionScopeArmed: false,
      textRangeSelection: undefined,
      imageRegionSelection: undefined,
    }),

  clearArtboardSelection: () =>
    set({
      activeArtboardId: undefined,
      selectedArtboardId: undefined,
      selectedElementIds: [],
      selectionScopeArmed: false,
      textRangeSelection: undefined,
      imageRegionSelection: undefined,
    }),

  consumeSelectionScope: () =>
    set({
      selectionScopeArmed: false,
      textRangeSelection: undefined,
      imageRegionSelection: undefined,
    }),

  setTextRangeSelection: (textRangeSelection) =>
    set({
      textRangeSelection,
      selectionScopeArmed: Boolean(textRangeSelection),
    }),
  setImageRegionSelection: (imageRegionSelection) =>
    set({
      imageRegionSelection,
      selectionScopeArmed: Boolean(imageRegionSelection),
    }),

  updateElement: (id, patch) =>
    set((state) => {
      if (!state.document) return state
      const nextElements = applyElementPatches(state.document.elements, [{ id, patch }])
      const nextComponentInstances = syncComponentInstancesFromElements(
        state.document.componentInstances ?? {},
        nextElements,
        new Set(
          nextElements
            .filter((element) => element.id === id || element.parentId === id)
            .map((element) => element.id),
        ),
      )

      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          componentInstances: nextComponentInstances,
          elements: nextElements,
          updatedAt: new Date().toISOString(),
        },
        history: pushHistory(state),
        future: [],
      }
    }),

  replaceElementImage: (id, image) =>
    set((state) => {
      if (!state.document) return state
      const element = state.document.elements.find((item) => item.id === id)
      if (!element || element.type !== 'image' || element.src === image.src) return state

      const nextElements = applyElementPatches(state.document.elements, [
        { id, patch: { src: image.src } },
      ])
      const changedIds = new Set(
        nextElements
          .filter((item) => item.id === id || item.parentId === id)
          .map((item) => item.id),
      )
      const existingAsset = state.document.assets.find((asset) => asset.src === image.src)
      const previousUpload = state.document.assets.find(
        (asset) => asset.src === element.src && asset.id.startsWith('asset-upload-'),
      )
      const previousSourceIsShared = nextElements.some(
        (item) => item.type === 'image' && item.id !== id && item.src === element.src,
      )
      const assets = existingAsset
        ? state.document.assets
        : previousUpload && !previousSourceIsShared
          ? state.document.assets.map((asset) =>
              asset.id === previousUpload.id
                ? { ...asset, name: image.name || asset.name, src: image.src }
                : asset,
            )
          : [
              ...state.document.assets,
              {
                id: createStoreId('asset-upload'),
                type: 'image' as const,
                name: image.name || element.name,
                src: image.src,
              },
            ]

      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          componentInstances: syncComponentInstancesFromElements(
            state.document.componentInstances ?? {},
            nextElements,
            changedIds,
          ),
          elements: nextElements,
          assets,
          updatedAt: new Date().toISOString(),
        },
        history: pushHistory(state),
        future: [],
      }
    }),

  updateElements: (patches) =>
    set((state) => {
      if (!state.document) return state
      const nextElements = applyElementPatches(state.document.elements, patches)
      const changedIds = new Set(
        patches.flatMap((item) => [
          item.id,
          ...nextElements
            .filter((element) => element.parentId === item.id)
            .map((element) => element.id),
        ]),
      )

      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          componentInstances: syncComponentInstancesFromElements(
            state.document.componentInstances ?? {},
            nextElements,
            changedIds,
          ),
          elements: nextElements,
          updatedAt: new Date().toISOString(),
        },
        history: pushHistory(state),
        future: [],
      }
    }),

  beginPropertyTransaction: () =>
    set((state) =>
      state.document && !state.propertyTransaction
        ? { propertyTransaction: { baseline: structuredClone(state.document) } }
        : state,
    ),

  previewElementProperties: (patches) =>
    set((state) => {
      if (!state.document || !state.propertyTransaction) return state
      const nextElements = applyElementPatches(state.document.elements, patches)
      const changedIds = new Set(patches.map((item) => item.id))
      return {
        document: {
          ...state.document,
          elements: nextElements,
          componentInstances: syncComponentInstancesFromElements(
            state.document.componentInstances ?? {},
            nextElements,
            changedIds,
          ),
        },
      }
    }),

  previewSectionAutoLayout: (elementId, autoLayout) =>
    set((state) => {
      if (!state.document || !state.propertyTransaction) return state
      const elements = applySectionAutoLayoutToElements(
        state.document.elements,
        elementId,
        autoLayout,
      )
      return elements ? { document: { ...state.document, elements } } : state
    }),

  commitPropertyTransaction: () =>
    set((state) => {
      if (!state.document || !state.propertyTransaction) return state
      const baseline = state.propertyTransaction.baseline
      return {
        document: {
          ...state.document,
          version: baseline.version + 1,
          updatedAt: new Date().toISOString(),
        },
        history: [...state.history, baseline].slice(-60),
        future: [],
        propertyTransaction: undefined,
      }
    }),

  cancelPropertyTransaction: () =>
    set((state) =>
      state.propertyTransaction
        ? { document: state.propertyTransaction.baseline, propertyTransaction: undefined }
        : state,
    ),

  addArtboard: (artboard) =>
    set((state) => {
      if (!state.document) return state

      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: [...state.document.artboards, artboard],
          updatedAt: new Date().toISOString(),
        },
        activeArtboardId: artboard.id,
        selectedArtboardId: artboard.id,
        selectedElementIds: [],
        history: pushHistory(state),
        future: [],
      }
    }),

  updateArtboard: (id, patch) =>
    set((state) => {
      if (!state.document) return state

      const current = state.document.artboards.find((artboard) => artboard.id === id)
      if (current?.designSpec && ['x', 'y', 'width', 'height'].some((key) => key in patch)) {
        const nextArtboard = { ...current, ...patch }
        const schema = {
          ...current.designSpec,
          viewport: {
            width: Math.max(320, Number(patch.width ?? current.designSpec.viewport.width)),
            height: Math.max(320, Number(patch.height ?? current.designSpec.viewport.height)),
          },
        }
        const transaction = compileDesignSpecSceneTransaction({
          artboard: nextArtboard,
          renderSchema: schema,
          comparisonSchema: schema,
          previousSchema: current.designSpec,
          currentElements: state.document.elements,
          replaceAll: true,
        })
        const nextIds = new Set(transaction.nextElements.map((element) => element.id))
        return {
          document: {
            ...state.document,
            version: state.document.version + 1,
            artboards: state.document.artboards.map((artboard) =>
              artboard.id === id
                ? {
                    ...nextArtboard,
                    designBreakpointId: undefined,
                    width: schema.viewport.width,
                    height: transaction.contentHeight,
                    designSpec: schema,
                    genericUiSchema: schema,
                  }
                : artboard,
            ),
            elements: transaction.nextElements,
            updatedAt: new Date().toISOString(),
          },
          selectedElementIds: state.selectedElementIds.filter((elementId) =>
            nextIds.has(elementId),
          ),
          history: pushHistory(state),
          future: [],
        }
      }

      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: state.document.artboards.map((artboard) =>
            artboard.id === id ? { ...artboard, ...patch } : artboard,
          ),
          updatedAt: new Date().toISOString(),
        },
        history: pushHistory(state),
        future: [],
      }
    }),

  setDesignBreakpoint: (id, breakpointId) =>
    set((state) => {
      if (!state.document) return state
      const artboard = state.document.artboards.find((item) => item.id === id)
      if (!artboard?.designSpec) return state
      const renderSchema = resolveDesignSpecBreakpoint(artboard.designSpec, breakpointId)
      const previewArtboard = {
        ...artboard,
        width: renderSchema.viewport.width,
        height: renderSchema.viewport.height,
        designBreakpointId: breakpointId,
      }
      const transaction = compileDesignSpecSceneTransaction({
        artboard: previewArtboard,
        renderSchema,
        comparisonSchema: renderSchema,
        previousSchema: artboard.designSpec,
        currentElements: state.document.elements,
        replaceAll: true,
      })
      const nextIds = new Set(transaction.nextElements.map((element) => element.id))
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: state.document.artboards.map((item) =>
            item.id === id
              ? {
                  ...previewArtboard,
                  height: transaction.contentHeight,
                }
              : item,
          ),
          elements: transaction.nextElements,
          updatedAt: new Date().toISOString(),
        },
        selectedElementIds: state.selectedElementIds.filter((elementId) => nextIds.has(elementId)),
        history: pushHistory(state),
        future: [],
      }
    }),

  upsertDesignBreakpoint: (id, breakpoint) =>
    set((state) => {
      if (!state.document) return state
      const artboard = state.document.artboards.find((item) => item.id === id)
      if (!artboard?.designSpec) return state
      const normalizedBreakpoint = {
        ...breakpoint,
        label: breakpoint.label.trim().slice(0, 40) || '自定义断点',
        viewport: {
          width: Math.max(320, Math.min(2560, Math.round(breakpoint.viewport.width))),
          height: Math.max(320, Math.min(10000, Math.round(breakpoint.viewport.height))),
        },
      }
      const current = artboard.designSpec.responsive?.breakpoints ?? DEFAULT_DESIGN_BREAKPOINTS
      const exists = current.some((item) => item.id === normalizedBreakpoint.id)
      const breakpoints = exists
        ? current.map((item) => (item.id === normalizedBreakpoint.id ? normalizedBreakpoint : item))
        : [...current, normalizedBreakpoint].slice(0, 11)
      const designSpec = {
        ...artboard.designSpec,
        responsive: { strategy: 'fluid' as const, breakpoints },
      }
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: state.document.artboards.map((item) =>
            item.id === id ? { ...item, designSpec, genericUiSchema: designSpec } : item,
          ),
          updatedAt: new Date().toISOString(),
        },
        history: pushHistory(state),
        future: [],
      }
    }),

  removeDesignBreakpoint: (id, breakpointId) =>
    set((state) => {
      if (!state.document || ['mobile', 'tablet', 'desktop'].includes(breakpointId)) return state
      const artboard = state.document.artboards.find((item) => item.id === id)
      if (!artboard?.designSpec?.responsive) return state
      const breakpoints = artboard.designSpec.responsive.breakpoints.filter(
        (item) => item.id !== breakpointId,
      )
      if (breakpoints.length === artboard.designSpec.responsive.breakpoints.length) return state
      const designSpec = {
        ...artboard.designSpec,
        responsive: { ...artboard.designSpec.responsive, breakpoints },
      }
      const responsiveBaselines = { ...artboard.responsiveBaselines }
      delete responsiveBaselines[breakpointId]
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: state.document.artboards.map((item) =>
            item.id === id
              ? {
                  ...item,
                  designSpec,
                  genericUiSchema: designSpec,
                  responsiveBaselines,
                  designBreakpointId:
                    item.designBreakpointId === breakpointId ? 'desktop' : item.designBreakpointId,
                }
              : item,
          ),
          updatedAt: new Date().toISOString(),
        },
        history: pushHistory(state),
        future: [],
      }
    }),

  captureResponsiveBaseline: (id, breakpointId) =>
    set((state) => {
      if (!state.document) return state
      const artboard = state.document.artboards.find((item) => item.id === id)
      if (!artboard?.designSpec) return state
      const preview = compileResponsivePreviews(artboard.designSpec, artboard).find(
        (item) => item.breakpoint.id === breakpointId,
      )
      if (!preview) return state
      const baseline = {
        breakpointId,
        fingerprint: preview.fingerprint,
        documentRevision: state.document.version,
        capturedAt: new Date().toISOString(),
        viewport: { ...preview.schema.viewport },
        elementCount: preview.elements.length,
      }
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: state.document.artboards.map((item) =>
            item.id === id
              ? {
                  ...item,
                  responsiveBaselines: { ...item.responsiveBaselines, [breakpointId]: baseline },
                }
              : item,
          ),
          updatedAt: new Date().toISOString(),
        },
        history: pushHistory(state),
        future: [],
      }
    }),

  clearResponsiveBaseline: (id, breakpointId) =>
    set((state) => {
      if (!state.document) return state
      const artboard = state.document.artboards.find((item) => item.id === id)
      if (!artboard?.responsiveBaselines?.[breakpointId]) return state
      const responsiveBaselines = { ...artboard.responsiveBaselines }
      delete responsiveBaselines[breakpointId]
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: state.document.artboards.map((item) =>
            item.id === id ? { ...item, responsiveBaselines } : item,
          ),
          updatedAt: new Date().toISOString(),
        },
        history: pushHistory(state),
        future: [],
      }
    }),

  applyResponsiveTokenBatch: (id, breakpointIds, patch) =>
    set((state) => {
      if (!state.document || !breakpointIds.length) return state
      const artboard = state.document.artboards.find((item) => item.id === id)
      if (!artboard?.designSpec?.responsive) return state
      const selectedIds = new Set(breakpointIds)
      const breakpoints = artboard.designSpec.responsive.breakpoints.map((breakpoint) => {
        if (!selectedIds.has(breakpoint.id)) return breakpoint
        const colors = [
          ...(breakpoint.overrides?.theme?.colors ?? artboard.designSpec!.theme.colors),
        ]
        while (colors.length < 5) colors.push('#d9dee8')
        if (patch.primaryColor) colors[3] = patch.primaryColor
        return {
          ...breakpoint,
          overrides: {
            ...breakpoint.overrides,
            theme: {
              ...breakpoint.overrides?.theme,
              ...(patch.primaryColor ? { colors } : {}),
              ...(patch.radius !== undefined
                ? { radius: Math.max(0, Math.min(32, patch.radius)) }
                : {}),
              ...(patch.density ? { density: patch.density } : {}),
            },
            layout: {
              ...breakpoint.overrides?.layout,
              ...(patch.contentPadding !== undefined
                ? { contentPadding: Math.max(0, Math.min(96, patch.contentPadding)) }
                : {}),
              ...(patch.blockGap !== undefined
                ? { blockGap: Math.max(0, Math.min(64, patch.blockGap)) }
                : {}),
              ...(patch.sidebarMode ? { sidebarMode: patch.sidebarMode } : {}),
            },
          },
        }
      })
      const designSpec = {
        ...artboard.designSpec,
        responsive: { ...artboard.designSpec.responsive, breakpoints },
      }
      const activeBreakpointId =
        artboard.designBreakpointId ??
        (artboard.width < 600 ? 'mobile' : artboard.width < 1024 ? 'tablet' : 'desktop')
      if (!selectedIds.has(activeBreakpointId)) {
        return {
          document: {
            ...state.document,
            version: state.document.version + 1,
            artboards: state.document.artboards.map((item) =>
              item.id === id ? { ...item, designSpec, genericUiSchema: designSpec } : item,
            ),
            updatedAt: new Date().toISOString(),
          },
          history: pushHistory(state),
          future: [],
        }
      }
      const renderSchema = resolveDesignSpecBreakpoint(designSpec, activeBreakpointId)
      const previewArtboard = {
        ...artboard,
        width: renderSchema.viewport.width,
        height: renderSchema.viewport.height,
      }
      const transaction = compileDesignSpecSceneTransaction({
        artboard: previewArtboard,
        renderSchema,
        comparisonSchema: renderSchema,
        previousSchema: artboard.designSpec,
        currentElements: state.document.elements,
        replaceAll: true,
      })
      const nextIds = new Set(transaction.nextElements.map((element) => element.id))
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: state.document.artboards.map((item) =>
            item.id === id
              ? {
                  ...previewArtboard,
                  height: transaction.contentHeight,
                  designSpec,
                  genericUiSchema: designSpec,
                  designBreakpointId: activeBreakpointId,
                }
              : item,
          ),
          elements: transaction.nextElements,
          updatedAt: new Date().toISOString(),
        },
        selectedElementIds: state.selectedElementIds.filter((elementId) => nextIds.has(elementId)),
        history: pushHistory(state),
        future: [],
      }
    }),

  addElement: (element) =>
    set((state) => {
      if (!state.document) return state

      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          elements: [...state.document.elements, element],
          updatedAt: new Date().toISOString(),
        },
        selectedElementIds: [element.id],
        activeArtboardId: element.artboardId ?? state.activeArtboardId,
        history: pushHistory(state),
        future: [],
      }
    }),

  groupElements: (ids) => {
    let createdGroupId: string | undefined
    set((state) => {
      if (!state.document) return state
      const groupId = createStoreId('group')
      const result = groupLayerElements(state.document.elements, ids, groupId)
      if (!result.changed) return state
      const group = result.elements.find((element) => element.id === groupId)
      const elements = relayoutLayerParents(result.elements, [group?.parentId])
      createdGroupId = groupId
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          elements,
          updatedAt: new Date().toISOString(),
        },
        selectedElementIds: result.selectedElementIds,
        selectionScopeArmed: false,
        history: pushHistory(state),
        future: [],
      }
    })
    return createdGroupId
  },

  ungroupElement: (id) => {
    let changed = false
    set((state) => {
      if (!state.document) return state
      const group = state.document.elements.find((element) => element.id === id)
      const result = ungroupLayerElement(state.document.elements, id)
      if (!result.changed) return state
      changed = true
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          elements: relayoutLayerParents(result.elements, [group?.parentId]),
          updatedAt: new Date().toISOString(),
        },
        selectedElementIds: result.selectedElementIds,
        selectionScopeArmed: false,
        history: pushHistory(state),
        future: [],
      }
    })
    return changed
  },

  moveLayer: (draggedId, targetId, position) => {
    let changed = false
    set((state) => {
      if (!state.document) return state
      const dragged = state.document.elements.find((element) => element.id === draggedId)
      const target = state.document.elements.find((element) => element.id === targetId)
      const result = moveLayerElement(state.document.elements, draggedId, targetId, position)
      if (!result.changed) return state
      changed = true
      const nextDragged = result.elements.find((element) => element.id === draggedId)
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          elements: relayoutLayerParents(result.elements, [
            dragged?.parentId,
            target?.parentId,
            nextDragged?.parentId,
          ]),
          updatedAt: new Date().toISOString(),
        },
        selectedElementIds: result.selectedElementIds,
        selectionScopeArmed: false,
        history: pushHistory(state),
        future: [],
      }
    })
    return changed
  },

  changeLayerOrder: (ids, action) => {
    let changed = false
    set((state) => {
      if (!state.document) return state
      const first = state.document.elements.find((element) => ids.includes(element.id))
      const result = changeLayerOrderInTree(state.document.elements, ids, action)
      if (!result.changed) return state
      changed = true
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          elements: relayoutLayerParents(result.elements, [first?.parentId]),
          updatedAt: new Date().toISOString(),
        },
        selectedElementIds: result.selectedElementIds,
        history: pushHistory(state),
        future: [],
      }
    })
    return changed
  },

  removeElements: (ids) =>
    set((state) => {
      if (!state.document) return state

      const removalIds = new Set(ids)
      let changed = true
      while (changed) {
        changed = false
        for (const element of state.document.elements) {
          if (element.parentId && removalIds.has(element.parentId) && !removalIds.has(element.id)) {
            removalIds.add(element.id)
            changed = true
          }
        }
      }
      const removedInstanceIds = new Set(
        state.document.elements
          .filter((element) => removalIds.has(element.id) && element.type === 'section')
          .map((element) => element.componentBinding?.instanceId)
          .filter((value): value is string => Boolean(value)),
      )
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          componentInstances: Object.fromEntries(
            Object.entries(state.document.componentInstances ?? {}).filter(
              ([instanceId]) => !removedInstanceIds.has(instanceId),
            ),
          ),
          elements: state.document.elements.filter((element) => !removalIds.has(element.id)),
          updatedAt: new Date().toISOString(),
        },
        selectedElementIds: state.selectedElementIds.filter((id) => !removalIds.has(id)),
        history: pushHistory(state),
        future: [],
      }
    }),

  removeArtboard: (id) =>
    set((state) => {
      if (!state.document) return state
      const hasArtboard = state.document.artboards.some((artboard) => artboard.id === id)
      if (!hasArtboard) return state
      const nextArtboards = state.document.artboards.filter((artboard) => artboard.id !== id)
      const nextElements = state.document.elements.filter((element) => element.artboardId !== id)
      const nextActiveArtboardId =
        state.activeArtboardId === id ? nextArtboards[0]?.id : state.activeArtboardId

      return {
        document: {
          ...state.document,
          artboards: nextArtboards,
          elements: nextElements,
          componentInstances: Object.fromEntries(
            Object.entries(state.document.componentInstances ?? {}).filter(
              ([, instance]) => instance.artboardId !== id,
            ),
          ),
          updatedAt: new Date().toISOString(),
        },
        activeArtboardId: nextActiveArtboardId,
        selectedArtboardId: state.selectedArtboardId === id ? undefined : state.selectedArtboardId,
        chatThreads: state.chatThreads.map((thread) =>
          (thread.artboardIds ?? []).includes(id) || thread.targetArtboardId === id
            ? {
                ...thread,
                targetArtboardId:
                  thread.targetArtboardId === id ? undefined : thread.targetArtboardId,
                activeTargetArtboardId:
                  thread.activeTargetArtboardId === id ? undefined : thread.activeTargetArtboardId,
                assetArtboardId: thread.assetArtboardId === id ? undefined : thread.assetArtboardId,
                artboardIds: (thread.artboardIds ?? []).filter((artboardId) => artboardId !== id),
              }
            : thread,
        ),
        selectedElementIds: state.selectedElementIds.filter((elementId) =>
          nextElements.some((element) => element.id === elementId),
        ),
        history: pushHistory(state),
        future: [],
      }
    }),

  undo: () =>
    set((state) => {
      const previous = state.history.at(-1)
      if (!previous || !state.document) return state

      return {
        document: previous,
        history: state.history.slice(0, -1),
        future: [state.document, ...state.future],
        selectedElementIds: [],
        selectedArtboardId: undefined,
      }
    }),

  redo: () =>
    set((state) => {
      const next = state.future[0]
      if (!next || !state.document) return state

      return {
        document: next,
        history: [...state.history, state.document],
        future: state.future.slice(1),
        selectedElementIds: [],
        selectedArtboardId: undefined,
      }
    }),
}))
