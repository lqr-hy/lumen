import { useEffect, useState } from 'react'
import {
  BookmarkPlus,
  CheckCircle2,
  LocateFixed,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { buildRenderBox } from '../render/render-box'
import { RenderBoxView } from '../render/RenderBoxView'
import { useEditorStore } from '../store/editor-store'
import { compileResponsivePreviews } from '../utils/responsive-preview'

interface ResponsivePreviewPanelProps {
  onClose: () => void
}

export function ResponsivePreviewPanel({ onClose }: ResponsivePreviewPanelProps) {
  const document = useEditorStore((state) => state.document)
  const activeArtboardId = useEditorStore((state) => state.activeArtboardId)
  const captureResponsiveBaseline = useEditorStore((state) => state.captureResponsiveBaseline)
  const clearResponsiveBaseline = useEditorStore((state) => state.clearResponsiveBaseline)
  const applyResponsiveTokenBatch = useEditorStore((state) => state.applyResponsiveTokenBatch)
  const artboard = document?.artboards.find((item) => item.id === activeArtboardId)
  const previews = artboard?.designSpec
    ? compileResponsivePreviews(artboard.designSpec, artboard)
    : []
  const breakpointKey = previews.map((item) => item.breakpoint.id).join('|')
  const [batchOpen, setBatchOpen] = useState(false)
  const [selectedBreakpointIds, setSelectedBreakpointIds] = useState<string[]>(() =>
    previews.map((item) => item.breakpoint.id),
  )
  const [highlight, setHighlight] = useState<{ breakpointId: string; elementIds: string[] }>()
  const [tokenDraft, setTokenDraft] = useState({
    primaryColor: normalizeHex(artboard?.designSpec?.theme.colors[3]),
    radius: artboard?.designSpec?.theme.radius ?? 6,
    density: artboard?.designSpec?.theme.density ?? 'comfortable',
    contentPadding: 24,
    blockGap: artboard?.designSpec?.theme.density === 'compact' ? 12 : 16,
    sidebarMode: 'auto' as 'auto' | 'expanded' | 'collapsed',
  })

  useEffect(() => {
    setSelectedBreakpointIds(breakpointKey ? breakpointKey.split('|') : [])
    setHighlight(undefined)
  }, [artboard?.id, breakpointKey])

  if (!artboard?.designSpec) return null

  return (
    <div
      className="responsive-preview-panel"
      role="dialog"
      aria-modal="true"
      aria-label="多尺寸响应式预览"
    >
      <header>
        <div>
          <strong>响应式预览</strong>
          <span>同一份 DesignSpec，只读编译结果</span>
        </div>
        <div className="responsive-preview-header-actions">
          <button
            type="button"
            title="批量编辑断点 Token"
            className={batchOpen ? 'active' : undefined}
            onClick={() => setBatchOpen((open) => !open)}
          >
            <SlidersHorizontal size={17} />
          </button>
          <button type="button" title="关闭预览" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="responsive-token-batch" hidden={!batchOpen}>
        <div className="responsive-token-selection">
          <strong>应用到</strong>
          {previews.map((preview) => (
            <label key={preview.breakpoint.id}>
              <input
                type="checkbox"
                checked={selectedBreakpointIds.includes(preview.breakpoint.id)}
                onChange={(event) =>
                  setSelectedBreakpointIds((ids) =>
                    event.target.checked
                      ? [...new Set([...ids, preview.breakpoint.id])]
                      : ids.filter((id) => id !== preview.breakpoint.id),
                  )
                }
              />
              <span>{preview.breakpoint.label}</span>
            </label>
          ))}
        </div>
        <div className="responsive-token-fields">
          <label>
            <span>主色</span>
            <input
              type="color"
              value={tokenDraft.primaryColor}
              onChange={(event) =>
                setTokenDraft((draft) => ({ ...draft, primaryColor: event.target.value }))
              }
            />
          </label>
          <label>
            <span>圆角</span>
            <input
              type="number"
              min="0"
              max="32"
              value={tokenDraft.radius}
              onChange={(event) =>
                setTokenDraft((draft) => ({ ...draft, radius: Number(event.target.value) }))
              }
            />
          </label>
          <label>
            <span>内容边距</span>
            <input
              type="number"
              min="0"
              max="96"
              value={tokenDraft.contentPadding}
              onChange={(event) =>
                setTokenDraft((draft) => ({ ...draft, contentPadding: Number(event.target.value) }))
              }
            />
          </label>
          <label>
            <span>区块间距</span>
            <input
              type="number"
              min="0"
              max="64"
              value={tokenDraft.blockGap}
              onChange={(event) =>
                setTokenDraft((draft) => ({ ...draft, blockGap: Number(event.target.value) }))
              }
            />
          </label>
          <label>
            <span>密度</span>
            <select
              value={tokenDraft.density}
              onChange={(event) =>
                setTokenDraft((draft) => ({
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
              value={tokenDraft.sidebarMode}
              onChange={(event) =>
                setTokenDraft((draft) => ({
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
          <button
            type="button"
            disabled={!selectedBreakpointIds.length}
            onClick={() =>
              applyResponsiveTokenBatch(artboard.id, selectedBreakpointIds, tokenDraft)
            }
          >
            应用 Token
          </button>
        </div>
      </div>
      <div className="responsive-preview-list">
        {previews.map((preview) => {
          const { breakpoint, schema } = preview
          const baseline = artboard.responsiveBaselines?.[breakpoint.id]
          const baselineMatches = baseline?.fingerprint === preview.fingerprint
          const scale = Math.min(1, 320 / schema.viewport.width, 560 / schema.viewport.height)
          return (
            <section
              key={breakpoint.id}
              className={`responsive-preview-frame ${highlight?.breakpointId === breakpoint.id ? 'locating' : ''}`}
            >
              <div className="responsive-preview-meta">
                <span>
                  <strong>{breakpoint.label}</strong>
                  <small>
                    {schema.viewport.width} × {schema.viewport.height}
                  </small>
                </span>
                {baseline ? (
                  <span
                    className={`responsive-baseline-status ${baselineMatches ? 'matched' : 'changed'}`}
                  >
                    {baselineMatches ? <CheckCircle2 size={12} /> : <TriangleAlert size={12} />}
                    {baselineMatches ? '基线一致' : '发生变化'}
                  </span>
                ) : (
                  <span className="responsive-baseline-status">未设基线</span>
                )}
              </div>
              <div className="responsive-preview-hints">
                {preview.hints.map((hint) => (
                  <button
                    key={hint.code}
                    type="button"
                    className={
                      highlight?.breakpointId === breakpoint.id &&
                      hint.elementIds.some((id) => highlight.elementIds.includes(id))
                        ? 'active'
                        : undefined
                    }
                    title={hint.elementIds.length ? '定位差异节点' : hint.label}
                    onClick={() =>
                      setHighlight({ breakpointId: breakpoint.id, elementIds: hint.elementIds })
                    }
                  >
                    {hint.elementIds.length ? <LocateFixed size={10} /> : null}
                    {hint.label}
                  </button>
                ))}
              </div>
              <div
                className="responsive-preview-clip"
                style={{
                  width: schema.viewport.width * scale,
                  height: schema.viewport.height * scale,
                }}
              >
                <div
                  className="responsive-preview-artboard"
                  style={{
                    width: schema.viewport.width,
                    height: preview.contentHeight,
                    background: artboard.background,
                    transform: `scale(${scale})`,
                  }}
                >
                  {preview.elements
                    .slice()
                    .sort((a, b) => a.zIndex - b.zIndex)
                    .map((element) => {
                      const box = buildRenderBox(element, {
                        mode: 'static',
                        origin: { x: 0, y: 0 },
                        diagnostics: [],
                      })
                      return box ? <RenderBoxView key={element.id} box={box} /> : null
                    })}
                  {highlight?.breakpointId === breakpoint.id
                    ? preview.elements
                        .filter((element) => highlight.elementIds.includes(element.id))
                        .map((element) => (
                          <div
                            key={`highlight-${element.id}`}
                            className="responsive-difference-outline"
                            style={{
                              left: element.x,
                              top: element.y,
                              width: element.width,
                              height: element.height,
                            }}
                          />
                        ))
                    : null}
                </div>
              </div>
              <div className="responsive-baseline-actions">
                <button
                  type="button"
                  onClick={() => captureResponsiveBaseline(artboard.id, breakpoint.id)}
                >
                  {baseline ? <RefreshCw size={13} /> : <BookmarkPlus size={13} />}
                  {baseline ? '更新基线' : '设为基线'}
                </button>
                {baseline ? (
                  <button
                    type="button"
                    title="删除基线"
                    onClick={() => clearResponsiveBaseline(artboard.id, breakpoint.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function normalizeHex(value?: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#2563eb'
}
