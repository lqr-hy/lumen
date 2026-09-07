import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Columns2,
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
  WandSparkles,
} from 'lucide-react'
import { openAppTab } from '../../../app/app-tabs'
import { useEditorStore } from '../store/editor-store'
import type { ProjectSettings } from '../types'
import type { VisualRedesignBrief } from '../utils/visual-brief'
import {
  compileVisualRedesignPrompt,
  DEFAULT_VISUAL_REDESIGN_BRIEF,
  normalizeVisualRedesignBrief,
  VISUAL_AXIS_DEFINITIONS,
} from '../utils/visual-brief'
import { VisualOptimizationDialog } from './VisualOptimizationDialog'
import { VariantComparisonDialog } from './VariantComparisonDialog'

interface EditorTopBarProps {
  chatPanelOpen: boolean
  leftPanelVisible: boolean
  rightPanelVisible: boolean
  rightPanelAvailable: boolean
  onToggleLeftPanel: () => void
  onToggleRightPanel: () => void
  onToggleAllPanels: () => void
  onOpenChatPanel: () => void
  onNormalizeVisualStyle: (languageId: string, overrides: { cornerRadius?: number }) => number
  onCreateVisualVariant: (brief: VisualRedesignBrief) => void
  onCreateVisualDesign: (brief: VisualRedesignBrief) => void
  newDesignMode?: boolean
}

export function EditorTopBar({
  chatPanelOpen,
  leftPanelVisible,
  rightPanelVisible,
  rightPanelAvailable,
  onToggleLeftPanel,
  onToggleRightPanel,
  onToggleAllPanels,
  onOpenChatPanel,
  onNormalizeVisualStyle,
  onCreateVisualVariant,
  onCreateVisualDesign,
  newDesignMode = false,
}: EditorTopBarProps) {
  const document = useEditorStore((state) => state.document)
  const updateDocumentMeta = useEditorStore((state) => state.updateDocumentMeta)
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId)
  const selectedArtboardId = useEditorStore((state) => state.selectedArtboardId)
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const selectArtboard = useEditorStore((state) => state.selectArtboard)
  const updateArtboard = useEditorStore((state) => state.updateArtboard)
  const removeArtboard = useEditorStore((state) => state.removeArtboard)
  const selectElement = useEditorStore((state) => state.selectElement)
  const updateElements = useEditorStore((state) => state.updateElements)
  const activeChatThreadId = useEditorStore((state) => state.activeChatThreadId)
  const updateChatThread = useEditorStore((state) => state.updateChatThread)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)
  const [pageModeOpen, setPageModeOpen] = useState(false)
  const [visualOptimizationOpen, setVisualOptimizationOpen] = useState(false)
  const [variantComparisonOpen, setVariantComparisonOpen] = useState(false)
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
  // 选中节点时，以节点所属画板作为视觉优化来源；否则子模块选区会错误地
  // 回退到历史 activeArtboard，聊天面板展示的来源也会与用户当前选择不一致。
  const selectedElementArtboardId = selectedElementIds
    .map((elementId) => document.elements.find((element) => element.id === elementId)?.artboardId)
    .find(Boolean)
  const explicitArtboardId = selectedArtboardId ?? selectedElementArtboardId ?? activeArtboardId
  const visualArtboard = newDesignMode
    ? undefined
    : explicitArtboardId
      ? document.artboards.find((artboard) => artboard.id === explicitArtboardId)
      : undefined
  const variantComparisonPair = resolveVariantComparisonPair(document.artboards, visualArtboard)

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
            title={
              rightPanelAvailable
                ? rightPanelVisible
                  ? '隐藏右侧面板'
                  : '显示右侧面板'
                : '选择画板或图层后显示属性面板'
            }
            disabled={!rightPanelAvailable}
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
          {variantComparisonPair ? (
            <button
              className="topbar-text-button variant-compare-button"
              type="button"
              onClick={() => setVariantComparisonOpen(true)}
            >
              <Columns2 size={16} />
              版本对比
            </button>
          ) : null}
          <button
            className="topbar-text-button visual-optimize-button"
            type="button"
            disabled={!document}
            onClick={() => {
              // 每次从顶部重新打开都创建新的视觉优化上下文，避免展示旧画板的待确认摘要。
              updateChatThread(activeChatThreadId, (thread) => ({
                ...thread,
                visualOptimizationDraft: undefined,
                prompt: thread.visualOptimizationDraft ? '' : thread.prompt,
              }))
              setVisualOptimizationOpen(true)
            }}
          >
            <WandSparkles size={16} />
            视觉优化
          </button>
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
      {visualOptimizationOpen ? (
        <VisualOptimizationDialog
          artboard={visualArtboard}
          templates={document.settings?.visualBriefTemplates}
          onSaveTemplate={(name, brief) => {
            const templates = document.settings?.visualBriefTemplates ?? []
            updateDocumentMeta({
              settings: {
                visualBriefTemplates: [
                  ...templates,
                  { id: `visual-brief-${Date.now()}`, name, brief },
                ],
              },
            })
          }}
          onDeleteTemplate={(id) =>
            updateDocumentMeta({
              settings: {
                visualBriefTemplates: (document.settings?.visualBriefTemplates ?? []).filter(
                  (template) => template.id !== id,
                ),
              },
            })
          }
          onClose={() => setVisualOptimizationOpen(false)}
          onNormalize={onNormalizeVisualStyle}
          onCreateVariant={(brief) => {
            if (newDesignMode) onCreateVisualDesign(brief)
            else onCreateVisualVariant(brief)
            setVisualOptimizationOpen(false)
          }}
        />
      ) : null}
      {variantComparisonOpen && variantComparisonPair ? (
        <VariantComparisonDialog
          document={document}
          original={variantComparisonPair.original}
          variant={variantComparisonPair.variant}
          variants={variantComparisonPair.variants}
          onClose={() => setVariantComparisonOpen(false)}
          onSelectArtboard={selectArtboard}
          onLocateElement={(artboardId, elementId) => {
            selectArtboard(artboardId)
            selectElement(elementId)
            setVariantComparisonOpen(false)
          }}
          onApplyQualityFixes={updateElements}
          onToggleArchive={() => {
            updateArtboard(variantComparisonPair.variant.id, {
              variantStatus:
                variantComparisonPair.variant.variantStatus === 'archived'
                  ? 'candidate'
                  : 'archived',
            })
          }}
          onAcceptVariant={() => {
            updateArtboard(variantComparisonPair.variant.id, { variantStatus: 'accepted' })
            selectArtboard(variantComparisonPair.variant.id)
            setVariantComparisonOpen(false)
          }}
          onContinueVariant={() => {
            selectArtboard(variantComparisonPair.variant.id)
            setVariantComparisonOpen(false)
            setVisualOptimizationOpen(true)
          }}
          onRepairVariant={(missingTexts) => {
            const variant = variantComparisonPair.variant
            const brief = normalizeVisualRedesignBrief(
              structuredClone(variant.visualOptimizationBrief ?? DEFAULT_VISUAL_REDESIGN_BRIEF),
            )
            brief.preserve.content = true
            brief.concept = '保持当前视觉新版，只定向修复准确文案与内容完整性'
            // 文案修复不是重设计：把所有发散轴锁成 keep，否则编译出的 prompt 会
            // 一边要求"不得改变视觉方向"一边给出逐项变化指令，自相矛盾。
            brief.axes = Object.fromEntries(
              VISUAL_AXIS_DEFINITIONS.map(({ key }) => [
                key,
                { direction: 'keep', range: 'subtle' },
              ]),
            ) as typeof brief.axes
            const repairPrompt = [
              compileVisualRedesignPrompt(brief, variant),
              `必须逐字恢复以下准确文案：${missingTexts.join('、')}。`,
              '除恢复这些文案及其必要承载空间外，不得改变当前新版的视觉方向、模块顺序和其他内容。',
            ].join('\n')
            selectArtboard(variant.id)
            updateChatThread(activeChatThreadId, (thread) => ({
              ...thread,
              targetArtboardId: variant.id,
              activeTargetArtboardId: variant.id,
              artboardIds: Array.from(new Set([...(thread.artboardIds ?? []), variant.id])),
              placementMode: 'duplicate-variant',
              lastPlacementMode: 'duplicate-variant',
              visualOptimizationDraft: {
                mode: 'variant',
                sourceArtboardId: variant.id,
                sourceArtboardName: variant.name,
                brief,
              },
              prompt: repairPrompt,
            }))
            setVariantComparisonOpen(false)
            onOpenChatPanel()
          }}
          onDeleteVariant={() => {
            removeArtboard(variantComparisonPair.variant.id)
            selectArtboard(variantComparisonPair.original.id)
            setVariantComparisonOpen(false)
          }}
          onSelectVariant={(nextVariant) => {
            setVisualOptimizationOpen(false)
            setVariantComparisonOpen(false)
            window.setTimeout(() => {
              selectArtboard(nextVariant.id)
              setVariantComparisonOpen(true)
            }, 0)
          }}
        />
      ) : null}
    </>
  )
}

function resolveVariantComparisonPair(
  artboards: import('../types').Artboard[],
  activeArtboard?: import('../types').Artboard,
) {
  if (!activeArtboard) return undefined
  const parentId =
    activeArtboard.variantParentArtboardId ?? activeArtboard.generationMeta?.parentArtboardId
  if (parentId) {
    const original = artboards.find((artboard) => artboard.id === parentId)
    if (!original) return undefined
    const variants = artboards
      .filter(
        (artboard) =>
          (artboard.variantParentArtboardId ?? artboard.generationMeta?.parentArtboardId) ===
          original.id,
      )
      .sort(compareVariantOrder)
    return { original, variant: activeArtboard, variants }
  }
  const variants = artboards
    .filter(
      (artboard) =>
        (artboard.variantParentArtboardId ?? artboard.generationMeta?.parentArtboardId) ===
        activeArtboard.id,
    )
    .sort(compareVariantOrder)
  const variant = variants.at(-1)
  return variant ? { original: activeArtboard, variant, variants } : undefined
}

function compareVariantOrder(a: import('../types').Artboard, b: import('../types').Artboard) {
  const aTime = Date.parse(a.variantCreatedAt ?? a.generationMeta?.createdAt ?? '') || 0
  const bTime = Date.parse(b.variantCreatedAt ?? b.generationMeta?.createdAt ?? '') || 0
  if (aTime !== bTime) return aTime - bTime
  return a.id.localeCompare(b.id)
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
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="settings-dialog-body">
          <label className="settings-field">
            <span>
              项目名称<em>*</em>
            </span>
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
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="button" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
