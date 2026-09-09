import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import {
  Check,
  Eraser,
  Lock,
  LockOpen,
  Paintbrush,
  RotateCcw,
  Square,
  WandSparkles,
  X,
} from 'lucide-react'
import { ElementRenderer, type ElementRendererProps } from './ElementRenderer'
import { ArtboardFrame } from './ArtboardFrame'
import { AiCanvasChat } from './AiCanvasChat'
import { CanvasStartPrompt } from './CanvasStartPrompt'
import { SelectionBox, type ResizeHandle } from './SelectionBox'
import { useEditorStore } from '../store/editor-store'
import type { Artboard, DesignElement, ImageElement, Point } from '../types'
import { clampZoom, screenToWorld, zoomAtPoint } from '../utils/coordinates'
import { rasterizeNode } from '../utils/rasterize-node'
import { buildImageDownloadName } from '../utils/image-file'
import {
  canRegenerateComponentSlot,
  createComponentSlotRegenerationText,
} from '../utils/selection-scope'
import { cn } from '../../../lib/cn'
import { findEditableMaskBounds, hasEditableImageMask } from '../utils/image-mask'
import { resolveComposerQueueTarget } from '../utils/composer-target'
import {
  collectLayerSubtreeElements,
  flattenElementsForPainting,
  isGroupElement,
  isLayerStructureEditable,
  type LayerOrderAction,
} from '../utils/layer-tree'
import {
  rectIntersectsWorldBounds,
  resolveVisibleArtboards,
  resolveVisibleWorldBounds,
} from '../utils/canvas-visibility'

interface DragState {
  mode:
    | 'pan'
    | 'move'
    | 'resize'
    | 'marquee'
    | 'move-artboard'
    | 'resize-artboard'
    | 'slice-image'
    | 'paint-mask'
  pointerId: number
  startScreen: Point
  startWorld?: Point
  startViewport?: { x: number; y: number; zoom: number }
  startElements?: DesignElement[]
  startElementById?: ReadonlyMap<string, DesignElement>
  resizeDescendantIds?: ReadonlySet<string>
  startArtboard?: Artboard
  handle?: ResizeHandle
  appendSelection?: boolean
  strokeIndex?: number
}

interface InfiniteCanvasProps {
  chatPanelOpen?: boolean
  hideAiChat?: boolean
  onOpenChatPanel?: () => void
}

interface CanvasContextMenuState {
  x: number
  y: number
  worldX: number
  worldY: number
  elementId?: string
  artboardId?: string
  openLeft?: boolean
}

interface ElementDragPreviewNode {
  node: HTMLElement
  transform: string
  willChange: string
}

interface ElementDragPreview {
  nodes: ElementDragPreviewNode[]
  selectionBox?: ElementDragPreviewNode
}

interface WorldRect {
  left: number
  top: number
  width: number
  height: number
}

type MaskTool = 'rectangle' | 'brush' | 'erase'

interface MaskStroke {
  mode: 'brush' | 'erase'
  size: number
  points: Point[]
}

const contextMenuSize = {
  width: 248,
  height: 460,
  submenuWidth: 176,
}

const CANVAS_OVERSCAN_PX = 600

export function InfiniteCanvas({
  chatPanelOpen,
  hideAiChat,
  onOpenChatPanel,
}: InfiniteCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const document = useEditorStore((state) => state.document)
  const viewport = useEditorStore((state) => state.viewport)
  const viewportStateRef = useRef(viewport)
  const panViewportFrameRef = useRef<number | undefined>(undefined)
  const pendingPanViewportRef = useRef<typeof viewport | undefined>(undefined)
  const elementDragFrameRef = useRef<number | undefined>(undefined)
  const pendingElementDragDeltaRef = useRef<Point | undefined>(undefined)
  const lastElementDragDeltaRef = useRef<Point>({ x: 0, y: 0 })
  const elementDragPreviewRef = useRef<ElementDragPreview | undefined>(undefined)
  const gestureScaleRef = useRef(1)
  const pointerInCanvasRef = useRef(false)
  const lastCanvasPointRef = useRef<Point | null>(null)
  const lastCanvasZoomAtRef = useRef(0)
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId)
  const tool = useEditorStore((state) => state.tool)
  const setViewport = useEditorStore((state) => state.setViewport)
  const selectElement = useEditorStore((state) => state.selectElement)
  const setSelectedElements = useEditorStore((state) => state.setSelectedElements)
  const clearSelection = useEditorStore((state) => state.clearSelection)
  const clearArtboardSelection = useEditorStore((state) => state.clearArtboardSelection)
  const updateElements = useEditorStore((state) => state.updateElements)
  const updateElement = useEditorStore((state) => state.updateElement)
  const updateArtboard = useEditorStore((state) => state.updateArtboard)
  const addElement = useEditorStore((state) => state.addElement)
  const groupElements = useEditorStore((state) => state.groupElements)
  const ungroupElement = useEditorStore((state) => state.ungroupElement)
  const changeLayerOrder = useEditorStore((state) => state.changeLayerOrder)
  const removeElements = useEditorStore((state) => state.removeElements)
  const removeArtboard = useEditorStore((state) => state.removeArtboard)
  const addQueuedReferenceImage = useEditorStore((state) => state.addQueuedReferenceImage)
  const addQueuedChatText = useEditorStore((state) => state.addQueuedChatText)
  const setPageSectionLocked = useEditorStore((state) => state.setPageSectionLocked)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [previewElements, setPreviewElements] = useState<DesignElement[] | null>(null)
  const [previewArtboards, setPreviewArtboards] = useState<Artboard[] | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const [spacePressed, setSpacePressed] = useState(false)
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null)
  const [copiedElements, setCopiedElements] = useState<DesignElement[]>([])
  const [zoomInput, setZoomInput] = useState(() => String(Math.round(viewport.zoom * 100)))
  const [editingElementId, setEditingElementId] = useState<string | null>(null)
  const [sliceTargetId, setSliceTargetId] = useState<string | null>(null)
  const [sliceRect, setSliceRect] = useState<WorldRect | null>(null)
  const [slicePurpose, setSlicePurpose] = useState<'slice' | 'ai-region'>('slice')
  const [maskTool, setMaskTool] = useState<MaskTool>('rectangle')
  const [maskBrushSize, setMaskBrushSize] = useState(32)
  const [maskFeather, setMaskFeather] = useState(0)
  const [maskStrokes, setMaskStrokes] = useState<MaskStroke[]>([])
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const setTextRangeSelection = useEditorStore((state) => state.setTextRangeSelection)
  const setImageRegionSelection = useEditorStore((state) => state.setImageRegionSelection)

  const elements = useMemo(
    () => previewElements ?? document?.elements ?? [],
    [document?.elements, previewElements],
  )
  const artboards = useMemo(
    () => previewArtboards ?? document?.artboards ?? [],
    [document?.artboards, previewArtboards],
  )
  const documentId = document?.id
  const selectedElements = useMemo(
    () => elements.filter((element) => selectedElementIds.includes(element.id)),
    [elements, selectedElementIds],
  )
  const selectedElementIdSet = useMemo(() => new Set(selectedElementIds), [selectedElementIds])
  const paintElements = useMemo(() => flattenElementsForPainting(elements), [elements])
  const knownArtboardIds = useMemo(
    () => new Set(artboards.map((artboard) => artboard.id)),
    [artboards],
  )
  const retainedArtboardIds = useMemo(() => {
    const retained = new Set<string>()
    if (activeArtboardId) retained.add(activeArtboardId)
    for (const element of document?.elements ?? []) {
      if (
        element.artboardId &&
        (selectedElementIdSet.has(element.id) || dragState?.startElementById?.has(element.id))
      ) {
        retained.add(element.artboardId)
      }
    }
    return retained
  }, [activeArtboardId, document?.elements, dragState?.startElementById, selectedElementIdSet])
  const visibleWorldBounds = useMemo(
    () => resolveVisibleWorldBounds(viewport, canvasSize, CANVAS_OVERSCAN_PX),
    [canvasSize, viewport],
  )
  const visibleArtboards = useMemo(
    () => resolveVisibleArtboards(artboards, visibleWorldBounds, retainedArtboardIds),
    [artboards, retainedArtboardIds, visibleWorldBounds],
  )
  const paintElementsByArtboard = useMemo(() => {
    const byArtboard = new Map<string, Array<{ element: DesignElement; paintIndex: number }>>()
    const unbound: Array<{ element: DesignElement; paintIndex: number }> = []
    paintElements.forEach((element, paintIndex) => {
      if (element.artboardId && knownArtboardIds.has(element.artboardId)) {
        const entries = byArtboard.get(element.artboardId) ?? []
        entries.push({ element, paintIndex })
        byArtboard.set(element.artboardId, entries)
      } else {
        unbound.push({ element, paintIndex })
      }
    })
    return { byArtboard, unbound }
  }, [knownArtboardIds, paintElements])
  const visiblePaintElements = useMemo(() => {
    const visible = visibleArtboards.flatMap(
      (artboard) => paintElementsByArtboard.byArtboard.get(artboard.id) ?? [],
    )
    for (const entry of paintElementsByArtboard.unbound) {
      if (
        selectedElementIdSet.has(entry.element.id) ||
        dragState?.startElementById?.has(entry.element.id) ||
        !visibleWorldBounds ||
        rectIntersectsWorldBounds(entry.element, visibleWorldBounds)
      ) {
        visible.push(entry)
      }
    }
    return visible
  }, [
    dragState?.startElementById,
    paintElementsByArtboard,
    selectedElementIdSet,
    visibleArtboards,
    visibleWorldBounds,
  ])
  const primarySelection = selectedElements[0]
  const activeArtboard = artboards.find((artboard) => artboard.id === activeArtboardId)
  const sliceTarget = sliceTargetId
    ? elements.find(
        (element): element is ImageElement =>
          element.id === sliceTargetId && element.type === 'image',
      )
    : undefined
  const maskToolbarPosition =
    sliceTarget && slicePurpose === 'ai-region'
      ? {
          left: Math.min(
            Math.max(12, viewport.x + sliceTarget.x * viewport.zoom),
            Math.max(12, (viewportRef.current?.clientWidth ?? 900) - 390),
          ),
          top: Math.max(12, viewport.y + sliceTarget.y * viewport.zoom - 54),
        }
      : undefined

  useEffect(() => {
    viewportStateRef.current = viewport
    setZoomInput(String(Math.round(viewport.zoom * 100)))
  }, [viewport])

  useEffect(
    () => () => {
      if (panViewportFrameRef.current !== undefined) {
        window.cancelAnimationFrame(panViewportFrameRef.current)
      }
      if (elementDragFrameRef.current !== undefined) {
        window.cancelAnimationFrame(elementDragFrameRef.current)
      }
      restoreElementDragPreview(elementDragPreviewRef.current)
    },
    [],
  )

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return undefined
    const updateSize = () => {
      const next = { width: node.clientWidth, height: node.clientHeight }
      setCanvasSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      )
    }
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(node)
    return () => observer.disconnect()
  }, [documentId])

  useEffect(() => {
    function zoomCanvasFromKeyboard(zoomFactor: number) {
      const canvasNode = viewportRef.current
      if (!canvasNode) return

      const rect = canvasNode.getBoundingClientRect()
      const currentViewport = viewportStateRef.current
      setViewport(
        zoomAtPoint(
          currentViewport,
          { x: rect.width / 2, y: rect.height / 2 },
          currentViewport.zoom * zoomFactor,
        ),
      )
    }

    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && ['+', '=', '-', '_', '0'].includes(event.key)) {
        event.preventDefault()
        if (event.key === '0') {
          setViewport({ x: 360, y: 90, zoom: 1 })
          return
        }

        zoomCanvasFromKeyboard(event.key === '-' || event.key === '_' ? 0.9 : 1.1)
        return
      }

      const target = event.target as HTMLElement | null
      const editable = target?.matches('input, textarea, select, [contenteditable="true"]')
      if (editable) return

      if (event.code === 'Space') {
        event.preventDefault()
        setSpacePressed(true)
      }
      if (event.key === 'Escape' && sliceTargetId) {
        event.preventDefault()
        setSliceTargetId(null)
        setSliceRect(null)
        setDragState(null)
        setMaskStrokes([])
        setMaskFeather(0)
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
        event.preventDefault()
        if (event.shiftKey && selectedElementIds.length === 1) {
          ungroupElement(selectedElementIds[0])
        } else if (!event.shiftKey && selectedElementIds.length >= 2) {
          groupElements(selectedElementIds)
        }
      }
      if ((event.metaKey || event.ctrlKey) && ['[', ']'].includes(event.key)) {
        event.preventDefault()
        const action: LayerOrderAction =
          event.key === ']'
            ? event.shiftKey
              ? 'front'
              : 'forward'
            : event.shiftKey
              ? 'back'
              : 'backward'
        changeLayerOrder(selectedElementIds, action)
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedElementIds.length) removeElements(selectedElementIds)
        else if (activeArtboardId) removeArtboard(activeArtboardId)
      }
      if (event.key === '0') {
        setViewport({ x: 360, y: 90, zoom: 1 })
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.code === 'Space') setSpacePressed(false)
    }

    const keyOptions: AddEventListenerOptions = { capture: true }

    window.addEventListener('keydown', onKeyDown, keyOptions)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown, keyOptions)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [
    activeArtboardId,
    changeLayerOrder,
    groupElements,
    redo,
    removeArtboard,
    removeElements,
    selectedElementIds,
    setViewport,
    sliceTargetId,
    ungroupElement,
    undo,
  ])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const canvasNode = node
    const listenerOptions: AddEventListenerOptions = { passive: false, capture: true }
    const handledEvents = new WeakSet<Event>()
    let viewportFrame: number | undefined
    let pendingViewport: typeof viewportStateRef.current | undefined

    function applyViewport(nextViewport: typeof viewportStateRef.current) {
      viewportStateRef.current = nextViewport
      pendingViewport = nextViewport
      if (viewportFrame !== undefined) return
      viewportFrame = window.requestAnimationFrame(() => {
        viewportFrame = undefined
        if (!pendingViewport) return
        setViewport(pendingViewport)
        pendingViewport = undefined
      })
    }

    function eventPathIncludesCanvas(event: Event) {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : []
      return path.includes(canvasNode)
    }

    function eventPointInCanvas(clientX?: number, clientY?: number) {
      if (typeof clientX !== 'number' || typeof clientY !== 'number') return false
      const rect = canvasNode.getBoundingClientRect()
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      )
    }

    function elementFromEventPointIsCanvas(clientX?: number, clientY?: number) {
      if (typeof clientX !== 'number' || typeof clientY !== 'number') return false
      const target = globalThis.document.elementFromPoint(clientX, clientY)
      return target instanceof Node && canvasNode.contains(target)
    }

    function shouldHandleCanvasEvent(event: Event & { clientX?: number; clientY?: number }) {
      if (globalThis.document.querySelector('[aria-modal="true"]')) return false
      const target = event.target
      if (target instanceof HTMLElement && target.closest('.zoom-control')) return false

      return (
        pointerInCanvasRef.current ||
        eventPathIncludesCanvas(event) ||
        eventPointInCanvas(event.clientX, event.clientY) ||
        elementFromEventPointIsCanvas(event.clientX, event.clientY)
      )
    }

    function getCanvasPointFromClient(clientX: number, clientY: number) {
      const rect = canvasNode.getBoundingClientRect()
      const x = clientX - rect.left
      const y = clientY - rect.top
      const inside = x >= 0 && x <= rect.width && y >= 0 && y <= rect.height
      if (!inside) return null
      const point = { x, y }
      lastCanvasPointRef.current = point
      return point
    }

    function getCanvasCenterPoint() {
      const rect = canvasNode.getBoundingClientRect()
      return { x: rect.width / 2, y: rect.height / 2 }
    }

    function getActiveCanvasPoint(clientX?: number, clientY?: number, fallbackToCenter = false) {
      if (typeof clientX === 'number' && typeof clientY === 'number') {
        const point = getCanvasPointFromClient(clientX, clientY)
        if (point) return point
      }

      if (pointerInCanvasRef.current && lastCanvasPointRef.current) {
        return lastCanvasPointRef.current
      }

      return fallbackToCenter ? getCanvasCenterPoint() : null
    }

    function zoomCanvasAtPoint(canvasPoint: Point, zoomFactor: number) {
      lastCanvasZoomAtRef.current = Date.now()
      const currentViewport = viewportStateRef.current
      applyViewport(zoomAtPoint(currentViewport, canvasPoint, currentViewport.zoom * zoomFactor))
    }

    function handleWheelGesture(event: globalThis.WheelEvent) {
      if (handledEvents.has(event)) return
      const shouldHandle = shouldHandleCanvasEvent(event)
      if (!shouldHandle) return
      handledEvents.add(event)

      const isZoomWheel = event.ctrlKey || event.metaKey || Math.abs(event.deltaZ) > 0
      if (event.cancelable) event.preventDefault()

      if (isZoomWheel) {
        const canvasPoint = getActiveCanvasPoint(event.clientX, event.clientY, true)
        if (!canvasPoint) return

        zoomCanvasAtPoint(canvasPoint, event.deltaY > 0 ? 0.92 : 1.08)
        return
      }

      setContextMenu(null)
      const currentViewport = viewportStateRef.current
      applyViewport({
        ...currentViewport,
        x: currentViewport.x - event.deltaX,
        y: currentViewport.y - event.deltaY,
      })
    }

    const handleWheelGestureEvent: EventListener = (event) => {
      handleWheelGesture(event as globalThis.WheelEvent)
    }

    function handleWebkitGesture(event: Event) {
      if (handledEvents.has(event)) return
      const gestureEvent = event as Event & {
        clientX?: number
        clientY?: number
        scale?: number
        type: string
      }
      const shouldHandle = shouldHandleCanvasEvent(gestureEvent)
      if (!shouldHandle) return
      handledEvents.add(event)
      if (event.cancelable) event.preventDefault()

      if (gestureEvent.type === 'gesturestart') {
        gestureScaleRef.current = gestureEvent.scale ?? 1
        return
      }
      if (gestureEvent.type !== 'gesturechange') return

      const canvasPoint = getActiveCanvasPoint(gestureEvent.clientX, gestureEvent.clientY, true)
      if (!canvasPoint) return

      const scale = gestureEvent.scale ?? gestureScaleRef.current
      const previousScale = gestureScaleRef.current || 1
      const zoomFactor = previousScale ? scale / previousScale : 1
      gestureScaleRef.current = scale
      zoomCanvasAtPoint(canvasPoint, zoomFactor)
    }

    function blockContextMenu(event: globalThis.MouseEvent) {
      event.preventDefault()
    }

    function rememberCanvasPointer(event: globalThis.PointerEvent | globalThis.MouseEvent) {
      pointerInCanvasRef.current = true
      getCanvasPointFromClient(event.clientX, event.clientY)
    }

    function forgetCanvasPointer() {
      pointerInCanvasRef.current = false
    }

    canvasNode.addEventListener('contextmenu', blockContextMenu)
    canvasNode.addEventListener('pointerenter', rememberCanvasPointer)
    canvasNode.addEventListener('pointermove', rememberCanvasPointer)
    canvasNode.addEventListener('pointerleave', forgetCanvasPointer)
    canvasNode.addEventListener('mouseenter', rememberCanvasPointer)
    canvasNode.addEventListener('mousemove', rememberCanvasPointer)
    canvasNode.addEventListener('mouseleave', forgetCanvasPointer)
    window.addEventListener('wheel', handleWheelGestureEvent, listenerOptions)
    canvasNode.addEventListener('wheel', handleWheelGestureEvent, listenerOptions)
    window.addEventListener('gesturestart', handleWebkitGesture, listenerOptions)
    window.addEventListener('gesturechange', handleWebkitGesture, listenerOptions)
    window.addEventListener('gestureend', handleWebkitGesture, listenerOptions)
    canvasNode.addEventListener('gesturestart', handleWebkitGesture, listenerOptions)
    canvasNode.addEventListener('gesturechange', handleWebkitGesture, listenerOptions)
    canvasNode.addEventListener('gestureend', handleWebkitGesture, listenerOptions)

    return () => {
      if (viewportFrame !== undefined) window.cancelAnimationFrame(viewportFrame)
      canvasNode.removeEventListener('contextmenu', blockContextMenu)
      canvasNode.removeEventListener('pointerenter', rememberCanvasPointer)
      canvasNode.removeEventListener('pointermove', rememberCanvasPointer)
      canvasNode.removeEventListener('pointerleave', forgetCanvasPointer)
      canvasNode.removeEventListener('mouseenter', rememberCanvasPointer)
      canvasNode.removeEventListener('mousemove', rememberCanvasPointer)
      canvasNode.removeEventListener('mouseleave', forgetCanvasPointer)
      window.removeEventListener('wheel', handleWheelGestureEvent, listenerOptions)
      canvasNode.removeEventListener('wheel', handleWheelGestureEvent, listenerOptions)
      window.removeEventListener('gesturestart', handleWebkitGesture, listenerOptions)
      window.removeEventListener('gesturechange', handleWebkitGesture, listenerOptions)
      window.removeEventListener('gestureend', handleWebkitGesture, listenerOptions)
      canvasNode.removeEventListener('gesturestart', handleWebkitGesture, listenerOptions)
      canvasNode.removeEventListener('gesturechange', handleWebkitGesture, listenerOptions)
      canvasNode.removeEventListener('gestureend', handleWebkitGesture, listenerOptions)
    }
  }, [documentId, setViewport])

  useEffect(() => {
    const visualViewport = globalThis.visualViewport
    const canvasNode = viewportRef.current
    if (!visualViewport || !canvasNode) return
    const activeVisualViewport = visualViewport
    const activeCanvasNode = canvasNode

    let previousScale = activeVisualViewport.scale || 1

    function getFallbackCanvasPoint() {
      const rect = activeCanvasNode.getBoundingClientRect()
      return lastCanvasPointRef.current ?? { x: rect.width / 2, y: rect.height / 2 }
    }

    function onVisualViewportChange() {
      const currentScale = activeVisualViewport.scale || 1
      if (!Number.isFinite(currentScale) || currentScale <= 0) return

      const scaleDelta = currentScale / previousScale
      previousScale = currentScale

      if (Math.abs(scaleDelta - 1) < 0.01) return

      const recentlyHandledByCanvas = Date.now() - lastCanvasZoomAtRef.current < 120
      if (recentlyHandledByCanvas) return

      const currentViewport = viewportStateRef.current
      setViewport(
        zoomAtPoint(currentViewport, getFallbackCanvasPoint(), currentViewport.zoom * scaleDelta),
      )
    }

    activeVisualViewport.addEventListener('resize', onVisualViewportChange)
    activeVisualViewport.addEventListener('scroll', onVisualViewportChange)
    return () => {
      activeVisualViewport.removeEventListener('resize', onVisualViewportChange)
      activeVisualViewport.removeEventListener('scroll', onVisualViewportChange)
    }
  }, [documentId, setViewport])

  if (!document) {
    return <div className="canvas-empty">暂无设计文档</div>
  }

  const getWorldPointFromPointer = (event: PointerEvent<HTMLElement>) => {
    const canvas = viewportRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return screenToWorld(
      {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      },
      viewport,
    )
  }

  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragState({
      mode: 'pan',
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      startViewport: viewport,
    })
  }

  const schedulePanViewport = (nextViewport: typeof viewport) => {
    viewportStateRef.current = nextViewport
    pendingPanViewportRef.current = nextViewport
    if (panViewportFrameRef.current !== undefined) return
    panViewportFrameRef.current = window.requestAnimationFrame(() => {
      panViewportFrameRef.current = undefined
      const pending = pendingPanViewportRef.current
      pendingPanViewportRef.current = undefined
      if (pending) setViewport(pending)
    })
  }

  const flushPanViewport = () => {
    if (panViewportFrameRef.current !== undefined) {
      window.cancelAnimationFrame(panViewportFrameRef.current)
      panViewportFrameRef.current = undefined
    }
    const pending = pendingPanViewportRef.current
    pendingPanViewportRef.current = undefined
    if (pending) setViewport(pending)
  }

  const prepareElementDragPreview = (targets: DesignElement[]) => {
    restoreElementDragPreview(elementDragPreviewRef.current)
    const targetIds = new Set(targets.map((element) => element.id))
    const nodes = Array.from(
      viewportRef.current?.querySelectorAll<HTMLElement>('[data-element-id]') ?? [],
    )
      .filter((node) => Boolean(node.dataset.elementId && targetIds.has(node.dataset.elementId)))
      .map(captureElementDragPreviewNode)
    const selectionBox = viewportRef.current?.querySelector<HTMLElement>('.selection-box')
    elementDragPreviewRef.current = {
      nodes,
      selectionBox: selectionBox ? captureElementDragPreviewNode(selectionBox) : undefined,
    }
    lastElementDragDeltaRef.current = { x: 0, y: 0 }
    pendingElementDragDeltaRef.current = undefined
  }

  const applyElementDragPreview = (delta: Point) => {
    const preview = elementDragPreviewRef.current
    if (!preview) return
    if (!preview.selectionBox) {
      const selectionBox = viewportRef.current?.querySelector<HTMLElement>('.selection-box')
      if (selectionBox) preview.selectionBox = captureElementDragPreviewNode(selectionBox)
    }
    const translate = `translate3d(${delta.x}px, ${delta.y}px, 0)`
    for (const snapshot of [...preview.nodes, ...(preview.selectionBox ? [preview.selectionBox] : [])]) {
      snapshot.node.style.willChange = 'transform'
      snapshot.node.style.transform = snapshot.transform
        ? `${translate} ${snapshot.transform}`
        : translate
      snapshot.node.dataset.dragPreview = 'true'
    }
  }

  const scheduleElementDragPreview = (delta: Point) => {
    lastElementDragDeltaRef.current = delta
    pendingElementDragDeltaRef.current = delta
    if (elementDragFrameRef.current !== undefined) return
    elementDragFrameRef.current = window.requestAnimationFrame(() => {
      elementDragFrameRef.current = undefined
      const pending = pendingElementDragDeltaRef.current
      pendingElementDragDeltaRef.current = undefined
      if (pending) applyElementDragPreview(pending)
    })
  }

  const flushElementDragPreview = () => {
    if (elementDragFrameRef.current !== undefined) {
      window.cancelAnimationFrame(elementDragFrameRef.current)
      elementDragFrameRef.current = undefined
    }
    const pending = pendingElementDragDeltaRef.current
    pendingElementDragDeltaRef.current = undefined
    if (pending) applyElementDragPreview(pending)
    return lastElementDragDeltaRef.current
  }

  const clearElementDragPreview = () => {
    if (elementDragFrameRef.current !== undefined) {
      window.cancelAnimationFrame(elementDragFrameRef.current)
      elementDragFrameRef.current = undefined
    }
    pendingElementDragDeltaRef.current = undefined
    restoreElementDragPreview(elementDragPreviewRef.current)
    elementDragPreviewRef.current = undefined
  }

  const startMarquee = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragState({
      mode: 'marquee',
      pointerId: event.pointerId,
      startScreen: { x, y },
      appendSelection: event.shiftKey,
    })
    setMarqueeRect({ left: x, top: y, width: 0, height: 0 })
  }

  const onCanvasPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    setContextMenu(null)
    setEditingElementId(null)
    if ((sliceTargetId || tool === 'slice') && event.button === 0) {
      const target = event.target
      const isCanvasBackground =
        target === event.currentTarget ||
        (target instanceof HTMLElement && target.classList.contains('canvas-grid'))
      if (isCanvasBackground) {
        setSliceTargetId(null)
        setSliceRect(null)
        setMaskStrokes([])
        setMaskFeather(0)
        setImageRegionSelection(undefined)
      }
    }
    const shouldPan = tool === 'hand' || spacePressed || event.button === 1
    if (shouldPan) {
      startPan(event)
      return
    }

    if (event.button !== 0) return
    if (tool === 'slice') return

    const target = event.target
    const isCanvasBackground =
      target === event.currentTarget ||
      (target instanceof HTMLElement && target.classList.contains('canvas-grid'))
    if (isCanvasBackground) {
      clearArtboardSelection()
      startMarquee(event)
    }
  }

  const onElementPointerDown = (event: PointerEvent<HTMLDivElement>, element: DesignElement) => {
    if (event.button !== 0) return
    if (element.locked) return

    if (editingElementId === element.id) return
    setEditingElementId(null)
    setContextMenu(null)
    event.stopPropagation()

    if ((sliceTargetId === element.id || tool === 'slice') && element.type === 'image') {
      const worldPoint = getWorldPointFromPointer(event)
      if (!worldPoint) return
      const startWorld = clampPointToRect(worldPoint, element)
      setSliceTargetId(element.id)
      selectElement(element.id)
      event.currentTarget.setPointerCapture(event.pointerId)
      if (slicePurpose === 'ai-region' && maskTool !== 'rectangle') {
        const stroke: MaskStroke = {
          mode: maskTool,
          size: maskBrushSize,
          points: [startWorld],
        }
        const strokeIndex = maskStrokes.length
        setMaskStrokes((current) => [...current, stroke])
        setDragState({
          mode: 'paint-mask',
          pointerId: event.pointerId,
          startScreen: { x: event.clientX, y: event.clientY },
          startWorld,
          startElements: [element],
          strokeIndex,
        })
        return
      }
      setSliceRect({
        left: startWorld.x,
        top: startWorld.y,
        width: 0,
        height: 0,
      })
      setDragState({
        mode: 'slice-image',
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        startWorld,
        startElements: [element],
      })
      return
    }

    selectElement(element.id, { append: event.shiftKey })

    const selectedRoots = selectedElementIds.includes(element.id)
      ? document.elements.filter((item) => selectedElementIds.includes(item.id))
      : [element]
    const selected = collectLayerSubtreeElements(
      document.elements,
      selectedRoots.map((item) => item.id),
    )

    event.currentTarget.setPointerCapture(event.pointerId)
    setDragState({
      mode: 'move',
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      startElements: selected,
      startElementById: new Map(selected.map((item) => [item.id, item])),
    })
    prepareElementDragPreview(selected)
  }

  const onArtboardPointerDown = (event: PointerEvent<HTMLDivElement>, artboard: Artboard) => {
    if (event.button !== 0) return
    const target = event.target
    const canStartFromTarget =
      target === event.currentTarget ||
      (target instanceof HTMLElement && target.classList.contains('artboard-label'))
    if (!canStartFromTarget) return

    setEditingElementId(null)
    setContextMenu(null)
    event.stopPropagation()
    useEditorStore.getState().selectArtboard(artboard.id)
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragState({
      mode: 'move-artboard',
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      startArtboard: artboard,
    })
  }

  const onResizeStart = (event: PointerEvent<HTMLButtonElement>, handle: ResizeHandle) => {
    if (!primarySelection && !activeArtboard) return

    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    if (primarySelection) {
      const resizeDescendantIds =
        primarySelection.type === 'section' && !primarySelection.autoLayout
          ? new Set(
              collectLayerSubtreeElements(document.elements, [primarySelection.id])
                .filter((element) => element.id !== primarySelection.id)
                .map((element) => element.id),
            )
          : new Set<string>()
      setDragState({
        mode: 'resize',
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        startElements: [primarySelection],
        startElementById: new Map([[primarySelection.id, primarySelection]]),
        resizeDescendantIds,
        handle,
      })
      return
    }

    setDragState({
      mode: 'resize-artboard',
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      startArtboard: activeArtboard,
      handle,
    })
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragState) return

    if (dragState.mode === 'marquee') {
      const rect = event.currentTarget.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      setMarqueeRect({
        left: Math.min(dragState.startScreen.x, x),
        top: Math.min(dragState.startScreen.y, y),
        width: Math.abs(x - dragState.startScreen.x),
        height: Math.abs(y - dragState.startScreen.y),
      })
      return
    }

    if (dragState.mode === 'pan' && dragState.startViewport) {
      schedulePanViewport({
        ...dragState.startViewport,
        x: dragState.startViewport.x + event.clientX - dragState.startScreen.x,
        y: dragState.startViewport.y + event.clientY - dragState.startScreen.y,
      })
      return
    }

    if (
      dragState.mode === 'slice-image' &&
      dragState.startWorld &&
      dragState.startElements?.[0]?.type === 'image'
    ) {
      const worldPoint = getWorldPointFromPointer(event)
      if (!worldPoint) return
      const target = dragState.startElements[0]
      const currentWorld = clampPointToRect(worldPoint, target)
      setSliceRect(createRectFromPoints(dragState.startWorld, currentWorld))
      return
    }

    if (dragState.mode === 'paint-mask' && dragState.startElements?.[0]?.type === 'image') {
      const worldPoint = getWorldPointFromPointer(event)
      if (!worldPoint || dragState.strokeIndex === undefined) return
      const point = clampPointToRect(worldPoint, dragState.startElements[0])
      setMaskStrokes((current) =>
        current.map((stroke, index) => {
          if (index !== dragState.strokeIndex) return stroke
          const previous = stroke.points.at(-1)
          if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 1) return stroke
          return { ...stroke, points: [...stroke.points, point] }
        }),
      )
      return
    }

    const deltaX = (event.clientX - dragState.startScreen.x) / viewport.zoom
    const deltaY = (event.clientY - dragState.startScreen.y) / viewport.zoom

    if (dragState.mode === 'move-artboard' && dragState.startArtboard) {
      setPreviewArtboards(
        document.artboards.map((artboard) => {
          if (artboard.id !== dragState.startArtboard?.id) return artboard
          return {
            ...dragState.startArtboard,
            x: Math.round(dragState.startArtboard.x + deltaX),
            y: Math.round(dragState.startArtboard.y + deltaY),
          }
        }),
      )
      return
    }

    if (dragState.mode === 'resize-artboard' && dragState.startArtboard && dragState.handle) {
      setPreviewArtboards(
        document.artboards.map((artboard) => {
          if (artboard.id !== dragState.startArtboard?.id) return artboard
          return resizeRect(dragState.startArtboard, dragState.handle!, deltaX, deltaY, 80)
        }),
      )
      return
    }

    if (!dragState.startElements) return

    if (dragState.mode === 'move') {
      scheduleElementDragPreview({ x: Math.round(deltaX), y: Math.round(deltaY) })
      return
    }

    const target = dragState.startElements[0]
    if (dragState.mode === 'resize' && target && dragState.handle) {
      const resized = resizeRect(target, dragState.handle, deltaX, deltaY, 24)
      const descendants = dragState.resizeDescendantIds ?? new Set<string>()
      const scaleX = resized.width / Math.max(1, target.width)
      const scaleY = resized.height / Math.max(1, target.height)
      setPreviewElements(
        document.elements.map((element) => {
          if (element.id === target.id) return resized
          if (!descendants.has(element.id)) return element
          return {
            ...element,
            x: resized.x + (element.x - target.x) * scaleX,
            y: resized.y + (element.y - target.y) * scaleY,
            width: Math.max(1, element.width * scaleX),
            height: Math.max(1, element.height * scaleY),
          }
        }),
      )
    }
  }

  const onPointerUp = async () => {
    if (dragState?.mode === 'pan') {
      flushPanViewport()
      setDragState(null)
      return
    }
    if (dragState?.mode === 'paint-mask') {
      setDragState(null)
      return
    }
    if (dragState?.mode === 'slice-image') {
      const target = dragState.startElements?.[0]
      if (target?.type === 'image' && sliceRect && sliceRect.width >= 4 && sliceRect.height >= 4) {
        if (slicePurpose !== 'ai-region') {
          const renderedImage = await renderElementToImage(target, { format: 'png' })
          const slicedElement = await createImageSlice(
            target,
            renderedImage?.src ?? target.src,
            sliceRect,
            {
              zIndex: document.elements.length
                ? Math.max(...document.elements.map((element) => element.zIndex)) + 1
                : target.zIndex + 1,
            },
          )
          if (slicedElement) addElement(slicedElement)
        }
      }
      setDragState(null)
      if (slicePurpose !== 'ai-region') {
        setSliceTargetId(null)
        setSliceRect(null)
      }
      return
    }

    if (dragState?.mode === 'marquee') {
      if (marqueeRect && viewportRef.current) {
        if (marqueeRect.width < 3 && marqueeRect.height < 3) {
          if (!dragState.appendSelection) clearSelection()
        } else {
          const selectionScreenRect = {
            left: marqueeRect.left,
            top: marqueeRect.top,
            right: marqueeRect.left + marqueeRect.width,
            bottom: marqueeRect.top + marqueeRect.height,
          }
          const selectionWorldTopLeft = screenToWorld(
            { x: selectionScreenRect.left, y: selectionScreenRect.top },
            viewport,
          )
          const selectionWorldBottomRight = screenToWorld(
            { x: selectionScreenRect.right, y: selectionScreenRect.bottom },
            viewport,
          )
          const selectedIds = elements
            .filter((element) =>
              rectsIntersect(
                {
                  left: Math.min(selectionWorldTopLeft.x, selectionWorldBottomRight.x),
                  top: Math.min(selectionWorldTopLeft.y, selectionWorldBottomRight.y),
                  right: Math.max(selectionWorldTopLeft.x, selectionWorldBottomRight.x),
                  bottom: Math.max(selectionWorldTopLeft.y, selectionWorldBottomRight.y),
                },
                {
                  left: element.x,
                  top: element.y,
                  right: element.x + element.width,
                  bottom: element.y + element.height,
                },
              ),
            )
            .map((element) => element.id)
          setSelectedElements(selectedIds, { append: dragState.appendSelection })
        }
      }
      setDragState(null)
      setMarqueeRect(null)
      return
    }

    if (dragState?.mode === 'move' && dragState.startElements) {
      const delta = flushElementDragPreview()
      clearElementDragPreview()
      if (delta.x !== 0 || delta.y !== 0) {
        updateElements(
          dragState.startElements.map((element) => ({
            id: element.id,
            patch: {
              x: Math.round(element.x + delta.x),
              y: Math.round(element.y + delta.y),
            },
          })),
        )
      }
      setDragState(null)
      return
    }

    if (previewElements && dragState?.startElements) {
      const startIds = new Set(dragState.startElements.map((element) => element.id))
      updateElements(
        previewElements
          .filter((element) => startIds.has(element.id))
          .map((element) => ({
            id: element.id,
            patch: {
              x: element.x,
              y: element.y,
              width: element.width,
              height: element.height,
            },
          })),
      )
    }

    if (previewArtboards && dragState?.startArtboard) {
      const nextArtboard = previewArtboards.find(
        (artboard) => artboard.id === dragState.startArtboard?.id,
      )
      if (nextArtboard) {
        updateArtboard(nextArtboard.id, {
          x: nextArtboard.x,
          y: nextArtboard.y,
          width: nextArtboard.width,
          height: nextArtboard.height,
        })
      }
    }

    setDragState(null)
    setPreviewElements(null)
    setPreviewArtboards(null)
    setMarqueeRect(null)
  }

  const getContextElementId = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return undefined
    return target.closest<HTMLElement>('[data-element-id]')?.dataset.elementId
  }

  const getContextArtboardId = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return undefined
    return target.closest<HTMLElement>('[data-artboard-id]')?.dataset.artboardId
  }

  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setEditingElementId(null)

    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const elementId = getContextElementId(event.target)
    const artboardId = elementId ? undefined : getContextArtboardId(event.target)
    if (elementId && !selectedElementIds.includes(elementId)) {
      selectElement(elementId)
    } else if (artboardId) {
      useEditorStore.getState().selectArtboard(artboardId)
    }

    const worldPoint = screenToWorld({ x, y }, viewport)
    const openLeft = x + contextMenuSize.width + contextMenuSize.submenuWidth + 24 > rect.width
    setContextMenu({
      x: Math.max(12, Math.min(x, rect.width - contextMenuSize.width - 12)),
      y: Math.max(12, Math.min(y, rect.height - contextMenuSize.height - 12)),
      worldX: worldPoint.x,
      worldY: worldPoint.y,
      elementId,
      artboardId,
      openLeft,
    })
  }

  const closeContextMenu = () => setContextMenu(null)

  const startTextEdit = (element: DesignElement) => {
    if (element.type !== 'text') return
    setContextMenu(null)
    selectElement(element.id)
    setTextRangeSelection(undefined)
    setEditingElementId(element.id)
  }

  const updateTextContent = (id: string, content: string) => {
    const current = useEditorStore
      .getState()
      .document?.elements.find((element) => element.id === id)
    if (current?.type === 'text' && current.content === content) return
    updateElement(id, { content } as Partial<DesignElement>)
  }

  const captureTextSelection: ElementRendererProps['onTextSelectionChange'] = (selection) => {
    updateTextContent(selection.elementId, selection.content)
    setTextRangeSelection({
      elementId: selection.elementId,
      start: selection.start,
      end: selection.end,
      selectedText: selection.selectedText,
      prefix: selection.prefix,
      suffix: selection.suffix,
    })
  }

  const contextTarget = contextMenu?.elementId
    ? elements.find((element) => element.id === contextMenu.elementId)
    : selectedElements[0]
  const contextSelection = contextTarget
    ? selectedElementIds.includes(contextTarget.id)
      ? selectedElements
      : [contextTarget]
    : selectedElements
  const canUseElementAction = Boolean(contextTarget)
  const canUseArtboardAction = Boolean(contextMenu?.artboardId && !contextTarget)
  const canUseSelectionAction = contextSelection.length > 0
  const canSliceImage = contextTarget?.type === 'image'
  const canEditImageRegion =
    canSliceImage &&
    contextTarget.designRole !== 'page-shell' &&
    (!contextTarget.componentBinding || Boolean(contextTarget.componentBinding.bindings.image))
  const canRegenerateSlot = canRegenerateComponentSlot(contextTarget)
  const canRegeneratePageShell =
    contextTarget?.type === 'image' && contextTarget.designRole === 'page-shell'
  const pageSectionId =
    contextTarget?.componentBinding?.renderMode === 'root'
      ? contextTarget.componentBinding.pageSectionId
      : undefined
  const isMultiContext = contextSelection.length > 1
  const contextParent = contextSelection[0]?.parentId
    ? elements.find((element) => element.id === contextSelection[0].parentId)
    : undefined
  const canReorderContext =
    contextSelection.length > 0 &&
    contextSelection.every(isLayerStructureEditable) &&
    contextSelection.every(
      (element) =>
        element.artboardId === contextSelection[0].artboardId &&
        element.parentId === contextSelection[0].parentId,
    ) &&
    (!contextSelection[0].parentId || isLayerStructureEditable(contextParent))
  const canGroupContext = contextSelection.length >= 2 && canReorderContext
  const canUngroupContext =
    isGroupElement(contextTarget) && isLayerStructureEditable(contextTarget)

  const copyTargetElement = () => {
    if (!canUseSelectionAction) return
    setCopiedElements(expandLayerSelection(elements, contextSelection))
    closeContextMenu()
  }

  const createElementCopies = (sources: DesignElement[], position?: Point) => {
    if (!sources.length) return
    const expanded = expandLayerSelection(elements, sources)
    const sourceIds = new Set(expanded.map((element) => element.id))
    const roots = expanded.filter(
      (element) => !element.parentId || !sourceIds.has(element.parentId),
    )
    const minX = Math.min(...expanded.map((element) => element.x))
    const minY = Math.min(...expanded.map((element) => element.y))
    const offsetX = position ? position.x - minX : 24
    const offsetY = position ? position.y - minY : 24
    const copySeed = Date.now()
    const idMap = new Map(
      expanded.map((element, index) => [element.id, `${element.type}-${copySeed}-${index}`]),
    )
    const rootIds = new Set(roots.map((element) => element.id))
    let rootIndex = 0
    const maxZIndex = Math.max(0, ...elements.map((element) => element.zIndex))
    expanded.forEach((source) => {
      const copiedParentId = source.parentId ? idMap.get(source.parentId) : undefined
      const nextRootIndex = rootIds.has(source.id) ? rootIndex++ : undefined
      addElement({
        ...source,
        id: idMap.get(source.id)!,
        name: `${source.name} 副本`,
        parentId: copiedParentId ?? source.parentId,
        x: Math.round(source.x + offsetX),
        y: Math.round(source.y + offsetY),
        zIndex:
          nextRootIndex === undefined ? source.zIndex : maxZIndex + nextRootIndex + 1,
      } as DesignElement)
    })
    setSelectedElements(roots.map((root) => idMap.get(root.id)!))
  }

  const pasteElement = () => {
    if (!copiedElements.length || !contextMenu) return
    createElementCopies(copiedElements, { x: contextMenu.worldX, y: contextMenu.worldY })
    closeContextMenu()
  }

  const duplicateTargetElement = () => {
    if (!canUseSelectionAction) return
    createElementCopies(contextSelection)
    closeContextMenu()
  }

  const groupContextSelection = () => {
    if (!canGroupContext) return
    groupElements(contextSelection.map((element) => element.id))
    closeContextMenu()
  }

  const ungroupContextTarget = () => {
    if (!contextTarget || !canUngroupContext) return
    ungroupElement(contextTarget.id)
    closeContextMenu()
  }

  const reorderContextSelection = (action: LayerOrderAction) => {
    if (!canUseSelectionAction) return
    changeLayerOrder(
      contextSelection.map((element) => element.id),
      action,
    )
    closeContextMenu()
  }

  const deleteTargetSelection = () => {
    if (canUseArtboardAction && contextMenu?.artboardId) {
      removeArtboard(contextMenu.artboardId)
      closeContextMenu()
      return
    }
    const ids = contextTarget
      ? selectedElementIds.includes(contextTarget.id)
        ? selectedElementIds
        : [contextTarget.id]
      : selectedElementIds
    if (ids.length) removeElements(ids)
    closeContextMenu()
  }

  const zoomToSelection = () => {
    const targets = selectedElements.length
      ? selectedElements
      : contextTarget
        ? [contextTarget]
        : []
    if (!targets.length || !viewportRef.current) return
    const rect = viewportRef.current.getBoundingClientRect()
    const minX = Math.min(...targets.map((element) => element.x))
    const minY = Math.min(...targets.map((element) => element.y))
    const maxX = Math.max(...targets.map((element) => element.x + element.width))
    const maxY = Math.max(...targets.map((element) => element.y + element.height))
    const width = Math.max(1, maxX - minX)
    const height = Math.max(1, maxY - minY)
    const zoom = clampZoom(Math.min(rect.width / (width + 240), rect.height / (height + 240), 2))
    setViewport({
      x: rect.width / 2 - (minX + width / 2) * zoom,
      y: rect.height / 2 - (minY + height / 2) * zoom,
      zoom,
    })
    closeContextMenu()
  }

  const getElementNode = (element: DesignElement) => {
    if (!viewportRef.current) return null
    const nodes = Array.from(viewportRef.current.querySelectorAll<HTMLElement>('[data-element-id]'))
    return nodes.find((node) => node.dataset.elementId === element.id) ?? null
  }

  const renderElementToImage = async (
    element: DesignElement,
    options?: {
      format?: 'png' | 'jpeg'
      preferSourceImage?: boolean
      scale?: 1 | 2
    },
  ) => {
    if (options?.preferSourceImage && element.type === 'image') {
      return {
        name: element.name || '画布图片',
        src: element.src,
      }
    }

    const node = getElementNode(element)
    if (!node) return null
    // 与画板快照共用 foreignObject 光栅化：html2canvas 会裁掉紧凑行高文字的字形。
    // 尺寸必须用元素逻辑尺寸，不能用 getBoundingClientRect：后者带画布 zoom 缩放，
    // 而 rasterizeNode 会把克隆体的 transform 清成 none 并从原点排布。缩小视图
    // （zoom < 1）时 SVG 画布比内容小，导出图会被裁掉右下部分。
    const canvas = await rasterizeNode(node, {
      width: element.width,
      height: element.height,
      background: options?.format === 'jpeg' ? '#ffffff' : null,
      scale: options?.scale ?? 2,
    })
    const format = options?.format ?? 'png'
    return {
      name: element.name || '画布元素',
      src: canvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92),
    }
  }

  const renderContextTargetImage = async (options?: {
    format?: 'png' | 'jpeg'
    preferSourceImage?: boolean
  }) => {
    if (!contextTarget) return null
    return renderElementToImage(contextTarget, options)
  }

  const renderSelectionImage = async (format: 'png' | 'jpeg' = 'png') => {
    if (!contextSelection.length) return null

    const minX = Math.min(...contextSelection.map((element) => element.x))
    const minY = Math.min(...contextSelection.map((element) => element.y))
    const maxX = Math.max(...contextSelection.map((element) => element.x + element.width))
    const maxY = Math.max(...contextSelection.map((element) => element.y + element.height))
    const scale = 2
    const canvas = globalThis.document.createElement('canvas')
    canvas.width = Math.ceil((maxX - minX) * scale)
    canvas.height = Math.ceil((maxY - minY) * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    if (format === 'jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }

    for (const element of contextSelection) {
      const image = await renderElementToImage(element, { format })
      if (!image) continue
      const bitmap = await loadImage(image.src)
      ctx.drawImage(
        bitmap,
        (element.x - minX) * scale,
        (element.y - minY) * scale,
        element.width * scale,
        element.height * scale,
      )
    }

    return {
      name: `选中内容-${contextSelection.length}项`,
      src: canvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.92),
    }
  }

  const downloadImageData = (image: { name: string; src: string }, format: 'png' | 'jpeg') => {
    const link = globalThis.document.createElement('a')
    link.download = buildImageDownloadName(image.name, format === 'jpeg' ? 'jpg' : 'png')
    link.href = image.src
    link.click()
  }

  const downloadTargetImage = async (format: 'png' | 'jpeg') => {
    const image = await renderContextTargetImage({ format })
    if (!image) return
    downloadImageData(image, format)
    closeContextMenu()
  }

  const downloadSelectionImage = async () => {
    const image = await renderSelectionImage('png')
    if (!image) return
    downloadImageData(image, 'png')
    closeContextMenu()
  }

  const batchDownloadSelection = async () => {
    if (!contextSelection.length) return
    for (const element of contextSelection) {
      const image = await renderElementToImage(element, { format: 'png', preferSourceImage: true })
      if (image) downloadImageData(image, 'png')
    }
    closeContextMenu()
  }

  const sliceTargetImage = () => {
    if (!contextTarget || contextTarget.type !== 'image') return
    setSliceTargetId(contextTarget.id)
    setSlicePurpose('slice')
    setMaskStrokes([])
    setSliceRect(null)
    selectElement(contextTarget.id)
    closeContextMenu()
  }

  const editImageRegion = () => {
    if (!contextTarget || !canEditImageRegion) return
    setSliceTargetId(contextTarget.id)
    setSlicePurpose('ai-region')
    setMaskTool('rectangle')
    setMaskBrushSize(32)
    setMaskFeather(0)
    setMaskStrokes([])
    setSliceRect(null)
    setImageRegionSelection(undefined)
    selectElement(contextTarget.id)
    closeContextMenu()
  }

  const resetImageMask = () => {
    setSliceRect(null)
    setMaskStrokes([])
  }

  const cancelImageMask = () => {
    setDragState(null)
    setSliceTargetId(null)
    setSliceRect(null)
    setMaskStrokes([])
    setMaskFeather(0)
  }

  const confirmImageMask = async () => {
    if (!sliceTarget || slicePurpose !== 'ai-region') return
    const renderedImage = await renderElementToImage(sliceTarget, { format: 'png', scale: 1 })
    if (!renderedImage?.src) return
    const region = createImageRegionSelection(
      sliceTarget,
      sliceRect,
      maskStrokes,
      maskFeather,
      renderedImage.src,
    )
    if (!region) return
    setTextRangeSelection(undefined)
    setImageRegionSelection(region)
    selectElement(sliceTarget.id)
    setDragState(null)
    setSliceTargetId(null)
    setSliceRect(null)
    setMaskStrokes([])
    setMaskFeather(0)
  }

  const regenerateComponentSlot = () => {
    if (!contextTarget || !canRegenerateComponentSlot(contextTarget)) return
    selectElement(contextTarget.id)
    addQueuedChatText({
      id: `component-edit-${Date.now()}`,
      text: createComponentSlotRegenerationText(contextTarget),
      elementId: contextTarget.id,
      target: resolveComposerQueueTarget(chatPanelOpen),
      kind: 'component-region-regeneration',
    })
    closeContextMenu()
  }

  const regeneratePageShell = () => {
    if (!contextTarget || !canRegeneratePageShell) return
    selectElement(contextTarget.id)
    addQueuedChatText({
      id: `page-shell-edit-${Date.now()}`,
      text: '重新生成选中的页面背景和跨模块视觉外壳',
      elementId: contextTarget.id,
      target: resolveComposerQueueTarget(chatPanelOpen),
    })
    closeContextMenu()
  }

  const togglePageSectionLock = () => {
    if (!contextTarget || !pageSectionId) return
    setPageSectionLocked(pageSectionId, contextTarget.locked !== true)
    closeContextMenu()
  }

  const addSelectionToChat = async () => {
    if (!contextSelection.length) return
    const target = resolveComposerQueueTarget(chatPanelOpen)

    await Promise.all(
      contextSelection.map(async (element, index) => {
        if (element.type === 'text') {
          addQueuedChatText({
            id: `canvas-text-${Date.now()}-${index}`,
            text: element.content,
            elementId: element.id,
            target,
          })
          return
        }

        const image = await renderElementToImage(element, { preferSourceImage: true })
        if (!image) return
        addQueuedReferenceImage({
          id: `canvas-ref-${Date.now()}-${index}`,
          name: image.name,
          src: image.src,
          elementId: element.id,
          target,
        })
      }),
    )
    closeContextMenu()
  }

  const flipTargetElement = (axis: 'x' | 'y') => {
    if (!contextTarget) return
    updateElement(
      contextTarget.id,
      axis === 'x' ? { flipX: !contextTarget.flipX } : { flipY: !contextTarget.flipY },
    )
    closeContextMenu()
  }

  const zoomAtViewportCenter = (nextZoom: number) => {
    if (!viewportRef.current) return
    const rect = viewportRef.current.getBoundingClientRect()
    setViewport(zoomAtPoint(viewport, { x: rect.width / 2, y: rect.height / 2 }, nextZoom))
  }

  const adjustZoom = (factor: number) => {
    zoomAtViewportCenter(viewport.zoom * factor)
  }

  const commitZoomInput = () => {
    const parsed = Number.parseFloat(zoomInput.replace('%', '').trim())
    if (!Number.isFinite(parsed)) {
      setZoomInput(String(Math.round(viewport.zoom * 100)))
      return
    }

    const nextZoom = clampZoom(parsed / 100)
    zoomAtViewportCenter(nextZoom)
    setZoomInput(String(Math.round(nextZoom * 100)))
  }

  return (
    <div
      ref={viewportRef}
      className={cn(
        'editor-viewport',
        document.settings?.canvasMode === 'dark' && 'dark-canvas',
        sliceTarget && 'slicing-image',
        tool === 'slice' && 'slice-tool',
      )}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={onContextMenu}
    >
      {document.settings?.gridVisible !== false ? (
        <div
          className="canvas-grid"
          style={{
            backgroundPosition: `${viewport.x}px ${viewport.y}px`,
            backgroundSize: `${32 * viewport.zoom}px ${32 * viewport.zoom}px`,
          }}
        />
      ) : null}
      {marqueeRect ? (
        <div
          className="marquee-selection"
          style={{
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
          }}
        />
      ) : null}
      {document.artboards.length === 0 && document.elements.length === 0 ? (
        <CanvasStartPrompt />
      ) : null}
      {!hideAiChat ? <AiCanvasChat onOpenChatPanel={onOpenChatPanel} /> : null}
      <div
        className="canvas-world"
        data-export-root
        data-rendered-artboard-count={visibleArtboards.length}
        data-rendered-element-count={visiblePaintElements.length}
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
      >
        {visibleArtboards.map((artboard) => (
          <ArtboardFrame
            key={artboard.id}
            artboard={artboard}
            active={activeArtboardId === artboard.id}
            showLabel
            onPointerDown={(event) => onArtboardPointerDown(event, artboard)}
          />
        ))}
        {visiblePaintElements.map(({ element, paintIndex }) => (
          <ElementRenderer
            key={element.id}
            element={
              element.zIndex === paintIndex
                ? element
                : ({ ...element, zIndex: paintIndex } as DesignElement)
            }
            selected={selectedElementIdSet.has(element.id)}
            editing={editingElementId === element.id}
            onPointerDown={onElementPointerDown}
            onEditStart={startTextEdit}
            onTextChange={updateTextContent}
            onTextSelectionChange={captureTextSelection}
            onTextEditEnd={() => setEditingElementId(null)}
          />
        ))}
        {sliceTarget ? (
          <div
            className={cn('image-slice-target', slicePurpose === 'ai-region' && 'ai-mask-target')}
            style={{
              left: sliceTarget.x,
              top: sliceTarget.y,
              width: sliceTarget.width,
              height: sliceTarget.height,
            }}
          >
            <span>
              {slicePurpose === 'ai-region' ? '拖拽选择 AI 重绘区域' : '拖拽选择切图区域'}
            </span>
          </div>
        ) : null}
        {sliceRect && sliceRect.width > 0 && sliceRect.height > 0 ? (
          <div
            className="image-slice-rect"
            style={{
              left: sliceRect.left,
              top: sliceRect.top,
              width: sliceRect.width,
              height: sliceRect.height,
            }}
          />
        ) : null}
        {sliceTarget && slicePurpose === 'ai-region' && maskStrokes.length ? (
          <svg
            className="image-mask-strokes"
            style={{
              left: sliceTarget.x,
              top: sliceTarget.y,
              width: sliceTarget.width,
              height: sliceTarget.height,
            }}
            viewBox={`0 0 ${sliceTarget.width} ${sliceTarget.height}`}
            aria-hidden="true"
          >
            {maskStrokes.map((stroke, index) => (
              <path
                key={`${stroke.mode}-${index}`}
                className={stroke.mode}
                d={createStrokePath(stroke, sliceTarget)}
                strokeWidth={stroke.size}
              />
            ))}
          </svg>
        ) : null}
        {primarySelection ? (
          <SelectionBox target={primarySelection} onResizeStart={onResizeStart} />
        ) : activeArtboard ? (
          <SelectionBox target={activeArtboard} onResizeStart={onResizeStart} />
        ) : null}
      </div>
      {maskToolbarPosition ? (
        <div
          className="image-mask-toolbar"
          style={maskToolbarPosition}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="image-mask-tool-modes" role="group" aria-label="Mask 工具">
            <button
              type="button"
              className={maskTool === 'rectangle' ? 'active' : undefined}
              title="矩形选区"
              onClick={() => setMaskTool('rectangle')}
            >
              <Square size={15} />
            </button>
            <button
              type="button"
              className={maskTool === 'brush' ? 'active' : undefined}
              title="画笔"
              onClick={() => setMaskTool('brush')}
            >
              <Paintbrush size={15} />
            </button>
            <button
              type="button"
              className={maskTool === 'erase' ? 'active' : undefined}
              title="擦除 Mask"
              onClick={() => setMaskTool('erase')}
            >
              <Eraser size={15} />
            </button>
          </div>
          <label title="笔刷大小">
            <Paintbrush size={13} />
            <input
              aria-label="笔刷大小"
              type="range"
              min="4"
              max="96"
              step="2"
              value={maskBrushSize}
              disabled={maskTool === 'rectangle'}
              onChange={(event) => setMaskBrushSize(Number(event.target.value))}
            />
            <span>{maskBrushSize}</span>
          </label>
          <label title="边缘羽化">
            <span>羽化</span>
            <input
              aria-label="Mask 羽化"
              type="range"
              min="0"
              max="32"
              step="1"
              value={maskFeather}
              onChange={(event) => setMaskFeather(Number(event.target.value))}
            />
            <span>{maskFeather}</span>
          </label>
          <button type="button" title="重置 Mask" onClick={resetImageMask}>
            <RotateCcw size={15} />
          </button>
          <button type="button" title="取消" onClick={cancelImageMask}>
            <X size={15} />
          </button>
          <button
            type="button"
            className="confirm"
            title="完成 Mask"
            disabled={
              !hasEditableImageMask(
                sliceRect,
                maskStrokes.map((stroke) => ({
                  mode: stroke.mode,
                  pointCount: stroke.points.length,
                })),
              )
            }
            onClick={() => void confirmImageMask()}
          >
            <Check size={15} />
          </button>
        </div>
      ) : null}
      {contextMenu ? (
        <div
          className="canvas-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {isMultiContext ? (
            <>
              <button type="button" onClick={copyTargetElement}>
                <span>复制</span>
                <kbd>⌘ C</kbd>
              </button>
              <button type="button" disabled={!copiedElements.length} onClick={pasteElement}>
                <span>粘贴</span>
                <kbd>⌘ V</kbd>
              </button>
              <button type="button" onClick={duplicateTargetElement}>
                <span>创建副本</span>
                <kbd>⌘ D</kbd>
              </button>
              <button type="button" disabled={!canGroupContext} onClick={groupContextSelection}>
                <span>组合</span>
                <kbd>⌘ G</kbd>
              </button>
              <LayerOrderMenu
                disabled={!canReorderContext}
                openLeft={contextMenu.openLeft}
                onSelect={reorderContextSelection}
              />
              <button type="button" onClick={downloadSelectionImage}>
                <span>合并导出</span>
                <kbd>⌘ ⇧ E</kbd>
              </button>
              <button type="button" onClick={batchDownloadSelection}>
                <span>批量下载</span>
              </button>
              <button type="button" onClick={deleteTargetSelection}>
                <span>删除</span>
                <kbd>⌫</kbd>
              </button>
              <hr />
              <button type="button" onClick={addSelectionToChat}>
                <span>添加到对话</span>
              </button>
              <hr />
              <button type="button" onClick={zoomToSelection}>
                <span>缩放到选中内容</span>
                <kbd>⇧ 1</kbd>
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={!canUseElementAction} onClick={copyTargetElement}>
                <span>复制</span>
                <kbd>⌘ C</kbd>
              </button>
              <button type="button" disabled={!copiedElements.length} onClick={pasteElement}>
                <span>粘贴</span>
                <kbd>⌘ V</kbd>
              </button>
              <button
                type="button"
                disabled={!canUseElementAction}
                onClick={duplicateTargetElement}
              >
                <span>创建副本</span>
                <kbd>⌘ D</kbd>
              </button>
              {canUngroupContext ? (
                <button type="button" onClick={ungroupContextTarget}>
                  <span>取消组合</span>
                  <kbd>⌘ ⇧ G</kbd>
                </button>
              ) : null}
              <LayerOrderMenu
                disabled={!canReorderContext}
                openLeft={contextMenu.openLeft}
                onSelect={reorderContextSelection}
              />
              <div
                className={cn(
                  'canvas-context-item submenu-trigger',
                  contextMenu.openLeft && 'open-left',
                )}
              >
                <button className="has-submenu" type="button" disabled={!canUseElementAction}>
                  <span>下载图片</span>
                  <small />
                </button>
                {canUseElementAction ? (
                  <div className="canvas-context-submenu">
                    <button type="button" onClick={() => downloadTargetImage('png')}>
                      <span>PNG</span>
                    </button>
                    <button type="button" onClick={() => downloadTargetImage('jpeg')}>
                      <span>JPEG</span>
                    </button>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                disabled={!canUseElementAction && !canUseArtboardAction}
                onClick={deleteTargetSelection}
              >
                <span>删除</span>
                <kbd>⌫</kbd>
              </button>
              <hr />
              <button type="button" disabled={!canSliceImage} onClick={sliceTargetImage}>
                <span>切图</span>
              </button>
              <button type="button" disabled={!canEditImageRegion} onClick={editImageRegion}>
                <span className="canvas-context-command-label">
                  <WandSparkles size={14} />
                  <span>AI 局部编辑</span>
                </span>
              </button>
              {canRegenerateSlot ? (
                <button type="button" onClick={regenerateComponentSlot}>
                  <span className="canvas-context-command-label">
                    <WandSparkles size={14} />
                    <span>局部重生成</span>
                  </span>
                </button>
              ) : null}
              {canRegeneratePageShell ? (
                <button type="button" onClick={regeneratePageShell}>
                  <span className="canvas-context-command-label">
                    <WandSparkles size={14} />
                    <span>重生成页面外壳</span>
                  </span>
                </button>
              ) : null}
              {pageSectionId ? (
                <button type="button" onClick={togglePageSectionLock}>
                  <span className="canvas-context-command-label">
                    {contextTarget?.locked ? <LockOpen size={14} /> : <Lock size={14} />}
                    <span>{contextTarget?.locked ? '解锁页面模块' : '锁定页面模块'}</span>
                  </span>
                </button>
              ) : null}
              <button type="button" disabled={!canUseElementAction} onClick={addSelectionToChat}>
                <span>添加到对话</span>
              </button>
              <hr />
              <button type="button" disabled={!canUseElementAction} onClick={zoomToSelection}>
                <span>缩放到选中内容</span>
                <kbd>⇧ 1</kbd>
              </button>
              <div
                className={cn(
                  'canvas-context-item submenu-trigger',
                  contextMenu.openLeft && 'open-left',
                )}
              >
                <button className="has-submenu" type="button" disabled={!canUseElementAction}>
                  <span>翻转</span>
                  <small />
                </button>
                {canUseElementAction ? (
                  <div className="canvas-context-submenu">
                    <button type="button" onClick={() => flipTargetElement('x')}>
                      <span>水平翻转</span>
                      <kbd>⇧ H</kbd>
                    </button>
                    <button type="button" onClick={() => flipTargetElement('y')}>
                      <span>垂直翻转</span>
                      <kbd>⇧ V</kbd>
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}
      <div className="zoom-control" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" aria-label="缩小画布" onClick={() => adjustZoom(0.9)}>
          -
        </button>
        <label>
          <input
            aria-label="画布缩放比例"
            value={zoomInput}
            inputMode="decimal"
            onChange={(event) => setZoomInput(event.target.value.replace(/[^\d.]/g, ''))}
            onBlur={commitZoomInput}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
          />
          <span>%</span>
        </label>
        <button type="button" aria-label="放大画布" onClick={() => adjustZoom(1.1)}>
          +
        </button>
      </div>
    </div>
  )
}

function LayerOrderMenu({
  disabled,
  openLeft,
  onSelect,
}: {
  disabled: boolean
  openLeft?: boolean
  onSelect: (action: LayerOrderAction) => void
}) {
  return (
    <div className={cn('canvas-context-item submenu-trigger', openLeft && 'open-left')}>
      <button className="has-submenu" type="button" disabled={disabled}>
        <span>图层顺序</span>
        <small />
      </button>
      {!disabled ? (
        <div className="canvas-context-submenu">
          <button type="button" onClick={() => onSelect('front')}>
            <span>置于顶层</span>
            <kbd>⌘ ⇧ ]</kbd>
          </button>
          <button type="button" onClick={() => onSelect('forward')}>
            <span>上移一层</span>
            <kbd>⌘ ]</kbd>
          </button>
          <button type="button" onClick={() => onSelect('backward')}>
            <span>下移一层</span>
            <kbd>⌘ [</kbd>
          </button>
          <button type="button" onClick={() => onSelect('back')}>
            <span>置于底层</span>
            <kbd>⌘ ⇧ [</kbd>
          </button>
        </div>
      ) : null}
    </div>
  )
}

function expandLayerSelection(elements: DesignElement[], selected: DesignElement[]) {
  const selectedIds = new Set(selected.map((element) => element.id))
  const roots = selected.filter(
    (element) => !element.parentId || !selectedIds.has(element.parentId),
  )
  return collectLayerSubtreeElements(
    elements,
    roots.map((element) => element.id),
  )
}

function resizeRect<T extends { x: number; y: number; width: number; height: number }>(
  target: T,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  minSize: number,
): T {
  let { x, y, width, height } = target

  if (handle.includes('e')) width += deltaX
  if (handle.includes('s')) height += deltaY
  if (handle.includes('w')) {
    x += deltaX
    width -= deltaX
  }
  if (handle.includes('n')) {
    y += deltaY
    height -= deltaY
  }

  if (width < minSize) {
    if (handle.includes('w')) x -= minSize - width
    width = minSize
  }
  if (height < minSize) {
    if (handle.includes('n')) y -= minSize - height
    height = minSize
  }

  return {
    ...target,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  }
}

function captureElementDragPreviewNode(node: HTMLElement): ElementDragPreviewNode {
  return {
    node,
    transform: node.style.transform,
    willChange: node.style.willChange,
  }
}

function restoreElementDragPreview(preview: ElementDragPreview | undefined) {
  if (!preview) return
  for (const snapshot of [
    ...preview.nodes,
    ...(preview.selectionBox ? [preview.selectionBox] : []),
  ]) {
    snapshot.node.style.transform = snapshot.transform
    snapshot.node.style.willChange = snapshot.willChange
    delete snapshot.node.dataset.dragPreview
  }
}

function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

function clampPointToRect(
  point: Point,
  rect: { x: number; y: number; width: number; height: number },
) {
  return {
    x: Math.min(rect.x + rect.width, Math.max(rect.x, point.x)),
    y: Math.min(rect.y + rect.height, Math.max(rect.y, point.y)),
  }
}

function createRectFromPoints(start: Point, end: Point): WorldRect {
  return {
    left: Math.round(Math.min(start.x, end.x)),
    top: Math.round(Math.min(start.y, end.y)),
    width: Math.round(Math.abs(end.x - start.x)),
    height: Math.round(Math.abs(end.y - start.y)),
  }
}

function createStrokePath(stroke: MaskStroke, source: ImageElement) {
  const points = stroke.points.map((point) => ({ x: point.x - source.x, y: point.y - source.y }))
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} l 0.01 0`
  return points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
}

function createImageRegionSelection(
  source: ImageElement,
  rect: WorldRect | null,
  strokes: MaskStroke[],
  feather: number,
  currentImage: string,
) {
  const targetSize = {
    width: Math.max(1, Math.round(source.width)),
    height: Math.max(1, Math.round(source.height)),
  }
  const padding = Math.ceil(Math.max(0, feather) * 3)
  const working = globalThis.document.createElement('canvas')
  working.width = targetSize.width + padding * 2
  working.height = targetSize.height + padding * 2
  const context = working.getContext('2d')
  if (!context) throw new Error('无法创建图片局部编辑 Mask。')
  context.fillStyle = '#000000'
  context.fillRect(0, 0, working.width, working.height)

  if (rect && rect.width > 0 && rect.height > 0) {
    const x = clampNumber(Math.round(rect.left - source.x), 0, targetSize.width)
    const y = clampNumber(Math.round(rect.top - source.y), 0, targetSize.height)
    const width = clampNumber(Math.round(rect.width), 0, targetSize.width - x)
    const height = clampNumber(Math.round(rect.height), 0, targetSize.height - y)
    context.clearRect(padding + x, padding + y, width, height)
  }

  for (const stroke of strokes) {
    if (!stroke.points.length) continue
    context.save()
    context.globalCompositeOperation = stroke.mode === 'brush' ? 'destination-out' : 'source-over'
    context.strokeStyle = '#000000'
    context.fillStyle = '#000000'
    context.lineWidth = Math.max(1, stroke.size)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    const points = stroke.points.map((point) => ({
      x: padding + ((point.x - source.x) / source.width) * targetSize.width,
      y: padding + ((point.y - source.y) / source.height) * targetSize.height,
    }))
    if (points.length === 1) {
      context.beginPath()
      context.arc(points[0].x, points[0].y, Math.max(0.5, stroke.size / 2), 0, Math.PI * 2)
      context.fill()
    } else {
      context.beginPath()
      context.moveTo(points[0].x, points[0].y)
      points.slice(1).forEach((point) => context.lineTo(point.x, point.y))
      context.stroke()
    }
    context.restore()
  }

  const softened = globalThis.document.createElement('canvas')
  softened.width = working.width
  softened.height = working.height
  const softenedContext = softened.getContext('2d')
  if (!softenedContext) throw new Error('无法处理 Mask 羽化。')
  softenedContext.filter = feather > 0 ? `blur(${feather}px)` : 'none'
  softenedContext.drawImage(working, 0, 0)

  const canvas = globalThis.document.createElement('canvas')
  canvas.width = targetSize.width
  canvas.height = targetSize.height
  const outputContext = canvas.getContext('2d', { willReadFrequently: true })
  if (!outputContext) throw new Error('无法输出图片局部编辑 Mask。')
  outputContext.drawImage(
    softened,
    padding,
    padding,
    targetSize.width,
    targetSize.height,
    0,
    0,
    targetSize.width,
    targetSize.height,
  )
  const pixels = outputContext.getImageData(0, 0, targetSize.width, targetSize.height)
  const bounds = findEditableMaskBounds(pixels)
  if (!bounds) return null
  return {
    elementId: source.id,
    sourceSrc: source.src,
    normalizedRect: {
      x: bounds.x / targetSize.width,
      y: bounds.y / targetSize.height,
      width: bounds.width / targetSize.width,
      height: bounds.height / targetSize.height,
    },
    pixelRect: bounds,
    targetSize,
    currentImage,
    maskImage: canvas.toDataURL('image/png'),
  }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

async function createImageSlice(
  source: ImageElement,
  renderedSrc: string,
  rect: WorldRect,
  options?: { zIndex?: number },
): Promise<ImageElement | null> {
  const bitmap = await loadImage(renderedSrc)
  const pixelWidth = bitmap.naturalWidth || bitmap.width
  const pixelHeight = bitmap.naturalHeight || bitmap.height
  const timestamp = Date.now()

  const clampedLeft = Math.min(source.x + source.width, Math.max(source.x, rect.left))
  const clampedTop = Math.min(source.y + source.height, Math.max(source.y, rect.top))
  const clampedRight = Math.min(source.x + source.width, Math.max(source.x, rect.left + rect.width))
  const clampedBottom = Math.min(
    source.y + source.height,
    Math.max(source.y, rect.top + rect.height),
  )
  const width = Math.round(clampedRight - clampedLeft)
  const height = Math.round(clampedBottom - clampedTop)
  if (width < 1 || height < 1) return null

  const sourceX = Math.round(((clampedLeft - source.x) / source.width) * pixelWidth)
  const sourceY = Math.round(((clampedTop - source.y) / source.height) * pixelHeight)
  const sourceWidth = Math.max(1, Math.round((width / source.width) * pixelWidth))
  const sourceHeight = Math.max(1, Math.round((height / source.height) * pixelHeight))
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = sourceWidth
  canvas.height = sourceHeight
  const context = canvas.getContext('2d')
  if (!context) return null

  context.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  )

  return {
    ...source,
    id: `${source.id}-slice-${timestamp}`,
    name: `${source.name || '图片'} 切图`,
    x: Math.round(clampedLeft),
    y: Math.round(clampedTop),
    width,
    height,
    src: canvas.toDataURL('image/png'),
    objectFit: 'fill',
    borderRadius: 0,
    zIndex: options?.zIndex ?? source.zIndex + 1,
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = src
  })
}
