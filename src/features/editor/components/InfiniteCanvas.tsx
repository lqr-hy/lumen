import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import html2canvas from 'html2canvas'
import { Lock, LockOpen, WandSparkles } from 'lucide-react'
import { ElementRenderer } from './ElementRenderer'
import { AiCanvasChat } from './AiCanvasChat'
import { CanvasStartPrompt } from './CanvasStartPrompt'
import { SelectionBox, type ResizeHandle } from './SelectionBox'
import { useEditorStore } from '../store/editor-store'
import type { Artboard, DesignElement, ImageElement, Point } from '../types'
import { clampZoom, screenToWorld, zoomAtPoint } from '../utils/coordinates'
import {
  canRegenerateComponentSlot,
  createComponentSlotRegenerationText,
} from '../utils/component-edit-scope'
import { cn } from '../../../lib/cn'

interface DragState {
  mode: 'pan' | 'move' | 'resize' | 'marquee' | 'move-artboard' | 'resize-artboard' | 'slice-image'
  pointerId: number
  startScreen: Point
  startWorld?: Point
  startViewport?: { x: number; y: number; zoom: number }
  startElements?: DesignElement[]
  startArtboard?: Artboard
  handle?: ResizeHandle
  appendSelection?: boolean
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

interface WorldRect {
  left: number
  top: number
  width: number
  height: number
}

const contextMenuSize = {
  width: 248,
  height: 410,
  submenuWidth: 176,
}

export function InfiniteCanvas({
  chatPanelOpen,
  hideAiChat,
  onOpenChatPanel,
}: InfiniteCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const document = useEditorStore((state) => state.document)
  const viewport = useEditorStore((state) => state.viewport)
  const viewportStateRef = useRef(viewport)
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
  const updateElements = useEditorStore((state) => state.updateElements)
  const updateElement = useEditorStore((state) => state.updateElement)
  const updateArtboard = useEditorStore((state) => state.updateArtboard)
  const addElement = useEditorStore((state) => state.addElement)
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
  const primarySelection = selectedElements[0]
  const activeArtboard = artboards.find((artboard) => artboard.id === activeArtboardId)
  const sliceTarget = sliceTargetId
    ? elements.find((element): element is ImageElement => element.id === sliceTargetId && element.type === 'image')
    : undefined

  useEffect(() => {
    viewportStateRef.current = viewport
    setZoomInput(String(Math.round(viewport.zoom * 100)))
  }, [viewport])

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
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
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
  }, [activeArtboardId, redo, removeArtboard, removeElements, selectedElementIds, setViewport, sliceTargetId, undo])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const canvasNode = node
    const listenerOptions: AddEventListenerOptions = { passive: false, capture: true }
    const handledEvents = new WeakSet<Event>()

    function applyViewport(nextViewport: typeof viewportStateRef.current) {
      viewportStateRef.current = nextViewport
      setViewport(nextViewport)
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
      applyViewport(
        zoomAtPoint(
          currentViewport,
          canvasPoint,
          currentViewport.zoom * zoomFactor,
        ),
      )
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

      const canvasPoint = getActiveCanvasPoint(
        gestureEvent.clientX,
        gestureEvent.clientY,
        true,
      )
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
        zoomAtPoint(
          currentViewport,
          getFallbackCanvasPoint(),
          currentViewport.zoom * scaleDelta,
        ),
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
      startMarquee(event)
    }
  }

  const onElementPointerDown = (
    event: PointerEvent<HTMLDivElement>,
    element: DesignElement,
  ) => {
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

    const selected = selectedElementIds.includes(element.id)
      ? document.elements.filter((item) => selectedElementIds.includes(item.id))
      : [element]

    event.currentTarget.setPointerCapture(event.pointerId)
    setDragState({
      mode: 'move',
      pointerId: event.pointerId,
      startScreen: { x: event.clientX, y: event.clientY },
      startElements: selected,
    })
  }

  const onArtboardPointerDown = (
    event: PointerEvent<HTMLDivElement>,
    artboard: Artboard,
  ) => {
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

  const onResizeStart = (
    event: PointerEvent<HTMLButtonElement>,
    handle: ResizeHandle,
  ) => {
    if (!primarySelection && !activeArtboard) return

    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    if (primarySelection) {
      setDragState({
        mode: 'resize',
        pointerId: event.pointerId,
        startScreen: { x: event.clientX, y: event.clientY },
        startElements: [primarySelection],
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
      setViewport({
        ...dragState.startViewport,
        x: dragState.startViewport.x + event.clientX - dragState.startScreen.x,
        y: dragState.startViewport.y + event.clientY - dragState.startScreen.y,
      })
      return
    }

    if (dragState.mode === 'slice-image' && dragState.startWorld && dragState.startElements?.[0]?.type === 'image') {
      const worldPoint = getWorldPointFromPointer(event)
      if (!worldPoint) return
      const target = dragState.startElements[0]
      const currentWorld = clampPointToRect(worldPoint, target)
      setSliceRect(createRectFromPoints(dragState.startWorld, currentWorld))
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
      setPreviewElements(
        document.elements.map((element) => {
          const started = dragState.startElements?.find((item) => item.id === element.id)
          if (!started) return element
          return {
            ...started,
            x: Math.round(started.x + deltaX),
            y: Math.round(started.y + deltaY),
          }
        }),
      )
      return
    }

    const target = dragState.startElements[0]
    if (dragState.mode === 'resize' && target && dragState.handle) {
      setPreviewElements(
        document.elements.map((element) => {
          if (element.id !== target.id) return element
          return resizeRect(target, dragState.handle!, deltaX, deltaY, 24)
        }),
      )
    }
  }

  const onPointerUp = async () => {
    if (dragState?.mode === 'slice-image') {
      const target = dragState.startElements?.[0]
      if (target?.type === 'image' && sliceRect && sliceRect.width >= 4 && sliceRect.height >= 4) {
        const renderedImage = await renderElementToImage(target, { format: 'png' })
        const slicedElement = await createImageSlice(target, renderedImage?.src ?? target.src, sliceRect, {
          zIndex: document.elements.length
            ? Math.max(...document.elements.map((element) => element.zIndex)) + 1
            : target.zIndex + 1,
        })
        if (slicedElement) addElement(slicedElement)
      }
      setDragState(null)
      setSliceTargetId(null)
      setSliceRect(null)
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
    setEditingElementId(element.id)
  }

  const updateTextContent = (id: string, content: string) => {
    updateElement(id, { content } as Partial<DesignElement>)
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
  const canRegenerateSlot = canRegenerateComponentSlot(contextTarget)
  const canRegeneratePageShell = contextTarget?.type === 'image' && contextTarget.designRole === 'page-shell'
  const pageSectionId = contextTarget?.componentBinding?.renderMode === 'root'
    ? contextTarget.componentBinding.pageSectionId
    : undefined
  const isMultiContext = contextSelection.length > 1

  const copyTargetElement = () => {
    if (!canUseSelectionAction) return
    setCopiedElements(contextSelection)
    closeContextMenu()
  }

  const createElementCopy = (source: DesignElement, position?: Point, index = 0) => {
    const maxZIndex = Math.max(0, ...elements.map((element) => element.zIndex))
    addElement({
      ...source,
      id: `${source.type}-${Date.now()}-${index}`,
      name: `${source.name} 副本`,
      x: Math.round(position?.x ?? source.x + 24),
      y: Math.round(position?.y ?? source.y + 24),
      zIndex: maxZIndex + index + 1,
    } as DesignElement)
  }

  const createElementCopies = (sources: DesignElement[], position?: Point) => {
    if (!sources.length) return
    const minX = Math.min(...sources.map((element) => element.x))
    const minY = Math.min(...sources.map((element) => element.y))
    sources.forEach((source, index) => {
      const nextPosition = position
        ? {
            x: position.x + source.x - minX,
            y: position.y + source.y - minY,
          }
        : undefined
      createElementCopy(source, nextPosition, index)
    })
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
    const targets = selectedElements.length ? selectedElements : contextTarget ? [contextTarget] : []
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
    const nodes = Array.from(
      viewportRef.current.querySelectorAll<HTMLElement>('[data-element-id]'),
    )
    return nodes.find((node) => node.dataset.elementId === element.id) ?? null
  }

  const renderElementToImage = async (element: DesignElement, options?: {
    format?: 'png' | 'jpeg'
    preferSourceImage?: boolean
  }) => {
    if (options?.preferSourceImage && element.type === 'image') {
      return {
        name: element.name || '画布图片',
        src: element.src,
      }
    }

    const node = getElementNode(element)
    if (!node) return null
    const canvas = await html2canvas(node, {
      backgroundColor: options?.format === 'jpeg' ? '#ffffff' : null,
      useCORS: true,
      scale: 2,
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
    link.download = `${image.name || 'canvas-image'}.${format === 'jpeg' ? 'jpg' : 'png'}`
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
    setSliceRect(null)
    selectElement(contextTarget.id)
    closeContextMenu()
  }

  const regenerateComponentSlot = () => {
    if (!contextTarget || !canRegenerateComponentSlot(contextTarget)) return
    selectElement(contextTarget.id)
    addQueuedChatText({
      id: `component-edit-${Date.now()}`,
      text: createComponentSlotRegenerationText(contextTarget),
      elementId: contextTarget.id,
      target: 'bottom',
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
      target: 'bottom',
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
    const target = chatPanelOpen ? 'panel' : 'bottom'

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
      axis === 'x'
        ? { flipX: !contextTarget.flipX }
        : { flipY: !contextTarget.flipY },
    )
    closeContextMenu()
  }

  const zoomAtViewportCenter = (nextZoom: number) => {
    if (!viewportRef.current) return
    const rect = viewportRef.current.getBoundingClientRect()
    setViewport(
      zoomAtPoint(
        viewport,
        { x: rect.width / 2, y: rect.height / 2 },
        nextZoom,
      ),
    )
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
      {document.artboards.length === 0 && document.elements.length === 0 ? <CanvasStartPrompt /> : null}
      {!hideAiChat ? <AiCanvasChat onOpenChatPanel={onOpenChatPanel} /> : null}
      <div
        className="canvas-world"
        data-export-root
        style={{
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
        }}
      >
        {artboards.map((artboard) => (
          <div
            key={artboard.id}
            className={cn('artboard', activeArtboardId === artboard.id && 'active')}
            data-artboard-id={artboard.id}
            onPointerDown={(event) => onArtboardPointerDown(event, artboard)}
            style={{
              left: artboard.x,
              top: artboard.y,
              width: artboard.width,
              height: artboard.height,
              background: artboard.background,
              borderRadius: artboard.borderRadius,
              overflow: artboard.overflow,
            }}
          >
            <div className="artboard-label">{artboard.name}</div>
          </div>
        ))}
        {elements
          .slice()
          .sort((a, b) => a.zIndex - b.zIndex)
          .map((element) => (
            <ElementRenderer
              key={element.id}
              element={element}
              selected={selectedElementIds.includes(element.id)}
              editing={editingElementId === element.id}
              onPointerDown={onElementPointerDown}
              onEditStart={startTextEdit}
              onTextChange={updateTextContent}
              onTextEditEnd={() => setEditingElementId(null)}
            />
          ))}
        {sliceTarget ? (
          <div
            className="image-slice-target"
            style={{
              left: sliceTarget.x,
              top: sliceTarget.y,
              width: sliceTarget.width,
              height: sliceTarget.height,
            }}
          >
            <span>拖拽选择切图区域</span>
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
        {primarySelection ? (
          <SelectionBox target={primarySelection} onResizeStart={onResizeStart} />
        ) : activeArtboard ? (
          <SelectionBox target={activeArtboard} onResizeStart={onResizeStart} />
        ) : null}
      </div>
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
              <button type="button" disabled={!canUseElementAction} onClick={duplicateTargetElement}>
                <span>创建副本</span>
                <kbd>⌘ D</kbd>
              </button>
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

function rectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

function clampPointToRect(point: Point, rect: { x: number; y: number; width: number; height: number }) {
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
  const clampedBottom = Math.min(source.y + source.height, Math.max(source.y, rect.top + rect.height))
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
