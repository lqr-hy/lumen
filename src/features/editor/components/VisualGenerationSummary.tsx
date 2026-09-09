import { FileCheck2, X } from 'lucide-react'
import type { EditorChatImage, EditorChatThread } from '../store/editor-store'
import { resolveReferenceImageRoles } from '../../ai/reference-image-role'
import { summarizeVisualRedesignBrief } from '../utils/visual-brief'

export interface VisualGenerationSummaryProps {
  draft: NonNullable<EditorChatThread['visualOptimizationDraft']>
  references: EditorChatImage[]
  hasAttachedReferences: boolean
  onRemove?: () => void
}

export function VisualGenerationSummary({
  draft,
  references,
  hasAttachedReferences,
  onRemove,
}: VisualGenerationSummaryProps) {
  const summary = summarizeVisualRedesignBrief(draft.brief)
  const roleDescriptions: Record<NonNullable<EditorChatImage['role']>, string> = {
    auto: 'Auto · 提交时根据任务与图片语义自动判断',
    content: '原图素材 · 保留像素并直接用于页面',
    kv: 'KV · 控制颜色、材质与视觉语言',
    prototype: 'Prototype · 控制结构、模块顺序与原文案',
    visual: 'Visual · 只影响指定的局部风格',
    'edit-base': 'Edit Base · 保持主体与未修改区域',
  }
  const roleResolutions = resolveReferenceImageRoles(references, {
    prompt: JSON.stringify(draft.brief),
    hasVisualBrief: true,
  })
  const resolvedRoleLabels = {
    content: '原图素材',
    kv: 'KV',
    prototype: 'Prototype',
    visual: 'Visual',
    'edit-base': 'Edit Base',
  }

  return (
    <details className="visual-generation-summary" open>
      <summary>
        <span>
          <FileCheck2 size={15} />
          生成前确认
        </span>
        <span className="visual-generation-summary-actions">
          <em>待确认 · 独立 Variant</em>
          {onRemove ? (
            <button
              type="button"
              title="取消本次视觉优化，保留参考图"
              aria-label="取消本次视觉优化"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onRemove()
              }}
            >
              <X size={13} />
            </button>
          ) : null}
        </span>
      </summary>
      <div className="visual-generation-summary-body">
        <div className="visual-summary-source">
          <span>基于原稿</span>
          <strong>{draft.sourceArtboardName}</strong>
          <small>原画板不会被覆盖</small>
        </div>
        <div className="visual-summary-columns">
          <section>
            <strong>必须保留</strong>
            <div>
              {summary.preserve.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </section>
          <section>
            <strong>重点重设计</strong>
            <div>
              {summary.change.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </section>
        </div>
        <section className="visual-summary-references">
          <strong>本次实际发送的参考图</strong>
          {references.length ? (
            <div>
              {references.map((reference, index) => {
                const role = reference.role ?? 'auto'
                const resolution = roleResolutions[index]
                return (
                  <span key={reference.id} data-role={resolution.resolvedRole}>
                    <img src={reference.src} alt="" />
                    <span>
                      <b>{reference.name}</b>
                      <small>
                        {role === 'auto'
                          ? `Auto → ${resolvedRoleLabels[resolution.resolvedRole]} · ${resolution.reason}`
                          : roleDescriptions[role]}
                      </small>
                    </span>
                  </span>
                )
              })}
            </div>
          ) : (
            <p>
              {hasAttachedReferences
                ? '当前 @ 引用没有匹配到附件，本次不会发送参考图。'
                : '未添加参考图，将从当前画板和 Brief 推导视觉方向。'}
            </p>
          )}
        </section>
      </div>
    </details>
  )
}
