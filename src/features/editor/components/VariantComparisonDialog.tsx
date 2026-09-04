import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Check, Clipboard, Columns2, Trash2, WandSparkles, X } from 'lucide-react'
import type { Artboard, DesignDocument } from '../types'
import { renderArtboardSnapshot } from '../utils/artboard-snapshot'
import { compareArtboardVersions, type VariantComparisonSummary } from '../utils/variant-comparison'
import { buildSafeVisualQualityFixes, reviewVisualVariant } from '../utils/visual-quality-gate'

interface VariantComparisonDialogProps {
  document: DesignDocument
  original: Artboard
  variant: Artboard
  variants?: Artboard[]
  onClose: () => void
  onSelectArtboard: (artboardId: string) => void
  onAcceptVariant: () => void
  onContinueVariant: () => void
  onRepairVariant: (missingTexts: string[]) => void
  onDeleteVariant: () => void
  onSelectVariant?: (variant: Artboard) => void
  onLocateElement?: (artboardId: string, elementId: string) => void
  onApplyQualityFixes?: (patches: ReturnType<typeof buildSafeVisualQualityFixes>) => void
  onToggleArchive?: () => void
}

export function VariantComparisonDialog({
  document,
  original,
  variant,
  variants = [variant],
  onClose,
  onSelectArtboard,
  onAcceptVariant,
  onContinueVariant,
  onRepairVariant,
  onDeleteVariant,
  onSelectVariant,
  onLocateElement,
  onApplyQualityFixes,
  onToggleArchive,
}: VariantComparisonDialogProps) {
  const [snapshots, setSnapshots] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false)
  const comparison = useMemo(
    () => compareArtboardVersions(document, original, variant),
    [document, original, variant],
  )
  const acceptBlocked =
    variant.visualOptimizationBrief?.preserve.content !== false &&
    comparison.text.missing.length > 0
  const visualReview = useMemo(() => reviewVisualVariant(document, variant), [document, variant])
  const decisionBlocked =
    acceptBlocked || !visualReview.passed || variant.variantStatus === 'archived'

  useEffect(() => {
    const body = globalThis.document.body
    const root = globalThis.document.documentElement
    const previousBodyOverflow = body.style.overflow
    const previousRootOverflow = root.style.overflow
    body.style.overflow = 'hidden'
    root.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    globalThis.addEventListener('keydown', onKeyDown)
    return () => {
      body.style.overflow = previousBodyOverflow
      root.style.overflow = previousRootOverflow
      globalThis.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setSnapshots({})
    setError('')
    Promise.all([
      // 对比预览可能会把 375px 画板放大到较宽的弹窗中，使用 2x 快照避免文字和细线模糊。
      renderArtboardSnapshot(document, original.id, 2),
      renderArtboardSnapshot(document, variant.id, 2),
    ])
      .then(([originalSnapshot, variantSnapshot]) => {
        if (cancelled) return
        setSnapshots({
          [original.id]: originalSnapshot.data,
          [variant.id]: variantSnapshot.data,
        })
      })
      .catch((snapshotError) => {
        if (!cancelled) {
          setError(snapshotError instanceof Error ? snapshotError.message : '画板快照生成失败')
        }
      })
    return () => {
      cancelled = true
    }
  }, [document, original.id, variant.id])

  function locateArtboard(artboardId: string) {
    onSelectArtboard(artboardId)
    onClose()
  }

  return createPortal(
    <div
      className="settings-backdrop variant-comparison-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onWheel={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
    >
      <section
        className="variant-comparison-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="原稿与视觉新版对比"
      >
        <header>
          <div>
            <Columns2 size={18} />
            <div>
              <strong>Variant 对比</strong>
              <small>同一 Brief 下的原稿与视觉新版</small>
            </div>
            <span
              className={
                decisionBlocked ? 'variant-quality-badge warning' : 'variant-quality-badge'
              }
            >
              {variant.variantStatus === 'archived'
                ? '已归档'
                : decisionBlocked
                  ? '需修复'
                  : '检查通过'}
            </span>
          </div>
          <button type="button" aria-label="关闭对比" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {variants.length > 1 ? (
          <div className="variant-history-strip">
            <span>版本历史</span>
            <div>
              {variants.map((item, index) => (
                <button
                  key={item.id}
                  className={item.id === variant.id ? 'active' : undefined}
                  type="button"
                  onClick={() => onSelectVariant?.(item)}
                >
                  {item.variantLabel || `V${index + 1}`}
                  <small>{getVariantStatusLabel(item, document)}</small>
                  <time>{formatVariantTime(item)}</time>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <div className="variant-comparison-error">{error}</div> : null}
        <div className="variant-comparison-grid">
          <VariantDifferenceSummary comparison={comparison} />
          <VariantPreview
            label="原稿"
            artboard={original}
            snapshot={snapshots[original.id]}
            onLocate={() => locateArtboard(original.id)}
          />
          <VariantPreview
            label="视觉新版"
            artboard={variant}
            snapshot={snapshots[variant.id]}
            accent
            onLocate={() => locateArtboard(variant.id)}
          />
        </div>
        <footer className="variant-comparison-footer">
          <div>
            {deleteConfirmationOpen ? (
              <>
                <span>删除新版后仍可通过撤销恢复。</span>
                <button className="variant-delete-confirm" type="button" onClick={onDeleteVariant}>
                  确认删除新版
                </button>
                <button type="button" onClick={() => setDeleteConfirmationOpen(false)}>
                  取消
                </button>
              </>
            ) : (
              <>
                {onToggleArchive ? (
                  <button type="button" onClick={onToggleArchive}>
                    {variant.variantStatus === 'archived' ? '恢复此版本' : '归档此版本'}
                  </button>
                ) : null}
                <button
                  className="variant-delete-action"
                  type="button"
                  onClick={() => setDeleteConfirmationOpen(true)}
                >
                  <Trash2 size={14} />
                  删除新版
                </button>
              </>
            )}
          </div>
          <div>
            {acceptBlocked ? (
              <span className="variant-quality-blocker">准确文案未完整保留，修复后才能采用。</span>
            ) : null}
            {visualReview.issues.length ? (
              <div className="variant-quality-issues" role="status">
                <strong>视觉质量检查</strong>
                {visualReview.issues.map((issue) => (
                  <span
                    key={issue.code}
                    className={issue.severity === 'error' ? 'error' : 'warning'}
                  >
                    {issue.severity === 'error' ? '阻断' : '提示'} · {issue.message}
                    {issue.elementIds?.[0] && onLocateElement ? (
                      <button
                        type="button"
                        onClick={() => onLocateElement(variant.id, issue.elementIds![0])}
                      >
                        定位
                      </button>
                    ) : null}
                    {issue.code === 'overflow' && onApplyQualityFixes ? (
                      <button
                        type="button"
                        onClick={() =>
                          onApplyQualityFixes(buildSafeVisualQualityFixes(document, variant))
                        }
                      >
                        自动收回边界
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : null}
            <button type="button" onClick={onContinueVariant}>
              <WandSparkles size={14} />
              基于新版继续优化
            </button>
            {acceptBlocked ? (
              <button
                className="variant-repair-action"
                type="button"
                onClick={() => onRepairVariant(comparison.text.missing)}
              >
                <WandSparkles size={14} />
                生成文案修正版
              </button>
            ) : null}
            <button
              className="variant-accept-action"
              type="button"
              disabled={decisionBlocked}
              title={acceptBlocked ? '存在必须保留但丢失的准确文案' : undefined}
              onClick={onAcceptVariant}
            >
              <Check size={14} />
              {variant.variantStatus === 'accepted' ? '已采用此版本' : '采用新版'}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    globalThis.document.body,
  )
}

function getVariantStatusLabel(artboard: Artboard, document: DesignDocument) {
  if (artboard.variantStatus === 'accepted') return '已采用'
  if (artboard.variantStatus === 'archived') return '已归档'
  if (!reviewVisualVariant(document, artboard).passed) return '被阻断'
  return artboard.variantStatus === 'reviewing' ? '检查中' : '候选'
}

function formatVariantTime(artboard: Artboard) {
  const value = artboard.variantCreatedAt ?? artboard.generationMeta?.createdAt
  if (!value) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function VariantDifferenceSummary({ comparison }: { comparison: VariantComparisonSummary }) {
  const retentionPercent = Math.round(comparison.text.retentionRate * 100)
  const [missingExpanded, setMissingExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copyMissingTexts() {
    if (!comparison.text.missing.length) return
    await navigator.clipboard?.writeText(comparison.text.missing.join('、'))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <section className="variant-difference-summary">
      <div className="variant-difference-metrics">
        <span>
          <small>准确文案保留</small>
          <strong className={retentionPercent < 100 ? 'warning' : undefined}>
            {retentionPercent}%
          </strong>
          <em>
            {comparison.text.preservedCount}/{comparison.text.sourceCount || 0}
          </em>
        </span>
        <span>
          <small>可见节点</small>
          <strong>
            {comparison.source.nodeCount} → {comparison.variant.nodeCount}
          </strong>
        </span>
        <span>
          <small>图片节点</small>
          <strong>
            {comparison.source.imageCount} → {comparison.variant.imageCount}
          </strong>
        </span>
        <span>
          <small>页面高度</small>
          <strong>
            {comparison.source.height} → {comparison.variant.height}
          </strong>
        </span>
      </div>
      <div className="variant-difference-palettes">
        <PalettePreview label="原稿主色" colors={comparison.source.palette} />
        <PalettePreview label="新版主色" colors={comparison.variant.palette} />
      </div>
      {comparison.text.missing.length ? (
        <div className="variant-missing-text">
          <div>
            <strong>可能丢失的准确文案</strong>
            <span>
              {missingExpanded
                ? comparison.text.missing.join('、')
                : comparison.text.missing.slice(0, 2).join('、')}
              {comparison.text.missing.length > 2 && !missingExpanded ? '…' : ''}
            </span>
          </div>
          <button type="button" onClick={() => setMissingExpanded((expanded) => !expanded)}>
            {missingExpanded ? '收起' : `查看全部（${comparison.text.missing.length}）`}
          </button>
          <button type="button" title="复制丢失文案" onClick={() => void copyMissingTexts()}>
            <Clipboard size={12} />
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      ) : null}
    </section>
  )
}

function PalettePreview({ label, colors }: { label: string; colors: string[] }) {
  return (
    <span>
      <small>{label}</small>
      <span>
        {colors.length ? (
          colors.map((color) => (
            <i key={color} style={{ background: color }} title={color} aria-label={color} />
          ))
        ) : (
          <em>未识别</em>
        )}
      </span>
    </span>
  )
}

function VariantPreview({
  label,
  artboard,
  snapshot,
  accent,
  onLocate,
}: {
  label: string
  artboard: Artboard
  snapshot?: string
  accent?: boolean
  onLocate: () => void
}) {
  return (
    <article className={accent ? 'accent' : undefined}>
      <div className="variant-preview-title">
        <span>{label}</span>
        <strong>{artboard.name}</strong>
        <small>
          {Math.round(artboard.width)} × {Math.round(artboard.height)}
        </small>
      </div>
      <div className="variant-preview-canvas">
        {snapshot ? (
          <img src={snapshot} alt={`${artboard.name}画板预览`} />
        ) : (
          <span>正在生成预览…</span>
        )}
      </div>
      <button type="button" onClick={onLocate}>
        在画布中查看
        <ArrowRight size={14} />
      </button>
    </article>
  )
}
