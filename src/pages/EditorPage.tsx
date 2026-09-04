import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
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
import {
  buildVisualNormalizationPatches,
  compileVisualDirectionPrompt,
  compileVisualRedesignPrompt,
  type VisualRedesignBrief,
} from '../features/editor/utils/visual-brief'

export function EditorPage() {
  const { projectId } = useParams()
  const document = useEditorStore((state) => state.document)
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId)
  const selectedArtboardId = useEditorStore((state) => state.selectedArtboardId)
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const chatThreads = useEditorStore((state) => state.chatThreads)
  const activeChatThreadId = useEditorStore((state) => state.activeChatThreadId)
  const mutationLedger = useEditorStore((state) => state.mutationLedger)
  const viewport = useEditorStore((state) => state.viewport)
  const hydrateWorkspace = useEditorStore((state) => state.hydrateWorkspace)
  const [workspaceReady, setWorkspaceReady] = useState(false)
  const [leftPanelVisible, setLeftPanelVisible] = useState(true)
  const [leftPanelMode, setLeftPanelMode] = useState<'layers' | 'json'>('layers')
  const [rightPanelVisible, setRightPanelVisible] = useState(true)
  const [chatPanelOpen, setChatPanelOpen] = useState(false)
  const [responsivePreviewOpen, setResponsivePreviewOpen] = useState(false)
  const [codePreview, setCodePreview] = useState<CodeDocument | null>(null)

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
    if (!workspaceReady || !document || !window.aiCampaignProjects) return undefined
    const timer = window.setTimeout(() => {
      void window.aiCampaignProjects?.save({
        schemaVersion: 1,
        projectId: document.id,
        document: { ...document, viewport },
        chatThreads,
        activeChatThreadId,
        mutationLedger,
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      })
    }, 800)
    return () => window.clearTimeout(timer)
  }, [activeChatThreadId, chatThreads, document, mutationLedger, viewport, workspaceReady])

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
    setLeftPanelVisible(true)
    setLeftPanelMode('json')
  }

  const hasCanvasContent = Boolean(
    document && (document.artboards.length || document.elements.length),
  )
  const shouldShowLeftPanel = hasCanvasContent && leftPanelVisible
  const shouldShowRightPanel = hasCanvasContent && rightPanelVisible
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

  function toggleAllPanels() {
    const shouldShowAll = !leftPanelVisible && !rightPanelVisible
    setLeftPanelVisible(shouldShowAll)
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
      visualOptimizationDraft: undefined,
      prompt: compileVisualDirectionPrompt(brief),
    }))
    setChatPanelOpen(true)
  }

  return (
    <div className={editorPageClassName}>
      <EditorTopBar
        chatPanelOpen={chatPanelOpen}
        leftPanelVisible={leftPanelVisible}
        rightPanelVisible={rightPanelVisible}
        onToggleLeftPanel={() => setLeftPanelVisible((visible) => !visible)}
        onToggleRightPanel={() => setRightPanelVisible((visible) => !visible)}
        onToggleAllPanels={toggleAllPanels}
        onOpenChatPanel={() => setChatPanelOpen(true)}
        onNormalizeVisualStyle={normalizeActiveArtboardVisualStyle}
        onCreateVisualVariant={prepareVisualVariant}
        onCreateVisualDesign={prepareVisualDesign}
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
      <div className={workbenchClassName}>
        {shouldShowLeftPanel ? (
          leftPanelMode === 'json' ? (
            <JsonInspectorPanel onBack={() => setLeftPanelMode('layers')} />
          ) : (
            <LayerPanel />
          )
        ) : null}
        <InfiniteCanvas
          chatPanelOpen={chatPanelOpen}
          hideAiChat={chatPanelOpen}
          onOpenChatPanel={() => setChatPanelOpen(true)}
        />
        {chatPanelOpen ? (
          <ChatPanel onClose={() => setChatPanelOpen(false)} />
        ) : shouldShowRightPanel ? (
          <PropertyPanel
            onExportPng={() => void exportPng(1)}
            onExportComponent={exportComponent}
            onExportStructural={exportStructural}
            chatPanelOpen={chatPanelOpen}
          />
        ) : null}
      </div>
    </div>
  )
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
  const suffix = scale === 2 ? '@2x' : ''
  link.download = `${sanitizeFileName(name) || 'design'}${suffix}.png`
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
