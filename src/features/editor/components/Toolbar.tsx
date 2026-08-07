import { ChangeEvent, useRef, useState } from 'react'
import {
  ChevronDown,
  Download,
  FileJson,
  Hand,
  Image,
  MousePointer2,
  PanelTop,
  Redo2,
  RotateCcw,
  ScanLine,
  Square,
  Type,
  Undo2,
} from 'lucide-react'
import { useEditorStore } from '../store/editor-store'
import {
  ARTBOARD_GAP,
  DEFAULT_ARTBOARD_HEIGHT,
  DEFAULT_ARTBOARD_WIDTH,
} from '../constants'
import type { DesignElement, EditorTool } from '../types'
import { cn } from '../../../lib/cn'

interface ToolbarProps {
  onExportPng: (scale: 1 | 2) => void
  onExportPagePackage: () => void
  onToggleJsonInspector: () => void
  jsonInspectorOpen: boolean
}

const tools: Array<{ value: EditorTool; label: string; icon: typeof MousePointer2 }> = [
  { value: 'select', label: '选择', icon: MousePointer2 },
  { value: 'hand', label: '移动画布', icon: Hand },
  { value: 'text', label: '文本', icon: Type },
  { value: 'shape', label: '形状', icon: Square },
  { value: 'image', label: '图片', icon: Image },
  { value: 'slice', label: '切图', icon: ScanLine },
]

export function Toolbar({ onExportPng, onExportPagePackage, onToggleJsonInspector, jsonInspectorOpen }: ToolbarProps) {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const document = useEditorStore((state) => state.document)
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId)
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const tool = useEditorStore((state) => state.tool)
  const setTool = useEditorStore((state) => state.setTool)
  const addElement = useEditorStore((state) => state.addElement)
  const addArtboard = useEditorStore((state) => state.addArtboard)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const selectedElements = document?.elements.filter((element) =>
    selectedElementIds.includes(element.id),
  ) ?? []
  const exportPngTitle = selectedElements.length === 1 && selectedElements[0].type === 'image'
    ? '导出选中图片 PNG'
    : selectedElements.length
      ? '导出选中内容 PNG'
      : '导出画板 PNG'

  function getBasePosition() {
    const artboard =
      document?.artboards.find((item) => item.id === activeArtboardId) ??
      document?.artboards[0]

    return {
      artboardId: artboard?.id,
      x: (artboard?.x ?? 0) + 48,
      y: (artboard?.y ?? 0) + 72,
      zIndex: document?.elements.length ? Math.max(...document.elements.map((item) => item.zIndex)) + 1 : 1,
    }
  }

  function addTextElement() {
    const base = getBasePosition()
    addElement({
      id: `text-${Date.now()}`,
      artboardId: base.artboardId,
      type: 'text',
      name: '新文本',
      x: base.x,
      y: base.y,
      width: 180,
      height: 48,
      zIndex: base.zIndex,
      content: '双击编辑文本',
      style: {
        fontSize: 24,
        fontWeight: 800,
        color: '#111827',
        lineHeight: 1.2,
      },
    })
    setTool('select')
  }

  function addShapeElement() {
    const base = getBasePosition()
    addElement({
      id: `shape-${Date.now()}`,
      artboardId: base.artboardId,
      type: 'shape',
      name: '矩形',
      x: base.x,
      y: base.y,
      width: 140,
      height: 92,
      zIndex: base.zIndex,
      shape: 'rect',
      fill: '#dbeafe',
      stroke: '#60a5fa',
      strokeWidth: 1,
      borderRadius: 16,
    })
    setTool('select')
  }

  function addCanvasArtboard() {
    if (!document) return
    const maxX = Math.max(0, ...document.artboards.map((artboard) => artboard.x + artboard.width))
    addArtboard({
      id: `artboard-${Date.now()}`,
      name: '新画板',
      x: document.artboards.length ? maxX + ARTBOARD_GAP : 0,
      y: 0,
      width: DEFAULT_ARTBOARD_WIDTH,
      height: DEFAULT_ARTBOARD_HEIGHT,
      background: '#ffffff',
      borderRadius: 0,
      overflow: 'hidden',
      autoHeight: true,
    })
    setTool('select')
  }

  async function onImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    const src = await readFileAsDataUrl(file)
    const size = await readImageSize(src)
    const base = getBasePosition()
    const element: DesignElement = {
      id: `image-${Date.now()}`,
      artboardId: base.artboardId,
      type: 'image',
      name: file.name || '图片',
      x: base.x,
      y: base.y,
      width: size.width,
      height: size.height,
      zIndex: base.zIndex,
      src,
      objectFit: 'fill',
      borderRadius: 0,
    }
    addElement(element)
    setTool('select')
    event.target.value = ''
  }

  function onToolClick(value: EditorTool) {
    if (value === 'text') {
      addTextElement()
      return
    }
    if (value === 'shape') {
      addShapeElement()
      return
    }
    if (value === 'image') {
      imageInputRef.current?.click()
      return
    }
    setTool(value)
  }

  return (
    <div className="editor-toolbar">
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={onImageSelected}
      />
      <div className="tool-group">
        {tools.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.value}
              className={cn('icon-button', tool === item.value && 'active')}
              type="button"
              title={item.label}
              onClick={() => onToolClick(item.value)}
            >
              <Icon size={18} />
            </button>
          )
        })}
        <button className="icon-button" type="button" title="新增画板" onClick={addCanvasArtboard}>
          <PanelTop size={18} />
        </button>
      </div>
      <div className="tool-group">
        <button className="icon-button" type="button" title="撤销" onClick={undo}>
          <Undo2 size={18} />
        </button>
        <button className="icon-button" type="button" title="重做" onClick={redo}>
          <Redo2 size={18} />
        </button>
      </div>
      <div className="tool-group">
        <div className="toolbar-export-menu">
          <button
            className="icon-button export-trigger"
            type="button"
            title={exportPngTitle}
            aria-haspopup="menu"
            aria-expanded={exportMenuOpen}
            onClick={() => setExportMenuOpen((open) => !open)}
          >
            <Download size={18} />
            <ChevronDown size={12} />
          </button>
          {exportMenuOpen ? (
            <div className="toolbar-export-options" role="menu" aria-label="导出选项">
              <button type="button" role="menuitem" onClick={() => {
                setExportMenuOpen(false)
                onExportPng(1)
              }}>
                <strong>PNG 1x</strong>
                <small>375px 逻辑尺寸</small>
              </button>
              <button type="button" role="menuitem" onClick={() => {
                setExportMenuOpen(false)
                onExportPagePackage()
              }}>
                <strong>页面开发包</strong>
                <small>配置、组件、切图与质量报告</small>
              </button>
              <button type="button" role="menuitem" onClick={() => {
                setExportMenuOpen(false)
                onExportPng(2)
              }}>
                <strong>PNG 2x</strong>
                <small>750px 高清尺寸</small>
              </button>
            </div>
          ) : null}
        </div>
        <button
          className={cn('icon-button', jsonInspectorOpen && 'active')}
          type="button"
          title="检查 JSON 结构"
          onClick={onToggleJsonInspector}
        >
          <FileJson size={18} />
        </button>
      </div>
      <div className="tool-hint">
        <RotateCcw size={15} />
        空格拖动画布，滚轮缩放
      </div>
    </div>
  )
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function readImageSize(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new globalThis.Image()
    image.onload = () => {
      resolve({
        width: Math.max(1, image.naturalWidth || image.width),
        height: Math.max(1, image.naturalHeight || image.height),
      })
    }
    image.onerror = reject
    image.src = src
  })
}
