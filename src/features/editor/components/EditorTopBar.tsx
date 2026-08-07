import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Home,
  Grid3X3,
  MessageSquare,
  Monitor,
  Moon,
  PanelLeft,
  PanelsTopLeft,
  PanelRight,
  Settings,
  Share2,
  Sparkles,
  Sun,
} from 'lucide-react'
import { openAppTab } from '../../../app/app-tabs'
import { useEditorStore } from '../store/editor-store'
import type { ProjectSettings } from '../types'

interface EditorTopBarProps {
  chatPanelOpen: boolean
  leftPanelVisible: boolean
  rightPanelVisible: boolean
  onToggleLeftPanel: () => void
  onToggleRightPanel: () => void
  onToggleAllPanels: () => void
  onOpenChatPanel: () => void
}

export function EditorTopBar({
  chatPanelOpen,
  leftPanelVisible,
  rightPanelVisible,
  onToggleLeftPanel,
  onToggleRightPanel,
  onToggleAllPanels,
  onOpenChatPanel,
}: EditorTopBarProps) {
  const document = useEditorStore((state) => state.document)
  const updateDocumentMeta = useEditorStore((state) => state.updateDocumentMeta)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [pageModeOpen, setPageModeOpen] = useState(false)
  const projectMenuRef = useRef<HTMLDivElement>(null)
  const pageModeMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!projectMenuOpen && !pageModeOpen) return undefined

    function closeMenusOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return

      if (projectMenuOpen && !projectMenuRef.current?.contains(target)) {
        setProjectMenuOpen(false)
      }

      if (pageModeOpen && !pageModeMenuRef.current?.contains(target)) {
        setPageModeOpen(false)
      }
    }

    window.document.addEventListener('pointerdown', closeMenusOnOutsidePointerDown, true)
    return () => {
      window.document.removeEventListener('pointerdown', closeMenusOnOutsidePointerDown, true)
    }
  }, [pageModeOpen, projectMenuOpen])

  if (!document) return null

  const canvasMode = document.settings?.canvasMode ?? 'light'
  const gridVisible = document.settings?.gridVisible ?? true
  const anyPanelVisible = leftPanelVisible || rightPanelVisible

  function setCanvasMode(mode: NonNullable<ProjectSettings['canvasMode']>) {
    updateDocumentMeta({ settings: { canvasMode: mode } })
  }

  function toggleGridVisible() {
    updateDocumentMeta({ settings: { gridVisible: !gridVisible } })
  }

  function openHomeInNewTab() {
    openAppTab({ path: '/', title: '首页' })
    setProjectMenuOpen(false)
  }

  return (
    <>
      <header className="editor-topbar">
        <div className="editor-project-title" ref={projectMenuRef}>
          <Sparkles size={15} />
          <button
            type="button"
            onClick={() => {
              setProjectMenuOpen((open) => !open)
              setPageModeOpen(false)
            }}
          >
            {document.title}
            <ChevronDown size={16} />
          </button>
          {projectMenuOpen ? (
            <div className="project-dropdown">
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(true)
                  setProjectMenuOpen(false)
                }}
              >
                <Settings size={16} />
                项目设定
              </button>
              <button type="button" onClick={openHomeInNewTab}>
                <Home size={16} />
                返回画布首页
              </button>
              <button type="button" onClick={toggleGridVisible}>
                <Grid3X3 size={16} />
                画布网格
                {gridVisible ? <Check size={16} /> : null}
              </button>
            </div>
          ) : null}
        </div>
        <div className="editor-top-actions">
          <button
            className="topbar-icon-button"
            type="button"
            title={leftPanelVisible ? '隐藏左侧面板' : '显示左侧面板'}
            onClick={onToggleLeftPanel}
          >
            <PanelLeft size={16} />
          </button>
          <button
            className="topbar-icon-button"
            type="button"
            title={anyPanelVisible ? '隐藏全部面板' : '展示全部面板'}
            onClick={onToggleAllPanels}
          >
            <PanelsTopLeft size={16} />
          </button>
          <button
            className="topbar-icon-button"
            type="button"
            title={rightPanelVisible ? '隐藏右侧面板' : '显示右侧面板'}
            onClick={onToggleRightPanel}
          >
            <PanelRight size={16} />
          </button>
          <div className="mode-menu-wrap" ref={pageModeMenuRef}>
            <button
              className="topbar-text-button"
              type="button"
              onClick={() => {
                setPageModeOpen((open) => !open)
                setProjectMenuOpen(false)
              }}
            >
              {canvasMode === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
              编辑页面模式
              <ChevronDown size={15} />
            </button>
            {pageModeOpen ? (
              <div className="mode-menu">
                <button type="button" onClick={() => setCanvasMode('light')}>
                  <Sun size={16} />
                  浅色模式
                  {canvasMode === 'light' ? <Check size={16} /> : null}
                </button>
                <button type="button" onClick={() => setCanvasMode('dark')}>
                  <Moon size={16} />
                  深色模式
                  {canvasMode === 'dark' ? <Check size={16} /> : null}
                </button>
                <button type="button" onClick={() => setCanvasMode('system-light')}>
                  <Monitor size={16} />
                  跟随系统 · 浅色
                  {canvasMode === 'system-light' ? <Check size={16} /> : null}
                </button>
              </div>
            ) : null}
          </div>
          <span className="credit-inline">✦ 60</span>
          <button className="topbar-icon-button" type="button" title="分享">
            <Share2 size={16} />
          </button>
          {!chatPanelOpen ? (
            <button className="chat-button" type="button" onClick={onOpenChatPanel}>
              <MessageSquare size={16} />
              对话
            </button>
          ) : null}
        </div>
      </header>
      {settingsOpen ? <ProjectSettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
    </>
  )
}

function ProjectSettingsDialog({ onClose }: { onClose: () => void }) {
  const document = useEditorStore((state) => state.document)
  const updateDocumentMeta = useEditorStore((state) => state.updateDocumentMeta)
  const [title, setTitle] = useState(document?.title ?? '')
  const [globalPrompt, setGlobalPrompt] = useState(document?.settings?.globalPrompt ?? '')

  if (!document) return null

  function save() {
    updateDocumentMeta({
      title: title.trim() || '未命名项目',
      settings: { globalPrompt },
    })
    onClose()
  }

  return (
    <div className="settings-backdrop">
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-label="项目设定">
        <div className="settings-dialog-header">
          <h2>项目设定</h2>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <div className="settings-dialog-body">
          <label className="settings-field">
            <span>项目名称<em>*</em></span>
            <div className="settings-input-wrap">
              <input
                maxLength={50}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <small>{title.length}/50</small>
            </div>
          </label>
          <label className="settings-field">
            <span>全局设定</span>
            <div className="settings-textarea-wrap">
              <textarea
                maxLength={8000}
                value={globalPrompt}
                placeholder="给项目进行全局的规则设定和上下文输入，让 agent 能够按照你的要求更好响应"
                onChange={(event) => setGlobalPrompt(event.target.value)}
              />
              <button type="button">+</button>
              <small>{globalPrompt.length}/8000</small>
            </div>
          </label>
        </div>
        <div className="settings-dialog-footer">
          <button type="button" onClick={onClose}>取消</button>
          <button type="button" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  )
}
