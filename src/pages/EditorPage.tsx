import { useEffect, useMemo, useState } from 'react'
import html2canvas from 'html2canvas'
import { useParams } from 'react-router-dom'
import { ChatPanel } from '../features/editor/components/ChatPanel'
import { EditorTopBar } from '../features/editor/components/EditorTopBar'
import { InfiniteCanvas } from '../features/editor/components/InfiniteCanvas'
import { LayerPanel } from '../features/editor/components/LayerPanel'
import { JsonInspectorPanel } from '../features/editor/components/JsonInspectorPanel'
import { PropertyPanel } from '../features/editor/components/PropertyPanel'
import { Toolbar } from '../features/editor/components/Toolbar'
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

export function EditorPage() {
  const { projectId } = useParams()
  const document = useEditorStore((state) => state.document)
  const chatThreads = useEditorStore((state) => state.chatThreads)
  const activeChatThreadId = useEditorStore((state) => state.activeChatThreadId)
  const viewport = useEditorStore((state) => state.viewport)
  const hydrateWorkspace = useEditorStore((state) => state.hydrateWorkspace)
  const [workspaceReady, setWorkspaceReady] = useState(false)
  const [leftPanelVisible, setLeftPanelVisible] = useState(true)
  const [leftPanelMode, setLeftPanelMode] = useState<'layers' | 'json'>('layers')
  const [rightPanelVisible, setRightPanelVisible] = useState(true)
  const [chatPanelOpen, setChatPanelOpen] = useState(false)

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
      hydrateWorkspace(saved
        ? {
            document: saved.document,
            chatThreads: saved.chatThreads,
            activeChatThreadId: saved.activeChatThreadId,
          }
        : {
            document: createBlankDocument(
              resolvedProjectId.startsWith('new') ? '未命名项目' : '空白项目',
              resolvedProjectId,
            ),
            chatThreads: [],
            activeChatThreadId: 'panel-thread-default',
          })
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
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      })
    }, 800)
    return () => window.clearTimeout(timer)
  }, [activeChatThreadId, chatThreads, document, viewport, workspaceReady])

  async function exportPng(scale: 1 | 2) {
    if (!document) return
    const selectedElementIds = useEditorStore.getState().selectedElementIds
    const selectedElements = document.elements.filter((element) =>
      selectedElementIds.includes(element.id),
    )

    if (selectedElements.length === 1 && selectedElements[0].type === 'image') {
      const element = selectedElements[0]
      const source = hasImageTransform(element)
        ? await renderElementsToPng(document, selectedElements, scale)
        : await convertImageSourceToPng(element.src, element.width * scale, element.height * scale)
      if (!source) return
      await downloadPng(source, element.name || '选中图片', scale)
      return
    }

    if (selectedElements.length) {
      const source = await renderElementsToPng(document, selectedElements, scale)
      if (!source) return
      await downloadPng(
        source,
        selectedElements.length === 1 ? selectedElements[0].name : `选中内容-${selectedElements.length}项`,
        scale,
      )
      return
    }

    const activeArtboard =
      document.artboards.find((item) => item.id === useEditorStore.getState().activeArtboardId) ??
      document.artboards[0]
    if (!activeArtboard) return

    const exportNode = createExportNode(document, activeArtboard)
    globalThis.document.body.appendChild(exportNode)

    const canvas = await html2canvas(exportNode, {
      backgroundColor: null,
      useCORS: true,
      scale,
    })
    await downloadPng(
      canvas.toDataURL('image/png'),
      activeArtboard.name || document.title || 'design',
      scale,
    )
    exportNode.remove()
  }

  function exportComponent(instanceId: string) {
    if (!document) return
    const instance = document.componentInstances?.[instanceId]
    if (!instance) return
    const blob = new Blob([buildComponentExportPackage(document, instanceId) as BlobPart], {
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
    const artboard = document.artboards.find(
      (item) => item.id === useEditorStore.getState().activeArtboardId,
    ) ?? document.artboards[0]
    if (!artboard) return
    const exportNode = createExportNode(document, artboard)
    globalThis.document.body.appendChild(exportNode)
    let previews: { oneX: Uint8Array; twoX: Uint8Array }
    try {
      const twoXCanvas = await html2canvas(exportNode, {
        backgroundColor: null,
        useCORS: true,
        scale: 2,
      })
      const oneXCanvas = globalThis.document.createElement('canvas')
      oneXCanvas.width = Math.max(1, Math.round(twoXCanvas.width / 2))
      oneXCanvas.height = Math.max(1, Math.round(twoXCanvas.height / 2))
      oneXCanvas.getContext('2d')?.drawImage(
        twoXCanvas,
        0,
        0,
        oneXCanvas.width,
        oneXCanvas.height,
      )
      previews = {
        oneX: await dataUrlBytes(oneXCanvas.toDataURL('image/png')),
        twoX: await dataUrlBytes(twoXCanvas.toDataURL('image/png')),
      }
    } finally {
      exportNode.remove()
    }
    const blob = new Blob([buildPageDeliveryPackage(document, artboard.id, { previews }) as BlobPart], {
      type: 'application/zip',
    })
    const link = globalThis.document.createElement('a')
    link.download = `${sanitizeFileName(artboard.name || document.title || 'page')}-开发包.zip`
    link.href = URL.createObjectURL(blob)
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }

  function toggleJsonInspector() {
    if (leftPanelVisible && leftPanelMode === 'json') {
      setLeftPanelMode('layers')
      return
    }
    setLeftPanelVisible(true)
    setLeftPanelMode('json')
  }

  const hasCanvasContent = Boolean(document && (document.artboards.length || document.elements.length))
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
      />
      <Toolbar
        onExportPng={exportPng}
        onExportPagePackage={exportPagePackage}
        onToggleJsonInspector={toggleJsonInspector}
        jsonInspectorOpen={leftPanelVisible && leftPanelMode === 'json'}
      />
      <div className={workbenchClassName}>
        {shouldShowLeftPanel ? (
          leftPanelMode === 'json'
            ? <JsonInspectorPanel onBack={() => setLeftPanelMode('layers')} />
            : <LayerPanel />
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
            onExportComponent={exportComponent}
            onExportStructural={exportStructural}
          />
        ) : null}
      </div>
    </div>
  )
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
    elements: elements.map((element) => ({
      ...element,
      artboardId: exportArtboard.id,
    } as DesignElement)),
  }
  const exportNode = createExportNode(exportDocument, exportArtboard)
  globalThis.document.body.appendChild(exportNode)
  try {
    const canvas = await html2canvas(exportNode, {
      backgroundColor: null,
      useCORS: true,
      scale,
    })
    return canvas.toDataURL('image/png')
  } finally {
    exportNode.remove()
  }
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

function createExportNode(document: DesignDocument, artboard: Artboard) {
  const root = globalThis.document.createElement('div')
  root.style.position = 'fixed'
  root.style.left = '-10000px'
  root.style.top = '0'
  root.style.width = `${artboard.width}px`
  root.style.height = `${artboard.height}px`
  root.style.overflow = artboard.overflow ?? 'hidden'
  root.style.background = artboard.background
  root.style.borderRadius = `${artboard.borderRadius ?? 0}px`

  document.elements
    .filter((element) => element.artboardId === artboard.id && element.visible !== false)
    .sort((a, b) => a.zIndex - b.zIndex)
    .forEach((element) => {
      root.appendChild(createExportElement(element, artboard))
    })

  return root
}

function createExportElement(element: DesignElement, artboard: Artboard) {
  const node = globalThis.document.createElement('div')
  node.style.position = 'absolute'
  node.style.left = `${element.x - artboard.x}px`
  node.style.top = `${element.y - artboard.y}px`
  node.style.width = `${element.width}px`
  node.style.height = `${element.height}px`
  node.style.opacity = `${element.opacity ?? 1}`
  node.style.zIndex = `${element.zIndex}`
  node.style.transform = `rotate(${element.rotation ?? 0}deg) scale(${element.flipX ? -1 : 1}, ${
    element.flipY ? -1 : 1
  })`
  node.style.transformOrigin = 'center'
  node.style.overflow = 'hidden'

  if (element.type === 'text') {
    node.textContent = element.content
    node.style.whiteSpace = 'pre-wrap'
    node.style.color = element.style.color
    node.style.fontSize = `${element.style.fontSize}px`
    node.style.fontWeight = `${element.style.fontWeight ?? 400}`
    node.style.lineHeight = `${element.style.lineHeight ?? 1.2}`
    node.style.textAlign = element.style.textAlign ?? 'left'
    if (element.style.fontFamily) node.style.fontFamily = element.style.fontFamily
    return node
  }

  if (element.type === 'image') {
    const image = globalThis.document.createElement('img')
    image.src = element.src
    image.crossOrigin = 'anonymous'
    image.style.width = '100%'
    image.style.height = '100%'
    image.style.objectFit = element.objectFit ?? 'cover'
    image.style.borderRadius = `${element.borderRadius ?? 0}px`
    node.appendChild(image)
    return node
  }

  if (element.type === 'button') {
    node.textContent = element.content
    node.style.display = 'grid'
    node.style.placeItems = 'center'
    node.style.background = element.style.background
    node.style.color = element.style.color
    node.style.fontSize = `${element.style.fontSize}px`
    node.style.fontWeight = `${element.style.fontWeight ?? 700}`
    node.style.borderRadius = `${element.style.borderRadius ?? 0}px`
    return node
  }

  if (element.type === 'section') return node

  if (element.type === 'runtime-placeholder') {
    node.textContent = element.label
    node.style.display = 'grid'
    node.style.placeItems = 'center'
    node.style.border = '1px dashed #94a3b8'
    node.style.background = '#f1f5f9'
    node.style.color = '#64748b'
    node.style.fontSize = '11px'
    return node
  }

  node.style.background = element.fill
  node.style.borderStyle = element.stroke ? 'solid' : 'none'
  node.style.borderColor = element.stroke ?? 'transparent'
  node.style.borderWidth = `${element.strokeWidth ?? 0}px`
  node.style.borderRadius = element.shape === 'circle' ? '50%' : `${element.borderRadius ?? 0}px`
  return node
}
