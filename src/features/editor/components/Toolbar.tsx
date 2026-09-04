import { ChangeEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  Columns3,
  Code2,
  Download,
  FileJson,
  Hand,
  Image,
  Monitor,
  MousePointer2,
  PanelTop,
  Redo2,
  RotateCcw,
  ScanLine,
  Square,
  Smartphone,
  Settings2,
  Tablet,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react'
import { useEditorStore } from '../store/editor-store'
import { ARTBOARD_GAP, DEFAULT_ARTBOARD_HEIGHT, DEFAULT_ARTBOARD_WIDTH } from '../constants'
import type { DesignElement, EditorTool } from '../types'
import { cn } from '../../../lib/cn'

interface ToolbarProps {
  onExportPng: (scale: 1 | 2) => void
  onExportPagePackage: () => void
  onExportCode: (framework: 'html' | 'react' | 'vue') => void
  onPreviewCode: () => void
  onToggleJsonInspector: () => void
  jsonInspectorOpen: boolean
  responsivePreviewOpen: boolean
  onToggleResponsivePreview: () => void
}

interface BreakpointDraft {
  label: string
  width: number
  height: number
  primaryColor: string
  radius: number
  density: 'compact' | 'comfortable'
  contentPadding: number
  blockGap: number
  sidebarMode: 'auto' | 'expanded' | 'collapsed'
}

interface BreakpointMenuPlacement {
  left: number
  top: number
  maxHeight: number
}

const tools: Array<{ value: EditorTool; label: string; icon: typeof MousePointer2 }> = [
  { value: 'select', label: '选择', icon: MousePointer2 },
  { value: 'hand', label: '移动画布', icon: Hand },
  { value: 'text', label: '文本', icon: Type },
  { value: 'shape', label: '形状', icon: Square },
  { value: 'image', label: '图片', icon: Image },
  { value: 'slice', label: '切图', icon: ScanLine },
]

export function Toolbar({
  onExportPng,
  onExportPagePackage,
  onExportCode,
  onPreviewCode,
  onToggleJsonInspector,
  jsonInspectorOpen,
  responsivePreviewOpen,
  onToggleResponsivePreview,
}: ToolbarProps) {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const breakpointMenuRef = useRef<HTMLDivElement>(null)
  const breakpointTriggerRef = useRef<HTMLButtonElement>(null)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [breakpointMenuOpen, setBreakpointMenuOpen] = useState(false)
  const [breakpointMenuPlacement, setBreakpointMenuPlacement] = useState<BreakpointMenuPlacement>()
  const [creatingBreakpoint, setCreatingBreakpoint] = useState(false)
  const [breakpointDraft, setBreakpointDraft] = useState<BreakpointDraft>({
    label: '',
    width: 1280,
    height: 900,
    primaryColor: '#2563eb',
    radius: 6,
    density: 'comfortable' as 'compact' | 'comfortable',
    contentPadding: 24,
    blockGap: 16,
    sidebarMode: 'auto' as 'auto' | 'expanded' | 'collapsed',
  })
  const document = useEditorStore((state) => state.document)
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId)
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const tool = useEditorStore((state) => state.tool)
  const setTool = useEditorStore((state) => state.setTool)
  const addElement = useEditorStore((state) => state.addElement)
  const addArtboard = useEditorStore((state) => state.addArtboard)
  const setDesignBreakpoint = useEditorStore((state) => state.setDesignBreakpoint)
  const upsertDesignBreakpoint = useEditorStore((state) => state.upsertDesignBreakpoint)
  const removeDesignBreakpoint = useEditorStore((state) => state.removeDesignBreakpoint)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const selectedElements =
    document?.elements.filter((element) => selectedElementIds.includes(element.id)) ?? []
  const activeArtboard = document?.artboards.find((item) => item.id === activeArtboardId)
  const activeBreakpoint =
    activeArtboard?.designBreakpointId ??
    ((activeArtboard?.width ?? 1440) < 600
      ? 'mobile'
      : (activeArtboard?.width ?? 1440) < 1024
        ? 'tablet'
        : 'desktop')
  const designBreakpoints = activeArtboard?.designSpec?.responsive?.breakpoints ?? []
  const toolbarBreakpoints = designBreakpoints.filter(
    (item) => ['mobile', 'tablet', 'desktop'].includes(item.id) || item.id === activeBreakpoint,
  )
  const exportPngTitle =
    selectedElements.length === 1 && selectedElements[0].type === 'image'
      ? '导出选中图片 PNG'
      : selectedElements.length
        ? '导出选中内容 PNG'
        : '导出画板 PNG'

  const updateBreakpointMenuPlacement = useCallback(() => {
    const trigger = breakpointTriggerRef.current
    const menu = breakpointMenuRef.current
    if (!trigger || !menu) return

    const viewportMargin = 8
    const triggerGap = 8
    const triggerRect = trigger.getBoundingClientRect()
    const menuWidth = menu.offsetWidth
    const maxHeight = Math.max(0, window.innerHeight - viewportMargin * 2)
    const menuHeight = Math.min(menu.scrollHeight, maxHeight)
    const spaceRight = window.innerWidth - triggerRect.right - triggerGap - viewportMargin
    const spaceLeft = triggerRect.left - triggerGap - viewportMargin
    const placeRight = menuWidth <= spaceRight || spaceRight >= spaceLeft
    const preferredLeft = placeRight
      ? triggerRect.right + triggerGap
      : triggerRect.left - triggerGap - menuWidth
    const left = Math.min(
      Math.max(viewportMargin, preferredLeft),
      Math.max(viewportMargin, window.innerWidth - viewportMargin - menuWidth),
    )
    const top = Math.min(
      Math.max(viewportMargin, triggerRect.top),
      Math.max(viewportMargin, window.innerHeight - viewportMargin - menuHeight),
    )

    setBreakpointMenuPlacement({ left, top, maxHeight })
  }, [])

  useLayoutEffect(() => {
    if (!breakpointMenuOpen) {
      setBreakpointMenuPlacement(undefined)
      return
    }
    updateBreakpointMenuPlacement()
  }, [
    breakpointMenuOpen,
    creatingBreakpoint,
    designBreakpoints.length,
    updateBreakpointMenuPlacement,
  ])

  useEffect(() => {
    if (!breakpointMenuOpen) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        breakpointMenuRef.current?.contains(target) ||
        breakpointTriggerRef.current?.contains(target)
      )
        return
      setBreakpointMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBreakpointMenuOpen(false)
    }
    let frame = 0
    const schedulePlacementUpdate = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updateBreakpointMenuPlacement)
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', schedulePlacementUpdate)
    window.addEventListener('scroll', schedulePlacementUpdate, true)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', schedulePlacementUpdate)
      window.removeEventListener('scroll', schedulePlacementUpdate, true)
    }
  }, [breakpointMenuOpen, updateBreakpointMenuPlacement])

  function getBasePosition() {
    const artboard =
      document?.artboards.find((item) => item.id === activeArtboardId) ?? document?.artboards[0]

    return {
      artboardId: artboard?.id,
      x: (artboard?.x ?? 0) + 48,
      y: (artboard?.y ?? 0) + 72,
      zIndex: document?.elements.length
        ? Math.max(...document.elements.map((item) => item.zIndex)) + 1
        : 1,
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

  function openBreakpointMenu() {
    const current = designBreakpoints.find((item) => item.id === activeBreakpoint)
    setBreakpointDraft(createBreakpointDraft(current, activeArtboard))
    setCreatingBreakpoint(false)
    setBreakpointMenuOpen((open) => !open)
  }

  function saveBreakpoint() {
    if (!activeArtboard?.designSpec) return
    const existing = designBreakpoints.find((item) => item.id === activeBreakpoint)
    const id =
      existing && !creatingBreakpoint
        ? existing.id
        : createBreakpointId(
            breakpointDraft.label,
            designBreakpoints.map((item) => item.id),
          )
    upsertDesignBreakpoint(activeArtboard.id, {
      id,
      label: breakpointDraft.label,
      viewport: { width: breakpointDraft.width, height: breakpointDraft.height },
      overrides: {
        theme: {
          ...existing?.overrides?.theme,
          colors: replacePrimaryColor(
            activeArtboard.designSpec.theme.colors,
            breakpointDraft.primaryColor,
          ),
          radius: breakpointDraft.radius,
          density: breakpointDraft.density,
        },
        layout: {
          ...existing?.overrides?.layout,
          contentPadding: breakpointDraft.contentPadding,
          blockGap: breakpointDraft.blockGap,
          sidebarMode: breakpointDraft.sidebarMode,
        },
      },
    })
    setDesignBreakpoint(activeArtboard.id, id)
    setBreakpointMenuOpen(false)
  }

  return (
    <div className="editor-toolbar">
      <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={onImageSelected} />
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
      {activeArtboard?.designSpec ? (
        <div className="tool-group breakpoint-control" role="group" aria-label="响应式预览尺寸">
          {toolbarBreakpoints.map((breakpoint) => {
            const Icon =
              breakpoint.id === 'mobile'
                ? Smartphone
                : breakpoint.id === 'tablet'
                  ? Tablet
                  : Monitor
            return (
              <button
                key={breakpoint.id}
                className={cn('icon-button', activeBreakpoint === breakpoint.id && 'active')}
                type="button"
                title={`${breakpoint.label} ${breakpoint.viewport.width}×${breakpoint.viewport.height}`}
                aria-label={`${breakpoint.label}预览`}
                aria-pressed={activeBreakpoint === breakpoint.id}
                onClick={() => setDesignBreakpoint(activeArtboard.id, breakpoint.id)}
              >
                <Icon size={17} />
              </button>
            )
          })}
          <button
            className={cn('icon-button', responsivePreviewOpen && 'active')}
            type="button"
            title="并排预览所有断点"
            aria-pressed={responsivePreviewOpen}
            onClick={onToggleResponsivePreview}
          >
            <Columns3 size={17} />
          </button>
          <div className="breakpoint-menu-wrap">
            <button
              ref={breakpointTriggerRef}
              className="icon-button"
              type="button"
              title="管理断点"
              aria-haspopup="dialog"
              aria-expanded={breakpointMenuOpen}
              onClick={openBreakpointMenu}
            >
              <Settings2 size={17} />
            </button>
            {breakpointMenuOpen && globalThis.document?.body
              ? createPortal(
                  <div
                    ref={breakpointMenuRef}
                    className={cn(
                      'breakpoint-menu',
                      globalThis.document.querySelector('.editor-page.dark-editor') &&
                        'dark-editor-surface',
                    )}
                    role="dialog"
                    aria-label="断点设置"
                    style={{
                      left: breakpointMenuPlacement?.left ?? 8,
                      top: breakpointMenuPlacement?.top ?? 8,
                      maxHeight: breakpointMenuPlacement?.maxHeight,
                      visibility: breakpointMenuPlacement ? 'visible' : 'hidden',
                    }}
                  >
                    <strong>断点设置</strong>
                    <div className="breakpoint-menu-list" aria-label="已有断点">
                      {designBreakpoints.map((breakpoint) => (
                        <button
                          key={breakpoint.id}
                          type="button"
                          className={
                            breakpoint.id === activeBreakpoint && !creatingBreakpoint
                              ? 'active'
                              : undefined
                          }
                          onClick={() => {
                            setCreatingBreakpoint(false)
                            setDesignBreakpoint(activeArtboard.id, breakpoint.id)
                            setBreakpointDraft(createBreakpointDraft(breakpoint, activeArtboard))
                          }}
                        >
                          <span>{breakpoint.label}</span>
                          <small>
                            {breakpoint.viewport.width}×{breakpoint.viewport.height}
                          </small>
                        </button>
                      ))}
                    </div>
                    <label>
                      <span>名称</span>
                      <input
                        value={breakpointDraft.label}
                        onChange={(event) =>
                          setBreakpointDraft((draft) => ({ ...draft, label: event.target.value }))
                        }
                      />
                    </label>
                    <div className="breakpoint-size-fields">
                      <label>
                        <span>宽度</span>
                        <input
                          type="number"
                          min="320"
                          max="2560"
                          value={breakpointDraft.width}
                          onChange={(event) =>
                            setBreakpointDraft((draft) => ({
                              ...draft,
                              width: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>高度</span>
                        <input
                          type="number"
                          min="320"
                          max="10000"
                          value={breakpointDraft.height}
                          onChange={(event) =>
                            setBreakpointDraft((draft) => ({
                              ...draft,
                              height: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="breakpoint-override-heading">
                      <strong>样式覆盖</strong>
                      <span>仅应用于当前断点</span>
                    </div>
                    <div className="breakpoint-size-fields">
                      <label>
                        <span>主色</span>
                        <input
                          type="color"
                          value={breakpointDraft.primaryColor}
                          onChange={(event) =>
                            setBreakpointDraft((draft) => ({
                              ...draft,
                              primaryColor: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>圆角</span>
                        <input
                          type="number"
                          min="0"
                          max="32"
                          value={breakpointDraft.radius}
                          onChange={(event) =>
                            setBreakpointDraft((draft) => ({
                              ...draft,
                              radius: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>内容边距</span>
                        <input
                          type="number"
                          min="0"
                          max="96"
                          value={breakpointDraft.contentPadding}
                          onChange={(event) =>
                            setBreakpointDraft((draft) => ({
                              ...draft,
                              contentPadding: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>区块间距</span>
                        <input
                          type="number"
                          min="0"
                          max="64"
                          value={breakpointDraft.blockGap}
                          onChange={(event) =>
                            setBreakpointDraft((draft) => ({
                              ...draft,
                              blockGap: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="breakpoint-size-fields">
                      <label>
                        <span>密度</span>
                        <select
                          value={breakpointDraft.density}
                          onChange={(event) =>
                            setBreakpointDraft((draft) => ({
                              ...draft,
                              density: event.target.value as 'compact' | 'comfortable',
                            }))
                          }
                        >
                          <option value="compact">紧凑</option>
                          <option value="comfortable">舒适</option>
                        </select>
                      </label>
                      <label>
                        <span>侧栏</span>
                        <select
                          value={breakpointDraft.sidebarMode}
                          onChange={(event) =>
                            setBreakpointDraft((draft) => ({
                              ...draft,
                              sidebarMode: event.target.value as 'auto' | 'expanded' | 'collapsed',
                            }))
                          }
                        >
                          <option value="auto">自动</option>
                          <option value="expanded">展开</option>
                          <option value="collapsed">折叠</option>
                        </select>
                      </label>
                    </div>
                    <div className="breakpoint-menu-actions">
                      {!['mobile', 'tablet', 'desktop'].includes(activeBreakpoint) ? (
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            removeDesignBreakpoint(activeArtboard.id, activeBreakpoint)
                            setDesignBreakpoint(activeArtboard.id, 'desktop')
                            setBreakpointMenuOpen(false)
                          }}
                        >
                          <Trash2 size={14} /> 删除
                        </button>
                      ) : (
                        <span />
                      )}
                      <button type="button" className="primary" onClick={saveBreakpoint}>
                        保存
                      </button>
                    </div>
                    <button
                      type="button"
                      className="breakpoint-add"
                      onClick={() => {
                        setCreatingBreakpoint(true)
                        setBreakpointDraft(createBreakpointDraft(undefined, activeArtboard))
                      }}
                    >
                      新增自定义断点
                    </button>
                  </div>,
                  globalThis.document.body,
                )
              : null}
          </div>
        </div>
      ) : null}
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
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setExportMenuOpen(false)
                  onExportPng(1)
                }}
              >
                <strong>PNG 1x</strong>
                <small>375px 逻辑尺寸</small>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setExportMenuOpen(false)
                  onExportPagePackage()
                }}
              >
                <strong>页面开发包</strong>
                <small>配置、组件、切图与质量报告</small>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setExportMenuOpen(false)
                  onExportCode('html')
                }}
              >
                <strong>HTML / CSS 开发包</strong>
                <small>原生节点、组件引用与资源</small>
              </button>
              <button type="button" role="menuitem" onClick={() => { setExportMenuOpen(false); onPreviewCode() }}>
                <strong>HTML 结构预览</strong>
                <small>预览选中模块或当前画板</small>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setExportMenuOpen(false)
                  onExportCode('react')
                }}
              >
                <strong>React 19 开发包</strong>
                <small>TSX、样式、Props 与资源</small>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setExportMenuOpen(false)
                  onExportCode('vue')
                }}
              >
                <strong>Vue 3 开发包</strong>
                <small>SFC、样式、Props 与资源</small>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setExportMenuOpen(false)
                  onExportPng(2)
                }}
              >
                <strong>PNG 2x</strong>
                <small>750px 高清尺寸</small>
              </button>
            </div>
          ) : null}
        </div>
        <button className="icon-button" type="button" title="HTML 结构预览" onClick={onPreviewCode}>
          <Code2 size={18} />
        </button>
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

function createBreakpointId(label: string, existingIds: string[]) {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'custom'
  let id = base
  let suffix = 2
  while (existingIds.includes(id)) id = `${base}-${suffix++}`
  return id
}

function createBreakpointDraft(
  breakpoint: import('../types').DesignBreakpoint | undefined,
  artboard: import('../types').Artboard | undefined,
): BreakpointDraft {
  const theme = artboard?.designSpec?.theme
  const layout = breakpoint?.overrides?.layout
  return {
    label: breakpoint?.label ?? '自定义断点',
    width: breakpoint?.viewport.width ?? 1280,
    height: breakpoint?.viewport.height ?? 900,
    primaryColor: normalizeColorInput(
      breakpoint?.overrides?.theme?.colors?.[3] ?? theme?.colors[3],
    ),
    radius: breakpoint?.overrides?.theme?.radius ?? theme?.radius ?? 6,
    density: breakpoint?.overrides?.theme?.density ?? theme?.density ?? 'comfortable',
    contentPadding:
      layout?.contentPadding ?? ((breakpoint?.viewport.width ?? 1280) < 600 ? 16 : 24),
    blockGap: layout?.blockGap ?? (theme?.density === 'compact' ? 12 : 16),
    sidebarMode: layout?.sidebarMode ?? 'auto',
  }
}

function normalizeColorInput(value?: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#2563eb'
}

function replacePrimaryColor(colors: string[], primaryColor: string) {
  const next = [...colors]
  while (next.length < 5) next.push('#d9dee8')
  next[3] = primaryColor
  return next
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
