import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { ChatPanel } from '../features/editor/components/ChatPanel'
import { EditorTopBar } from '../features/editor/components/EditorTopBar'
import { InfiniteCanvas } from '../features/editor/components/InfiniteCanvas'
import { LayerPanel } from '../features/editor/components/LayerPanel'
import { JsonInspectorPanel } from '../features/editor/components/JsonInspectorPanel'
import { PropertyPanel } from '../features/editor/components/PropertyPanel'
import { Toolbar } from '../features/editor/components/Toolbar'
import { ResponsivePreviewPanel } from '../features/editor/components/ResponsivePreviewPanel'
import { CodePreviewDialog } from '../features/editor/components/CodePreviewDialog'
import { createBlankDocument } from '../features/editor/data/sample-document'
import { useEditorStore } from '../features/editor/store/editor-store'
import type { Artboard, DesignDocument, DesignElement } from '../features/editor/types'
import {
  buildComponentExportPackage,
  buildStructuralExportPackage,
  componentExportFileName,
  structuralExportFileName,
} from '../features/editor/utils/component-export'
import { buildPageDeliveryPackage } from '../features/editor/utils/page-delivery'
import {
  buildCodeDocument,
  buildCodeExportPackage,
  codeExportFileName,
  formatCodeDocument,
} from '../features/codegen/compiler-registry'
import type { CodeDocument, CodeFramework } from '../features/codegen/types'
import { renderArtboardSnapshot } from '../features/editor/utils/artboard-snapshot'
import { buildImageDownloadName } from '../features/editor/utils/image-file'
import { useProjectPersistence } from '../features/editor/hooks/use-project-persistence'
import {
  buildVisualNormalizationPatches,
  compileVisualDirectionPrompt,
  compileVisualRedesignPrompt,
  type VisualRedesignBrief,
} from '../features/editor/utils/visual-brief'

const PANEL_WIDTH_STORAGE_KEY = 'ai-campaign-page-studio:panel-widths:v1'
const PANEL_WIDTHS = {
  left: { default: 246, min: 200, max: 420 },
  right: { default: 316, min: 280, max: 520 },
} as const
const MIN_CANVAS_WIDTH = 360

type PanelSide = keyof typeof PANEL_WIDTHS
type PanelWidths = Record<PanelSide, number>

export function EditorPage() {
  const { projectId } = useParams()
  const location = useLocation()
  const initialPrompt =
    typeof location.state?.initialPrompt === 'string' ? location.state.initialPrompt : undefined
  const document = useEditorStore((state) => state.document)
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId)
  const selectedArtboardId = useEditorStore((state) => state.selectedArtboardId)
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const hydrateWorkspace = useEditorStore((state) => state.hydrateWorkspace)
  const [workspaceReady, setWorkspaceReady] = useState(false)
  const [leftPanelVisible, setLeftPanelVisible] = useState(true)
  const [leftPanelMode, setLeftPanelMode] = useState<'layers' | 'json'>('layers')
  const [rightPanelVisible, setRightPanelVisible] = useState(true)
  const [panelWidths, setPanelWidths] = useState<PanelWidths>(readPanelWidths)
  const [chatPanelOpen, setChatPanelOpen] = useState(false)
  const [responsivePreviewOpen, setResponsivePreviewOpen] = useState(false)
  const [codePreview, setCodePreview] = useState<CodeDocument | null>(null)
  const persistenceDocumentId = document?.id
  const workbenchRef = useRef<HTMLDivElement>(null)
  const { status: saveStatus, retry: retrySave } = useProjectPersistence(
    persistenceDocumentId,
    workspaceReady,
  )

  useEffect(() => {
    try {
      window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify(panelWidths))
    } catch {
      // 隐私模式或禁用存储时仍保留当前会话内的面板宽度。
    }
  }, [panelWidths])

  // A compiled preview is an immutable snapshot. Never keep it across a
  // project or artboard switch, otherwise the modal can show another page's
  // Scene Graph while the canvas already displays the new document.
  useEffect(() => {
    setCodePreview(null)
  }, [activeArtboardId, document?.id, document?.updatedAt, projectId])

  useEffect(() => {
    let cancelled = false
    setWorkspaceReady(false)
    const resolvedProjectId = projectId || `project-${Date.now()}`
    const loadWorkspace = async () => {
      const current = useEditorStore.getState()
      if (current.document?.id === resolvedProjectId) {
        if (!cancelled) setWorkspaceReady(true)
        return
      }
      const saved = await window.aiCampaignProjects?.load(resolvedProjectId)
      if (cancelled) return
      hydrateWorkspace(
        saved
          ? {
              document: saved.document,
              chatThreads: saved.chatThreads,
              activeChatThreadId: saved.activeChatThreadId,
              mutationLedger: saved.mutationLedger,
            }
          : {
              document: createBlankDocument(
                resolvedProjectId.startsWith('new') ? '未命名项目' : '空白项目',
                resolvedProjectId,
              ),
              chatThreads: [],
              activeChatThreadId: 'panel-thread-default',
              mutationLedger: [],
            },
      )
      setWorkspaceReady(true)
    }
    void loadWorkspace()
    return () => {
      cancelled = true
    }
  }, [hydrateWorkspace, projectId])

  useEffect(() => {
    if (workspaceReady && initialPrompt?.trim()) setChatPanelOpen(true)
  }, [initialPrompt, workspaceReady])

  async function exportPng(scale: 1 | 2) {
    if (!document) return
    try {
      const selectedElementIds = useEditorStore.getState().selectedElementIds
      const selectedRoots = document.elements.filter((element) =>
        selectedElementIds.includes(element.id),
      )

      if (selectedRoots.length === 1 && selectedRoots[0].type === 'image') {
        const element = selectedRoots[0]
        const source = hasImageTransform(element)
          ? await renderElementsToPng(document, selectedRoots, scale)
          : await convertImageSourceToPng(
              element.src,
              element.width * scale,
              element.height * scale,
            )
        if (!source) return
        await downloadPng(source, element.name || '选中图片', scale)
        return
      }

      if (selectedRoots.length) {
        // 模块通常是一个容器节点，视觉内容由它的子节点组成。导出时使用完整
        // 子树，避免只得到模块根节点的空壳或背景。
        const selectedElements = collectSelectionSubtree(document, selectedRoots)
        const source = await renderElementsToPng(document, selectedElements, scale)
        if (!source) return
        await downloadPng(
          source,
          selectedRoots.length === 1 ? selectedRoots[0].name : `选中内容-${selectedRoots.length}项`,
          scale,
        )
        return
      }

      const activeArtboard =
        document.artboards.find((item) => item.id === useEditorStore.getState().activeArtboardId) ??
        document.artboards[0]
      if (!activeArtboard) return

      // PNG 是视觉交付物：将运行时组件按其画布节点展开，避免静态快照只剩
      // page-visual-shell 背景图而丢失组件内容。
      const visualExportDocument: DesignDocument = {
        ...document,
        componentInstances: {},
      }
      const snapshot = await renderArtboardSnapshot(visualExportDocument, activeArtboard.id, scale)
      await downloadPng(snapshot.data, activeArtboard.name || document.title || 'design', scale)
    } catch (error) {
      console.error('[editor] png export failed', error)
      globalThis.alert(error instanceof Error ? error.message : 'PNG 导出失败。')
    }
  }

  async function exportComponent(instanceId: string) {
    if (!document) return
    const instance = document.componentInstances?.[instanceId]
    if (!instance) return
    let packageBytes = buildComponentExportPackage(document, instanceId)
    if (instance.design.packId && window.aiCampaignRuntime?.adaptComponentExport) {
      try {
        const adapted = await window.aiCampaignRuntime.adaptComponentExport({
          packId: instance.design.packId,
          componentName: instance.componentName,
          profile: instance.profile,
          standardPackage: packageBytes,
        })
        if (adapted.applied && adapted.package) packageBytes = adapted.package
      } catch (error) {
        console.warn('[editor] component export adapter failed; using standard package', error)
      }
    }
    const blob = new Blob([packageBytes as BlobPart], {
      type: 'application/zip',
    })
    const link = globalThis.document.createElement('a')
    link.download = componentExportFileName(instance)
    link.href = URL.createObjectURL(blob)
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }

  function exportStructural(instanceId: string) {
    if (!document) return
    const instance = document.structuralInstances?.[instanceId]
    if (!instance) return
    const blob = new Blob([buildStructuralExportPackage(document, instanceId) as BlobPart], {
      type: 'application/zip',
    })
    const link = globalThis.document.createElement('a')
    link.download = structuralExportFileName(instance)
    link.href = URL.createObjectURL(blob)
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }

  async function exportPagePackage() {
    if (!document) return
    const artboard =
      document.artboards.find((item) => item.id === useEditorStore.getState().activeArtboardId) ??
      document.artboards[0]
    if (!artboard) return
    const [oneXSnapshot, twoXSnapshot] = await Promise.all([
      renderArtboardSnapshot(document, artboard.id, 1),
      renderArtboardSnapshot(document, artboard.id, 2),
    ])
    const previews = {
      oneX: await dataUrlBytes(oneXSnapshot.data),
      twoX: await dataUrlBytes(twoXSnapshot.data),
    }
    const blob = new Blob(
      [buildPageDeliveryPackage(document, artboard.id, { previews }) as BlobPart],
      {
        type: 'application/zip',
      },
    )
    const link = globalThis.document.createElement('a')
    link.download = `${sanitizeFileName(artboard.name || document.title || 'page')}-开发包.zip`
    link.href = URL.createObjectURL(blob)
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }

  async function exportCode(framework: CodeFramework) {
    if (!document) return
    try {
      const result = await buildCodeExportPackage(document, {
        framework,
        artboardId: useEditorStore.getState().activeArtboardId,
        assetMode: 'download',
      })
      if (!result.validation.valid) {
        const message = result.validation.diagnostics
          .filter((diagnostic) => diagnostic.severity === 'error')
          .map((diagnostic) => diagnostic.message)
          .join('\n')
        throw new Error(message || '代码校验失败。')
      }
      const blob = new Blob([result.bytes as BlobPart], { type: 'application/zip' })
      const link = globalThis.document.createElement('a')
      link.download = codeExportFileName(document, framework)
      link.href = URL.createObjectURL(blob)
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    } catch (error) {
      console.error('[editor] code export failed', error)
      globalThis.alert(error instanceof Error ? error.message : '代码导出失败。')
    }
  }

  async function previewCode() {
    if (!document) return
    const generated = buildCodeDocument(document, {
      framework: 'html',
      artboardId: useEditorStore.getState().activeArtboardId,
      selectionIds: useEditorStore.getState().selectedElementIds,
      assetMode: 'remote',
    })
    setCodePreview(await formatCodeDocument(generated))
  }

  function toggleJsonInspector() {
    if (leftPanelVisible && leftPanelMode === 'json') {
      setLeftPanelMode('layers')
      return
    }
    setLeftPanelVisibilityPreservingCanvas(true)
    setLeftPanelMode('json')
  }

  const hasCanvasContent = Boolean(
    document && (document.artboards.length || document.elements.length),
  )
  const hasInspectorSelection = Boolean(selectedArtboardId || selectedElementIds.length)
  const shouldShowLeftPanel = hasCanvasContent && leftPanelVisible
  const shouldShowRightPanel = hasCanvasContent && hasInspectorSelection && rightPanelVisible
  const workbenchClassName = useMemo(() => {
    if (!hasCanvasContent && !chatPanelOpen) return 'editor-workbench panels-none blank-workbench'
    if (chatPanelOpen && shouldShowLeftPanel) return 'editor-workbench panels-chat-left'
    if (chatPanelOpen) return 'editor-workbench panels-chat'
    if (shouldShowLeftPanel && shouldShowRightPanel) return 'editor-workbench panels-both'
    if (shouldShowLeftPanel) return 'editor-workbench panels-left'
    if (shouldShowRightPanel) return 'editor-workbench panels-right'
    return 'editor-workbench panels-none'
  }, [chatPanelOpen, hasCanvasContent, shouldShowLeftPanel, shouldShowRightPanel])

  const editorPageClassName = useMemo(() => {
    const classNames = ['editor-page']
    if (leftPanelVisible && hasCanvasContent) classNames.push('has-left-panel')
    if (document?.settings?.canvasMode === 'dark') classNames.push('dark-editor')
    return classNames.join(' ')
  }, [document?.settings?.canvasMode, hasCanvasContent, leftPanelVisible])

  function offsetCanvasForLeftPanel(delta: number) {
    if (!delta) return
    const state = useEditorStore.getState()
    state.setViewport({ ...state.viewport, x: state.viewport.x - delta })
  }

  function setLeftPanelVisibilityPreservingCanvas(visible: boolean) {
    const nextVisible = hasCanvasContent && visible
    if (nextVisible !== shouldShowLeftPanel) {
      offsetCanvasForLeftPanel(nextVisible ? panelWidths.left : -panelWidths.left)
    }
    setLeftPanelVisible(visible)
  }

  function toggleAllPanels() {
    const shouldShowAll = !shouldShowLeftPanel && !shouldShowRightPanel
    setLeftPanelVisibilityPreservingCanvas(shouldShowAll)
    setRightPanelVisible(shouldShowAll)
  }

  function normalizeActiveArtboardVisualStyle(
    languageId: string,
    overrides: { cornerRadius?: number },
  ) {
    const state = useEditorStore.getState()
    const currentDocument = state.document
    const artboardId = state.selectedArtboardId ?? state.activeArtboardId
    if (!currentDocument || !artboardId) return 0
    const patches = buildVisualNormalizationPatches(
      currentDocument,
      artboardId,
      languageId,
      overrides,
    )
    if (patches.length) state.updateElements(patches)
    return patches.length
  }

  function prepareVisualVariant(brief: VisualRedesignBrief) {
    const state = useEditorStore.getState()
    const currentDocument = state.document
    const artboardId = state.selectedArtboardId ?? state.activeArtboardId
    const artboard = currentDocument?.artboards.find((item) => item.id === artboardId)
    if (!currentDocument || !artboard) return
    state.selectArtboard(artboard.id)
    state.updateChatThread(state.activeChatThreadId, (thread) => ({
      ...thread,
      targetArtboardId: artboard.id,
      activeTargetArtboardId: artboard.id,
      artboardIds: Array.from(new Set([...(thread.artboardIds ?? []), artboard.id])),
      placementMode: 'duplicate-variant',
      lastPlacementMode: 'duplicate-variant',
      visualOptimizationDraft: {
        mode: 'variant',
        sourceArtboardId: artboard.id,
        sourceArtboardName: artboard.name,
        brief: structuredClone(brief),
      },
      prompt: compileVisualRedesignPrompt(brief, artboard),
    }))
    setChatPanelOpen(true)
  }

  function prepareVisualDesign(brief: VisualRedesignBrief) {
    const state = useEditorStore.getState()
    state.updateChatThread(state.activeChatThreadId, (thread) => ({
      ...thread,
      targetArtboardId: undefined,
      activeTargetArtboardId: undefined,
      placementMode: 'new-artboard',
      lastPlacementMode: 'new-artboard',
      visualOptimizationDraft: {
        mode: 'new-design',
        sourceArtboardId: '',
        sourceArtboardName: '新页面设计',
        brief: structuredClone(brief),
      },
      prompt: compileVisualDirectionPrompt(brief),
    }))
    setChatPanelOpen(true)
  }

  return (
    <div
      className={editorPageClassName}
      style={
        {
          '--left-panel-width': `${panelWidths.left}px`,
          '--right-panel-width': `${panelWidths.right}px`,
        } as CSSProperties
      }
    >
      <EditorTopBar
        chatPanelOpen={chatPanelOpen}
        leftPanelVisible={leftPanelVisible}
        rightPanelVisible={shouldShowRightPanel}
        rightPanelAvailable={hasInspectorSelection}
        onToggleLeftPanel={() => setLeftPanelVisibilityPreservingCanvas(!leftPanelVisible)}
        onToggleRightPanel={() => setRightPanelVisible((visible) => !visible)}
        onToggleAllPanels={toggleAllPanels}
        onOpenChatPanel={() => setChatPanelOpen(true)}
        onNormalizeVisualStyle={normalizeActiveArtboardVisualStyle}
        onCreateVisualVariant={prepareVisualVariant}
        onCreateVisualDesign={prepareVisualDesign}
        saveStatus={saveStatus}
        onRetrySave={retrySave}
        newDesignMode={
          !(
            selectedArtboardId ?? (selectedElementIds.length === 0 ? activeArtboardId : undefined)
          ) ||
          (Boolean(projectId?.startsWith('new-')) &&
            Boolean(document) &&
            !(document?.artboards ?? []).some((artboard) => artboard.generationMeta))
        }
      />
      <Toolbar
        onExportPng={exportPng}
        onExportPagePackage={exportPagePackage}
        onExportCode={exportCode}
        onPreviewCode={previewCode}
        onToggleJsonInspector={toggleJsonInspector}
        jsonInspectorOpen={leftPanelVisible && leftPanelMode === 'json'}
        responsivePreviewOpen={responsivePreviewOpen}
        onToggleResponsivePreview={() => setResponsivePreviewOpen((open) => !open)}
      />
      {responsivePreviewOpen ? (
        <ResponsivePreviewPanel onClose={() => setResponsivePreviewOpen(false)} />
      ) : null}
      {codePreview && document ? (
        <CodePreviewDialog code={codePreview} onClose={() => setCodePreview(null)} />
      ) : null}
      <div ref={workbenchRef} className={workbenchClassName}>
        {shouldShowLeftPanel ? (
          leftPanelMode === 'json' ? (
            <JsonInspectorPanel onBack={() => setLeftPanelMode('layers')} />
          ) : (
            <LayerPanel />
          )
        ) : null}
        {shouldShowLeftPanel ? (
          <PanelResizeHandle
            side="left"
            workbenchRef={workbenchRef}
            width={panelWidths.left}
            onWidthDelta={offsetCanvasForLeftPanel}
            onCommit={(width) => setPanelWidths((current) => ({ ...current, left: width }))}
          />
        ) : null}
        <InfiniteCanvas
          chatPanelOpen={chatPanelOpen}
          hideAiChat={chatPanelOpen}
          onOpenChatPanel={() => setChatPanelOpen(true)}
        />
        {chatPanelOpen ? (
          <ChatPanel onClose={() => setChatPanelOpen(false)} initialPrompt={initialPrompt} />
        ) : shouldShowRightPanel ? (
          <PropertyPanel
            onExportPng={() => void exportPng(1)}
            onExportComponent={exportComponent}
            onExportStructural={exportStructural}
            chatPanelOpen={chatPanelOpen}
          />
        ) : null}
        {!chatPanelOpen && shouldShowRightPanel ? (
          <PanelResizeHandle
            side="right"
            workbenchRef={workbenchRef}
            width={panelWidths.right}
            onCommit={(width) => setPanelWidths((current) => ({ ...current, right: width }))}
          />
        ) : null}
      </div>
    </div>
  )
}

function PanelResizeHandle({
  side,
  workbenchRef,
  width,
  onWidthDelta,
  onCommit,
}: {
  side: PanelSide
  workbenchRef: React.RefObject<HTMLDivElement | null>
  width: number
  onWidthDelta?: (delta: number) => void
  onCommit: (width: number) => void
}) {
  const handleRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<
    | {
        pointerId: number
        startX: number
        startWidth: number
        latestX: number
      }
    | undefined
  >(undefined)
  const frameRef = useRef<number | undefined>(undefined)
  const currentWidthRef = useRef(width)
  const definition = PANEL_WIDTHS[side]
  const propertyName = side === 'left' ? '--left-panel-width' : '--right-panel-width'
  const label = side === 'left' ? '调整左侧图层面板宽度' : '调整右侧属性面板宽度'

  useEffect(() => {
    currentWidthRef.current = width
  }, [width])

  useEffect(
    () => () => {
      if (frameRef.current !== undefined) window.cancelAnimationFrame(frameRef.current)
      globalThis.document.body.classList.remove('panel-width-resizing')
    },
    [],
  )

  function resolveWidth(requestedWidth: number) {
    const workbench = workbenchRef.current
    if (!workbench) return clamp(requestedWidth, definition.min, definition.max)
    const oppositeSelector =
      side === 'left' ? '.property-panel, .chat-panel' : '.layer-panel, .json-inspector-panel'
    const oppositePanel = workbench.querySelector<HTMLElement>(oppositeSelector)
    const oppositeWidth = oppositePanel?.getBoundingClientRect().width ?? 0
    const availableMax = workbench.getBoundingClientRect().width - oppositeWidth - MIN_CANVAS_WIDTH
    const responsiveMax = Math.max(definition.min, Math.min(definition.max, availableMax))
    return Math.round(clamp(requestedWidth, definition.min, responsiveMax))
  }

  function applyWidth(nextWidth: number) {
    const resolved = resolveWidth(nextWidth)
    const delta = resolved - currentWidthRef.current
    currentWidthRef.current = resolved
    const styleTarget = workbenchRef.current?.closest<HTMLElement>('.editor-page')
    styleTarget?.style.setProperty(propertyName, `${resolved}px`)
    handleRef.current?.setAttribute('aria-valuenow', String(resolved))
    if (delta) onWidthDelta?.(delta)
  }

  function flushDragFrame() {
    if (frameRef.current !== undefined) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = undefined
    }
    const drag = dragRef.current
    if (!drag) return
    const delta = drag.latestX - drag.startX
    applyWidth(drag.startWidth + (side === 'left' ? delta : -delta))
  }

  function finishDrag(commit: boolean) {
    const drag = dragRef.current
    if (!drag) return
    flushDragFrame()
    dragRef.current = undefined
    globalThis.document.body.classList.remove('panel-width-resizing')
    if (commit) onCommit(currentWidthRef.current)
    else applyWidth(drag.startWidth)
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: currentWidthRef.current,
      latestX: event.clientX,
    }
    globalThis.document.body.classList.add('panel-width-resizing')
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.latestX = event.clientX
    if (frameRef.current !== undefined) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = undefined
      const current = dragRef.current
      if (!current) return
      const delta = current.latestX - current.startX
      applyWidth(current.startWidth + (side === 'left' ? delta : -delta))
    })
  }

  return (
    <div
      ref={handleRef}
      className={`panel-resize-handle ${side}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={definition.min}
      aria-valuemax={definition.max}
      aria-valuenow={width}
      title={`${label}，双击恢复默认宽度`}
      onDoubleClick={() => {
        applyWidth(definition.default)
        onCommit(currentWidthRef.current)
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => {
        if (dragRef.current?.pointerId !== event.pointerId) return
        event.currentTarget.releasePointerCapture(event.pointerId)
        finishDrag(true)
      }}
      onPointerCancel={() => finishDrag(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && dragRef.current) {
          event.preventDefault()
          finishDrag(false)
          return
        }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'].includes(event.key)) return
        event.preventDefault()
        const increase = event.key === 'ArrowRight' || event.key === 'ArrowUp'
        applyWidth(currentWidthRef.current + (increase ? 1 : -1) * (event.shiftKey ? 32 : 8))
        onCommit(currentWidthRef.current)
      }}
    />
  )
}

function readPanelWidths(): PanelWidths {
  const defaults = {
    left: PANEL_WIDTHS.left.default,
    right: PANEL_WIDTHS.right.default,
  }
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY) ?? 'null',
    ) as Partial<PanelWidths> | null
    if (!stored) return defaults
    return {
      left: normalizeStoredWidth(stored.left, PANEL_WIDTHS.left),
      right: normalizeStoredWidth(stored.right, PANEL_WIDTHS.right),
    }
  } catch {
    return defaults
  }
}

function normalizeStoredWidth(
  value: number | undefined,
  definition: { min: number; max: number; default: number },
) {
  return Number.isFinite(value)
    ? Math.round(clamp(Number(value), definition.min, definition.max))
    : definition.default
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/** 返回选中节点及其全部后代，供模块级 PNG 导出使用。 */
function collectSelectionSubtree(document: DesignDocument, roots: DesignElement[]) {
  const rootIds = new Set(roots.map((element) => element.id))
  const componentInstanceIds = new Set(
    roots
      .map((element) => element.componentBinding?.instanceId)
      .filter((id): id is string => Boolean(id)),
  )
  const included = new Set(rootIds)
  let changed = true
  while (changed) {
    changed = false
    for (const element of document.elements) {
      if (included.has(element.id)) continue
      if (
        (element.parentId && included.has(element.parentId)) ||
        (element.componentBinding?.instanceId &&
          componentInstanceIds.has(element.componentBinding.instanceId))
      ) {
        included.add(element.id)
        changed = true
      }
    }
  }
  return document.elements.filter((element) => included.has(element.id))
}

async function renderElementsToPng(
  document: DesignDocument,
  elements: DesignElement[],
  scale: 1 | 2,
) {
  if (!elements.length) return undefined
  const minX = Math.min(...elements.map((element) => element.x))
  const minY = Math.min(...elements.map((element) => element.y))
  const maxX = Math.max(...elements.map((element) => element.x + element.width))
  const maxY = Math.max(...elements.map((element) => element.y + element.height))
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  const exportArtboard: Artboard = {
    id: 'selection-export',
    name: '选中内容',
    x: minX,
    y: minY,
    width,
    height,
    background: 'transparent',
    overflow: 'visible',
  }
  const exportDocument: DesignDocument = {
    ...document,
    // 选区导出需要把组件实例当作普通设计节点展开，否则渲染器会将
    // 组件内部节点过滤掉，只剩下不可见的运行时根节点。
    componentInstances: {},
    artboards: [...document.artboards, exportArtboard],
    elements: elements.map(
      (element) =>
        ({
          ...element,
          artboardId: exportArtboard.id,
        }) as DesignElement,
    ),
  }
  const snapshot = await renderArtboardSnapshot(exportDocument, exportArtboard.id, scale)
  return snapshot.data
}

async function convertImageSourceToPng(src: string, targetWidth: number, targetHeight: number) {
  const image = await loadExportImage(src)
  const width = Math.max(1, Math.round(targetWidth))
  const height = Math.max(1, Math.round(targetHeight))
  const canvas = globalThis.document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return undefined
  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL('image/png')
}

function loadExportImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('选中图片无法导出。'))
    image.src = src
  })
}

function hasImageTransform(element: DesignElement) {
  return Boolean(
    element.rotation ||
    element.flipX ||
    element.flipY ||
    (element.opacity !== undefined && element.opacity !== 1),
  )
}

async function downloadPng(src: string, name: string, scale: 1 | 2) {
  const response = await fetch(src)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = globalThis.document.createElement('a')
  link.download = buildImageDownloadName(name || 'design', 'png', scale === 2 ? '@2x' : '')
  link.href = url
  globalThis.document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function sanitizeFileName(name: string) {
  return name.trim().replace(/[\\/:*?"<>|]/g, '-')
}

async function dataUrlBytes(dataUrl: string) {
  const response = await fetch(dataUrl)
  return new Uint8Array(await response.arrayBuffer())
}
