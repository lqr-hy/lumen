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
  MIN_CONVERSATION_FOCUS_ZOOM,
} from '../constants'
import type { PlacementMode } from '../utils/placement-intent'
import type { BlueprintConfirmation } from '../../ai/types'
import { layoutSectionChildren } from '../utils/auto-layout'
import {
  createComponentInstance,
  normalizeComponentInstances,
} from '../utils/component-instances'

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
}

export interface EditorChatImage {
  id: string
  name: string
  src: string
  elementId?: string
}

export interface EditorChatTextReference {
  id: string
  text: string
  elementId?: string
  insertOffset?: number
}

export interface EditorChatMessage {
  id: string
  role: 'user' | 'agent'
  text: string
  referenceImages?: EditorChatImage[]
  pending?: boolean
  confirmation?: BlueprintConfirmation
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
  prompt: string
  referenceImages: EditorChatImage[]
  textReferences: EditorChatTextReference[]
  messages: EditorChatMessage[]
}

export interface ChatArtboardTarget {
  artboardId: string
  created: boolean
  mode: Exclude<PlacementMode, 'auto'>
  parentArtboardId?: string
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
  visualShell?: GeneratedArtboardImage
}

export interface EditorWorkspaceSnapshot {
  document: DesignDocument
  chatThreads: EditorChatThread[]
  activeChatThreadId: string
}

interface EditorState {
  document: DesignDocument | null
  viewport: ViewportState
  selectedElementIds: string[]
  activeArtboardId?: string
  selectedArtboardId?: string
  tool: EditorTool
  queuedReferenceImages: QueuedReferenceImage[]
  queuedChatTexts: QueuedChatText[]
  chatThreads: EditorChatThread[]
  activeChatThreadId: string
  history: DesignDocument[]
  future: DesignDocument[]
  setDocument: (document: DesignDocument) => void
  hydrateWorkspace: (snapshot: EditorWorkspaceSnapshot) => void
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
  ) => ChatArtboardTarget | undefined
  applyGeneratedImage: (
    target: ChatArtboardTarget,
    image: GeneratedArtboardImage,
  ) => string | undefined
  applyComponentDesign: (
    target: ChatArtboardTarget,
    componentDesign: ComponentDesignMeta,
    assets: GeneratedArtboardImage[],
    visualShell?: GeneratedArtboardImage,
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
  applyComponentSlotImage: (
    elementId: string,
    image: GeneratedArtboardImage,
  ) => boolean
  applyPageShellImage: (elementId: string, image: GeneratedArtboardImage) => boolean
  setTool: (tool: EditorTool) => void
  selectElement: (id: string, options?: { append?: boolean }) => void
  setSelectedElements: (ids: string[], options?: { append?: boolean }) => void
  selectArtboard: (id: string) => void
  clearSelection: () => void
  updateElement: (id: string, patch: Partial<DesignElement>) => void
  updateElements: (patches: Array<{ id: string; patch: Partial<DesignElement> }>) => void
  addArtboard: (artboard: Artboard) => void
  updateArtboard: (id: string, patch: Partial<Artboard>) => void
  addElement: (element: DesignElement) => void
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
  tool: 'select',
  queuedReferenceImages: [],
  queuedChatTexts: [],
  chatThreads: [createDefaultChatThread()],
  activeChatThreadId: 'panel-thread-default',
  history: [],
  future: [],

  setDocument: (document) =>
    set((state) => {
      const normalizedDocument = normalizeComponentInstances(document)
      return {
        document: normalizedDocument,
        viewport:
          state.document?.id === document.id
            ? state.viewport
            : normalizedDocument.viewport ?? { ...DEFAULT_CANVAS_VIEWPORT },
        selectedElementIds: [],
        activeArtboardId: normalizedDocument.artboards[0]?.id,
        selectedArtboardId: undefined,
        history: [],
        future: [],
      }
    }),

  hydrateWorkspace: (snapshot) => {
    const normalizedDocument = normalizeComponentInstances(snapshot.document)
    set({
      document: normalizedDocument,
      viewport: normalizedDocument.viewport ?? { ...DEFAULT_CANVAS_VIEWPORT },
      selectedElementIds: [],
      activeArtboardId: normalizedDocument.artboards[0]?.id,
      selectedArtboardId: undefined,
      queuedReferenceImages: [],
      queuedChatTexts: [],
      chatThreads: snapshot.chatThreads.length
        ? normalizePersistedChatThreads(snapshot.chatThreads)
        : [createDefaultChatThread()],
      activeChatThreadId: snapshot.chatThreads.some((thread) => thread.id === snapshot.activeChatThreadId)
        ? snapshot.activeChatThreadId
        : snapshot.chatThreads[0]?.id ?? 'panel-thread-default',
      history: [],
      future: [],
    })
  },

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
      chatThreads: state.chatThreads.map((thread) =>
        thread.id === id ? updater(thread) : thread,
      ),
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
            ? nextThreads[0]?.id ?? 'panel-thread-default'
            : state.activeChatThreadId,
      }
    }),

  appendChatMessage: (threadId, message) =>
    set((state) => ({
      chatThreads: state.chatThreads.map((thread) =>
        thread.id === threadId
          ? { ...thread, messages: [...thread.messages, message] }
          : thread,
      ),
    })),

  ensureChatThreadArtboard: (threadId, requestedMode = 'auto') => {
    let target: ChatArtboardTarget | undefined
    set((state) => {
      if (!state.document) return state
      const thread = state.chatThreads.find((item) => item.id === threadId)
      if (!thread) return state

      const mode = requestedMode === 'auto' ? 'append-section' : requestedMode

      const selectedElement = state.document.elements.find((element) =>
        state.selectedElementIds.includes(element.id),
      )
      const candidates = [
        selectedElement?.artboardId,
        state.selectedArtboardId,
        thread.activeTargetArtboardId,
        thread.targetArtboardId,
      ]
      const selectedTargetId = candidates.find((candidate) =>
        state.document?.artboards.some((artboard) => artboard.id === candidate),
      )
      const threadTargetArtboard = thread.activeTargetArtboardId || thread.targetArtboardId
      const reusableEmptyArtboardId = mode === 'new-artboard' &&
        threadTargetArtboard &&
        state.document.artboards.some((artboard) => artboard.id === threadTargetArtboard) &&
        !state.document.elements.some((element) => element.artboardId === threadTargetArtboard)
        ? threadTargetArtboard
        : undefined
      const existingArtboardId = mode === 'asset-board'
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
            item.id === threadId
              ? bindThreadToArtboard(item, existingArtboardId, mode)
              : item,
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
        name: mode === 'asset-board'
          ? '独立素材'
          : mode === 'duplicate-variant'
            ? `${sourceArtboard?.name || '页面'} 变体`
            : thread.title === '未命名对话' || thread.title === '新对话'
              ? `AI 页面 ${(thread.artboardIds?.length ?? 0) + 1}`
              : thread.title,
        x: state.document.artboards.length ? maxX + ARTBOARD_GAP : 0,
        y: 0,
        width: mode === 'duplicate-variant'
          ? sourceArtboard?.width ?? DEFAULT_ARTBOARD_WIDTH
          : DEFAULT_ARTBOARD_WIDTH,
        height: mode === 'duplicate-variant'
          ? sourceArtboard?.height ?? DEFAULT_ARTBOARD_HEIGHT
          : DEFAULT_ARTBOARD_HEIGHT,
        background: sourceArtboard?.background ?? '#ffffff',
        borderRadius: 0,
        overflow: 'hidden',
        autoHeight: true,
      }
      const sourceElements = mode === 'duplicate-variant' && sourceArtboard
        ? state.document.elements.filter((element) => element.artboardId === sourceArtboard.id)
        : []
      const elementIdMap = new Map(sourceElements.map((element, index) => [
        element.id,
        createStoreId(`${element.type}-variant-${index}`),
      ]))
      const sourceInstanceIds = Array.from(new Set(sourceElements
        .map((element) => element.componentBinding?.instanceId)
        .filter((value): value is string => Boolean(value))))
      const instanceIdMap = new Map(sourceInstanceIds.map((instanceId) => [
        instanceId,
        createStoreId('component-instance'),
      ]))
      const clonedElements = sourceElements.map((element) => {
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
          componentBinding: binding && nextInstanceId
            ? {
                ...binding,
                instanceId: nextInstanceId,
                rootElementId: elementIdMap.get(binding.rootElementId) ?? id,
              }
            : binding,
        } as DesignElement
      })
      const clonedInstances = Object.fromEntries(sourceInstanceIds.flatMap((sourceInstanceId) => {
        const sourceInstance = state.document?.componentInstances?.[sourceInstanceId]
        const instanceId = instanceIdMap.get(sourceInstanceId)
        const rootElementId = sourceInstance
          ? elementIdMap.get(sourceInstance.rootElementId)
          : undefined
        if (!sourceInstance || !instanceId || !rootElementId) return []
        return [[instanceId, createComponentInstance(
          sourceInstance.design,
          artboard.id,
          rootElementId,
          instanceId,
        )]]
      }))
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
      const assetScale = image.width >= DEFAULT_ARTBOARD_WIDTH * 1.8
        ? Math.min(0.5, DEFAULT_ARTBOARD_WIDTH / image.width)
        : Math.min(1, (DEFAULT_ARTBOARD_WIDTH - GENERATED_CONTENT_GAP * 2) / image.width)
      const widthScale = isIndependentAsset
        ? assetScale
        : DEFAULT_ARTBOARD_WIDTH / image.width
      const autoHeightImageWidth = isIndependentAsset
        ? Math.max(1, image.width * widthScale)
        : DEFAULT_ARTBOARD_WIDTH
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
        ? artboard.x + (DEFAULT_ARTBOARD_WIDTH - width) / 2
        : artboard.x + (artboard.width - width) / 2
      const y = usesAutoHeight
        ? autoHeightY
        : artboard.y + (artboard.height - height) / 2
      const targetArtboard = usesAutoHeight
        ? {
            ...artboard,
            width: DEFAULT_ARTBOARD_WIDTH,
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
      const zIndex = Math.max(
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

  applyComponentDesign: (target, componentDesign, assets, visualShell, replaceInstanceId, explicitPageSectionId) => {
    let rootElementId: string | undefined
    set((state) => {
      if (!state.document) return state
      const artboard = state.document.artboards.find((item) => item.id === target.artboardId)
      if (!artboard) return state

      const replacesVariant = target.mode === 'duplicate-variant'
      const replacedRoot = !replacesVariant && replaceInstanceId
        ? state.document.elements.find((element) => (
            element.artboardId === target.artboardId &&
            element.componentBinding?.instanceId === replaceInstanceId &&
            element.componentBinding.renderMode === 'root'
          ))
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
      const originY = replacedRoot?.y ?? (
        artboardElements.length ? contentBottom + GENERATED_CONTENT_GAP : artboard.y
      )
      const scale = DEFAULT_ARTBOARD_WIDTH / componentDesign.blueprint.width
      const rootWidth = DEFAULT_ARTBOARD_WIDTH
      const rootHeight = Math.max(1, componentDesign.blueprint.height * scale)
      const originX = replacedRoot?.x ?? artboard.x
      const baseZIndex = replacedRoot?.zIndex ?? (
        Math.max(0, ...artboardElements.map((element) => element.zIndex)) + 1
      )
      const instanceId = replacesInstance ? replaceInstanceId! : createStoreId('component-instance')
      rootElementId = replacedRoot?.id ?? createStoreId('component-section')
      const pageSectionId = explicitPageSectionId ?? replacedRoot?.componentBinding?.pageSectionId
      const pageSectionLocked = replacedRoot?.locked === true
      const nextComponentDesign: ComponentDesignMeta = { ...componentDesign, instanceId }
      const propertyKinds = new Map(
        (componentDesign.properties ?? []).map((property) => [property.path, property.kind]),
      )
      const tasksBySlot = new Map(
        componentDesign.assetTasks.map((task, index) => [task.slotId, { task, image: assets[index] }]),
      )
      const rootElement: DesignElement = {
        id: rootElementId,
        artboardId: target.artboardId,
        type: 'section',
        name: `${componentDesign.componentName} 组件`,
        label: `${componentDesign.componentName} / ${componentDesign.profile}`,
        x: originX,
        y: originY,
        width: rootWidth,
        height: rootHeight,
        zIndex: baseZIndex,
        locked: pageSectionLocked,
        componentBinding: {
          instanceId,
          componentName: componentDesign.componentName,
          profile: componentDesign.profile,
          regionId: 'root',
          renderMode: 'root',
          rootElementId,
          pageSectionId,
          propPaths: [],
          bindings: {},
        },
      }
      const shellElement: DesignElement | undefined = visualShell
        ? {
            id: createStoreId('component-shell'),
            artboardId: target.artboardId,
            parentId: rootElementId,
            type: 'image',
            name: `${componentDesign.componentName} 视觉外壳`,
            x: originX,
            y: originY,
            width: rootWidth,
            height: rootHeight,
            zIndex: baseZIndex + 1,
            locked: pageSectionLocked,
            src: visualShell.src,
            objectFit: 'fill',
            componentBinding: {
              instanceId,
              componentName: componentDesign.componentName,
              profile: componentDesign.profile,
              regionId: 'visual-shell',
              renderMode: 'shell',
              rootElementId,
              pageSectionId,
              propPaths: [],
              bindings: {},
            },
          }
        : undefined
      const regionElements = componentDesign.blueprint.regions.map((region, index) => {
        const slotAsset = region.slotId ? tasksBySlot.get(region.slotId) : undefined
        const bindings = createComponentBindings(
          region.propBindings,
          propertyKinds,
          slotAsset?.task.propPath,
        )
        const base = {
          id: createStoreId(`component-${region.renderMode}`),
          artboardId: target.artboardId,
          parentId: rootElementId,
          name: region.role,
          x: originX + region.bounds.x * scale,
          y: originY + region.bounds.y * scale,
          width: Math.max(1, region.bounds.width * scale),
          height: Math.max(1, region.bounds.height * scale),
          zIndex: baseZIndex + index + (shellElement ? 2 : 1),
          locked: pageSectionLocked,
          componentBinding: {
            instanceId,
            componentName: componentDesign.componentName,
            profile: componentDesign.profile,
            regionId: region.id,
            slotId: region.slotId,
            renderMode: region.renderMode,
            rootElementId,
            pageSectionId,
            propPaths: region.propBindings,
            bindings,
          },
        }
        if (region.renderMode === 'generated-asset' && slotAsset?.image) {
          return {
            ...base,
            type: 'image',
            src: slotAsset.image.src,
            objectFit: 'fill',
          } as DesignElement
        }
        if (region.renderMode === 'color') {
          const fill = readRegionColor(
            region.propBindings,
            componentDesign.blueprint.propertyValues,
            readThemeColor(componentDesign, 'background', '#e5e7eb'),
          )
          return {
            ...base,
            type: 'shape',
            shape: 'rect',
            fill,
            borderRadius: componentDesign.blueprint.visualTheme?.surfaces?.[0]?.radius ?? 0,
          } as DesignElement
        }
        if (region.renderMode === 'text') {
          const typography = readThemeTypography(componentDesign, 'body')
          return {
            ...base,
            type: 'text',
            content: region.content || region.role,
            style: {
              fontSize: typography?.size ?? Math.max(12, Math.min(32, region.bounds.height * scale * 0.42)),
              fontWeight: typography?.weight ?? 700,
              fontFamily: typography?.family,
              color: readRegionColor(
                region.propBindings,
                componentDesign.blueprint.propertyValues,
                readThemeColor(componentDesign, 'text', '#111827'),
              ),
              lineHeight: typography?.lineHeight ?? 1.3,
              textAlign: 'center',
            },
          } as DesignElement
        }
        return {
          ...base,
          type: 'runtime-placeholder',
          label: region.role,
        } as DesignElement
      })
      const nextAssets = assets.map((image) => ({
        id: createStoreId('asset'),
        type: 'image' as const,
        name: image.name,
        src: image.src,
      }))
      if (visualShell) {
        nextAssets.unshift({
          id: createStoreId('asset'),
          type: 'image' as const,
          name: visualShell.name,
          src: visualShell.src,
        })
      }
      const nextArtboard: Artboard = {
        ...artboard,
        width: DEFAULT_ARTBOARD_WIDTH,
        height: Math.max(artboard.height, originY - artboard.y + rootHeight),
        autoHeight: true,
      }
      const retainedInstances = Object.fromEntries(Object.entries(
        state.document.componentInstances ?? {},
      ).filter(([id, instance]) => (
        id !== replaceInstanceId && !(replacesVariant && instance.artboardId === artboard.id)
      )))

      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: state.document.artboards.map((item) => (
            item.id === artboard.id ? nextArtboard : item
          )),
          elements: [
            ...retainedElements,
            rootElement,
            ...(shellElement ? [shellElement] : []),
            ...regionElements,
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
    const rootElementIds = components.map((component, index) => {
      const pageSectionId = component.pageSectionId ?? pageDesign.blueprint.sections[component.index ?? index]?.id
      const existingInstanceId = get().document?.elements.find((element) => (
        element.artboardId === target.artboardId &&
        element.componentBinding?.pageSectionId === pageSectionId &&
        element.componentBinding.renderMode === 'root'
      ))?.componentBinding?.instanceId
      return get().applyComponentDesign(
      index === 0
        ? target
        : { ...target, created: false, mode: 'append-section' },
      component.componentDesign,
      component.assets,
      component.visualShell,
      existingInstanceId,
      pageSectionId,
      )
    }).filter((id): id is string => Boolean(id))

    set((state) => {
      if (!state.document) return state
      const artboard = state.document.artboards.find((item) => item.id === target.artboardId)
      if (!artboard) return state
      const artboardElements = state.document.elements.filter((element) => element.artboardId === artboard.id)
      const sectionByInstance = new Map(rootElementIds.map((rootId, index) => {
        const root = state.document?.elements.find((element) => element.id === rootId)
        const component = components[index]
        return [root?.componentBinding?.instanceId, pageDesign.blueprint.sections[component.index ?? index]] as const
      }).filter((entry): entry is readonly [string, PageDesignMeta['blueprint']['sections'][number]] => (
        Boolean(entry[0] && entry[1])
      )))
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
      const existingShell = state.document.elements.find((element) => (
        element.artboardId === artboard.id && element.designRole === 'page-shell'
      ))
      const shellElementId = existingShell?.id ?? createStoreId('page-shell')
      const shellElement: DesignElement = {
        id: shellElementId,
        artboardId: artboard.id,
        type: 'image',
        name: '页面视觉外壳',
        x: artboard.x,
        y: artboard.y,
        width: DEFAULT_ARTBOARD_WIDTH,
        height,
        zIndex: Math.min(0, ...artboardElements.map((element) => element.zIndex)) - 1,
        src: pageShell.src,
        objectFit: 'fill',
        designRole: 'page-shell',
      }
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: state.document.artboards.map((item) => item.id === artboard.id
            ? { ...item, width: DEFAULT_ARTBOARD_WIDTH, height, autoHeight: true, pageDesign }
            : item),
          elements: [
            ...state.document.elements.filter((element) => element.id !== shellElementId).map((element): DesignElement => {
              const binding = element.componentBinding
              const section = binding ? sectionByInstance.get(binding.instanceId) : undefined
              return section
                ? {
                    ...element,
                    locked: section.locked === true,
                    componentBinding: {
                      ...binding,
                      pageSectionId: section.id,
                    },
                  } as DesignElement
                : element
            }),
            ...structuralElements.map((item) => item.element),
            shellElement,
          ],
          structuralInstances: {
            ...(state.document.structuralInstances ?? {}),
            ...Object.fromEntries(structuralElements.map((item) => [item.structuralId, item.instance])),
          },
          assets: [...state.document.assets, {
            id: createStoreId('asset'),
            type: 'image',
            name: pageShell.name,
            src: pageShell.src,
          }],
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
      const existingShell = state.document.elements.find((element) => (
        element.artboardId === artboard.id && element.designRole === 'page-shell'
      ))
      shellElementId = existingShell?.id ?? createStoreId('page-shell')
      const retainedElements = state.document.elements.filter((element) => element.id !== shellElementId)
      const height = Math.max(DEFAULT_ARTBOARD_HEIGHT, blueprint.estimatedHeight)
      const shellElement: DesignElement = {
        id: shellElementId,
        artboardId: artboard.id,
        type: 'image',
        name: pageShell.name || '页面视觉外壳',
        x: artboard.x,
        y: artboard.y,
        width: DEFAULT_ARTBOARD_WIDTH,
        height,
        zIndex: Math.min(0, ...retainedElements
          .filter((element) => element.artboardId === artboard.id)
          .map((element) => element.zIndex)) - 1,
        src: pageShell.src,
        objectFit: 'fill',
        designRole: 'page-shell',
      }
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: state.document.artboards.map((item) => item.id === artboard.id
            ? { ...item, width: DEFAULT_ARTBOARD_WIDTH, height, autoHeight: true }
            : item),
          elements: [...retainedElements, shellElement],
          assets: [...state.document.assets, {
            id: createStoreId('asset'),
            type: 'image',
            name: pageShell.name,
            src: pageShell.src,
          }],
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
      const instanceIds = new Set(state.document.elements
        .filter((element) => element.componentBinding?.pageSectionId === sectionId)
        .map((element) => element.componentBinding?.instanceId)
        .filter((id): id is string => Boolean(id)))
      if (!instanceIds.size) return state
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          artboards: state.document.artboards.map((artboard) => artboard.pageDesign
            ? {
                ...artboard,
                pageDesign: {
                  ...artboard.pageDesign,
                  blueprint: {
                    ...artboard.pageDesign.blueprint,
                    sections: artboard.pageDesign.blueprint.sections.map((section) => (
                      section.id === sectionId ? { ...section, locked } : section
                    )),
                  },
                },
              }
            : artboard),
          elements: state.document.elements.map((element) => (
            element.componentBinding && instanceIds.has(element.componentBinding.instanceId)
              ? { ...element, locked }
              : element
          )),
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
      const section = state.document.elements.find((element) => element.id === elementId)
      if (!section || section.type !== 'section') return state
      const nextSection = { ...section, autoLayout }
      const patches = new Map(
        layoutSectionChildren(nextSection, state.document.elements).map((item) => [item.id, item.patch]),
      )
      return {
        document: {
          ...state.document,
          version: state.document.version + 1,
          elements: state.document.elements.map((element) => element.id === elementId
            ? nextSection
            : patches.has(element.id)
              ? { ...element, ...patches.get(element.id) }
              : element),
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
          elements: state.document.elements.map((item) => item.id === elementId
            ? { ...item, src: image.src, name: image.name }
            : item),
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
          elements: state.document.elements.map((item) => item.id === elementId
            ? { ...item, src: image.src, name: image.name }
            : item),
          assets: [...state.document.assets, {
            id: createStoreId('asset'),
            type: 'image',
            name: image.name,
            src: image.src,
          }],
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
        activeArtboardId: element?.artboardId ?? state.activeArtboardId,
        selectedArtboardId: undefined,
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
        activeArtboardId: element?.artboardId ?? state.activeArtboardId,
        selectedArtboardId: undefined,
      }
    }),

  selectArtboard: (id) => set({
    activeArtboardId: id,
    selectedArtboardId: id,
    selectedElementIds: [],
  }),

  clearSelection: () => set({ selectedElementIds: [], selectedArtboardId: undefined }),

  updateElement: (id, patch) =>
    set((state) => {
      if (!state.document) return state
      const nextElements = applyElementPatches(
        state.document.elements,
        [{ id, patch }],
      )
      const nextComponentInstances = syncComponentInstancesFromElements(
        state.document.componentInstances ?? {},
        nextElements,
        new Set(nextElements
          .filter((element) => element.id === id || element.parentId === id)
          .map((element) => element.id)),
      )

      return {
        document: {
          ...state.document,
          componentInstances: nextComponentInstances,
          elements: nextElements,
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
      const changedIds = new Set(patches.flatMap((item) => [
        item.id,
        ...nextElements
          .filter((element) => element.parentId === item.id)
          .map((element) => element.id),
      ]))

      return {
        document: {
          ...state.document,
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

  addArtboard: (artboard) =>
    set((state) => {
      if (!state.document) return state

      return {
        document: {
          ...state.document,
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

      return {
        document: {
          ...state.document,
          artboards: state.document.artboards.map((artboard) =>
            artboard.id === id ? { ...artboard, ...patch } : artboard,
          ),
          updatedAt: new Date().toISOString(),
        },
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
          elements: [...state.document.elements, element],
          updatedAt: new Date().toISOString(),
        },
        selectedElementIds: [element.id],
        activeArtboardId: element.artboardId ?? state.activeArtboardId,
        history: pushHistory(state),
        future: [],
      }
    }),

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
      const removedInstanceIds = new Set(state.document.elements
        .filter((element) => removalIds.has(element.id) && element.type === 'section')
        .map((element) => element.componentBinding?.instanceId)
        .filter((value): value is string => Boolean(value)))
      return {
        document: {
          ...state.document,
          componentInstances: Object.fromEntries(Object.entries(
            state.document.componentInstances ?? {},
          ).filter(([instanceId]) => !removedInstanceIds.has(instanceId))),
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
        state.activeArtboardId === id
          ? nextArtboards[0]?.id
          : state.activeArtboardId

      return {
        document: {
          ...state.document,
          artboards: nextArtboards,
          elements: nextElements,
          componentInstances: Object.fromEntries(Object.entries(
            state.document.componentInstances ?? {},
          ).filter(([, instance]) => instance.artboardId !== id)),
          updatedAt: new Date().toISOString(),
        },
        activeArtboardId: nextActiveArtboardId,
        selectedArtboardId: state.selectedArtboardId === id ? undefined : state.selectedArtboardId,
        chatThreads: state.chatThreads.map((thread) =>
          (thread.artboardIds ?? []).includes(id) || thread.targetArtboardId === id
            ? {
                ...thread,
                targetArtboardId: thread.targetArtboardId === id ? undefined : thread.targetArtboardId,
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

function createDefaultChatThread(): EditorChatThread {
  return {
    id: 'panel-thread-default',
    title: '未命名对话',
    artboardIds: [],
    placementMode: 'auto',
    prompt: '',
    referenceImages: [],
    textReferences: [],
    messages: [],
  }
}

function normalizePersistedChatThreads(threads: EditorChatThread[]) {
  return threads.map((thread) => ({
    ...thread,
    messages: thread.messages.map((message) => message.pending
      ? {
          ...message,
          pending: false,
          text: '上次任务在应用重启前中断，未继续执行。请点击“继续”恢复任务。',
        }
      : message),
  }))
}

function bindThreadToArtboard(
  thread: EditorChatThread,
  artboardId: string,
  mode: Exclude<PlacementMode, 'auto'>,
): EditorChatThread {
  return {
    ...thread,
    targetArtboardId: artboardId,
    activeTargetArtboardId: artboardId,
    assetArtboardId: mode === 'asset-board' ? artboardId : thread.assetArtboardId,
    artboardIds: Array.from(new Set([...(thread.artboardIds ?? []), artboardId])),
    lastPlacementMode: mode,
  }
}

function focusConversationArtboard(viewport: ViewportState, artboard: Artboard): ViewportState {
  if (viewport.zoom >= MIN_CONVERSATION_FOCUS_ZOOM) return viewport

  const zoom = DEFAULT_CANVAS_VIEWPORT.zoom
  return {
    x: DEFAULT_CANVAS_VIEWPORT.x - artboard.x * zoom,
    y: DEFAULT_CANVAS_VIEWPORT.y - artboard.y * zoom,
    zoom,
  }
}

function createStoreId(prefix: string) {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${suffix}`
}

function createComponentBindings(
  propPaths: string[],
  propertyKinds: Map<string, string>,
  imagePath?: string,
) {
  const bindings: NonNullable<DesignElement['componentBinding']>['bindings'] = {}
  for (const path of propPaths) {
    const kind = propertyKinds.get(path)
    if (kind === 'width' || kind === 'height' || kind === 'x' || kind === 'y') {
      bindings[kind] = path
    } else if (kind === 'color') {
      bindings.color = path
    } else if (kind === 'visibility') {
      bindings.visible = path
    }
  }
  if (imagePath) bindings.image = imagePath
  return bindings
}

function readRegionColor(
  propPaths: string[],
  propertyValues: Record<string, unknown>,
  fallback = '#e5e7eb',
) {
  const color = propPaths
    .map((path) => propertyValues[path])
    .find((value): value is string => (
      typeof value === 'string' && /^(?:#|rgb|hsl|transparent)/i.test(value)
    ))
  return color ?? fallback
}

function readThemeColor(
  design: ComponentDesignMeta,
  role: 'primary' | 'secondary' | 'background' | 'surface' | 'text' | 'accent',
  fallback: string,
) {
  const theme = design.blueprint.visualTheme
  return theme?.colorTokens?.find((token) => token.role === role)?.value ?? (
    role === 'text' ? theme?.colors[2] : role === 'background' ? theme?.colors[1] : theme?.colors[0]
  ) ?? fallback
}

function readThemeTypography(
  design: ComponentDesignMeta,
  role: 'display' | 'heading' | 'body' | 'caption' | 'button',
) {
  const typography = design.blueprint.visualTheme?.typography ?? []
  return typography.find((token) => token.role === role) ?? typography[0]
}

function setNestedPatchValue(target: Record<string, unknown>, path: string, value: unknown) {
  const segments = path.split('.').filter(Boolean)
  if (!segments.length) return
  let current: Record<string, unknown> = target
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    const existing = current[segment]
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }
  current[segments.at(-1)!] = value
}

function applyElementPatches(
  elements: DesignElement[],
  patches: Array<{ id: string; patch: Partial<DesignElement> }>,
) {
  const patchMap = new Map(patches.map((item) => [item.id, item.patch]))
  for (const item of patches) {
    const root = elements.find((element) => element.id === item.id)
    if (!root || root.type !== 'section') continue
    const nextX = Number.isFinite(item.patch.x) ? item.patch.x! : root.x
    const nextY = Number.isFinite(item.patch.y) ? item.patch.y! : root.y
    const nextWidth = Number.isFinite(item.patch.width) ? Math.max(1, item.patch.width!) : root.width
    const nextHeight = Number.isFinite(item.patch.height) ? Math.max(1, item.patch.height!) : root.height
    const scaleX = nextWidth / Math.max(1, root.width)
    const scaleY = nextHeight / Math.max(1, root.height)
    for (const child of elements.filter((element) => element.parentId === root.id)) {
      if (patchMap.has(child.id)) continue
      patchMap.set(child.id, {
        x: nextX + (child.x - root.x) * scaleX,
        y: nextY + (child.y - root.y) * scaleY,
        width: Math.max(1, child.width * scaleX),
        height: Math.max(1, child.height * scaleY),
      })
    }
  }
  return elements.map((element) => {
    const patch = patchMap.get(element.id)
    return patch ? ({ ...element, ...patch } as DesignElement) : element
  })
}

function syncComponentInstancesFromElements(
  componentInstances: NonNullable<DesignDocument['componentInstances']>,
  elements: DesignElement[],
  changedIds: Set<string>,
) {
  return Object.fromEntries(Object.entries(componentInstances).map(([instanceId, instance]) => {
      const designElements = elements.filter((element) => (
        changedIds.has(element.id) &&
        element.componentBinding?.instanceId === instanceId &&
        element.componentBinding.renderMode !== 'root'
      ))
      if (!designElements.length) return [instanceId, instance]
      const propsPatch = structuredClone(instance.design.propsPatch)
      for (const element of designElements) {
        const binding = element.componentBinding!
        const root = elements.find((item) => item.id === binding.rootElementId)
        if (!root) continue
        const scaleX = root.width / Math.max(1, instance.design.blueprint.width)
        const scaleY = root.height / Math.max(1, instance.design.blueprint.height)
        if (binding.bindings.x) {
          setNestedPatchValue(propsPatch, binding.bindings.x, (element.x - root.x) / scaleX)
        }
        if (binding.bindings.y) {
          setNestedPatchValue(propsPatch, binding.bindings.y, (element.y - root.y) / scaleY)
        }
        if (binding.bindings.width) {
          setNestedPatchValue(propsPatch, binding.bindings.width, element.width / scaleX)
        }
        if (binding.bindings.height) {
          setNestedPatchValue(propsPatch, binding.bindings.height, element.height / scaleY)
        }
        if (binding.bindings.visible) {
          setNestedPatchValue(propsPatch, binding.bindings.visible, element.visible !== false)
        }
        if (binding.bindings.image && element.type === 'image') {
          setNestedPatchValue(propsPatch, binding.bindings.image, element.src)
        }
        if (binding.bindings.color) {
          const color = getElementColor(element)
          if (color) setNestedPatchValue(propsPatch, binding.bindings.color, color)
        }
      }
      return [instanceId, {
        ...instance,
        design: { ...instance.design, propsPatch },
      }]
  }))
}

function getElementColor(element: DesignElement) {
  if (element.type === 'shape') return element.fill
  if (element.type === 'text') return element.style.color
  if (element.type === 'button') return element.style.background
  return undefined
}
