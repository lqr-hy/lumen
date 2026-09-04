import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, Layers3, SlidersHorizontal, WandSparkles } from 'lucide-react'
import type { Artboard } from '../types'
import { getSelectedStylePackId, listAvailableStylePacks } from '../../ai/style-packs'
import {
  BUILTIN_VISUAL_BRIEF_TEMPLATES,
  DEFAULT_VISUAL_REDESIGN_BRIEF,
  DESIGN_LANGUAGES,
  findDesignLanguage,
  normalizeVisualRedesignBrief,
  VISUAL_AXIS_DEFINITIONS,
  VISUAL_AXIS_RANGE_LABELS,
  type VisualAxisKey,
  type VisualAxisRange,
  type VisualRedesignBrief,
} from '../utils/visual-brief'

interface VisualOptimizationDialogProps {
  artboard?: Artboard
  onClose: () => void
  /**
   * 按传入的设计语言统一当前画板材质，返回被修改的节点数。
   * `overrides` 承载 Style Pack 声明的品牌事实，优先于设计语言的审美选择。
   */
  onNormalize: (languageId: string, overrides: { cornerRadius?: number }) => number
  onCreateVariant: (brief: VisualRedesignBrief) => void
  templates?: Array<{ id: string; name: string; brief: VisualRedesignBrief }>
  onSaveTemplate?: (name: string, brief: VisualRedesignBrief) => void
  onDeleteTemplate?: (id: string) => void
}

const PALETTE_ROLE_FIELDS: Array<{
  key: keyof VisualRedesignBrief['paletteRoles']
  label: string
  placeholder: string
}> = [
  { key: 'background', label: '页面背景', placeholder: '例如 #121212 / 深夜蓝' },
  { key: 'surface', label: '组件表面', placeholder: '例如 #24212A / 暖黑灰' },
  { key: 'text', label: '主文字', placeholder: '例如 #FFFFFF / 高对比白' },
  { key: 'mutedText', label: '次文字', placeholder: '例如 #B8B3C2 / 柔和灰' },
  { key: 'accent', label: '强调色', placeholder: '例如 #F3C847 / 品牌金' },
]

export function VisualOptimizationDialog({
  artboard,
  onClose,
  onNormalize,
  onCreateVariant,
  templates = [],
  onSaveTemplate,
  onDeleteTemplate,
}: VisualOptimizationDialogProps) {
  const [brief, setBrief] = useState<VisualRedesignBrief>(() =>
    structuredClone(DEFAULT_VISUAL_REDESIGN_BRIEF),
  )
  const [normalizedCount, setNormalizedCount] = useState<number>()
  const [templateName, setTemplateName] = useState('')
  const antiPatternText = useMemo(() => brief.antiPatterns.join('、'), [brief.antiPatterns])
  // 用户模板可能是旧结构（只有 change 布尔），渲染前统一补齐轴。
  const normalizedBrief = useMemo(() => normalizeVisualRedesignBrief(brief), [brief])
  const activeLanguage = findDesignLanguage(brief.designLanguage)
  const [stylePackRadius, setStylePackRadius] = useState<number>()

  // Style Pack 的 surfaces.radius 是品牌声明，归一化时必须优先于设计语言。
  useEffect(() => {
    let cancelled = false
    const selectedId = getSelectedStylePackId()
    if (!selectedId) return
    listAvailableStylePacks()
      .then((packs) => {
        if (cancelled) return
        const radius = Number(packs.find((pack) => pack.id === selectedId)?.surfaces?.radius)
        if (Number.isFinite(radius) && radius > 0) setStylePackRadius(radius)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const root = globalThis.document.documentElement
    const body = globalThis.document.body
    const previousRootOverflow = root.style.overflow
    const previousBodyOverflow = body.style.overflow
    const previousBodyPaddingRight = body.style.paddingRight
    const scrollbarWidth = globalThis.innerWidth - root.clientWidth

    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) {
      const currentPaddingRight =
        Number.parseFloat(globalThis.getComputedStyle(body).paddingRight) || 0
      body.style.paddingRight = `${currentPaddingRight + scrollbarWidth}px`
    }

    return () => {
      root.style.overflow = previousRootOverflow
      body.style.overflow = previousBodyOverflow
      body.style.paddingRight = previousBodyPaddingRight
    }
  }, [])

  function togglePreserve(key: keyof VisualRedesignBrief['preserve']) {
    setBrief((current) => ({
      ...current,
      preserve: { ...current.preserve, [key]: !current.preserve[key] },
    }))
  }

  function setAxisDirection(key: VisualAxisKey, direction: string) {
    setBrief((current) => {
      const normalized = normalizeVisualRedesignBrief(current)
      return {
        ...normalized,
        axes: {
          ...normalized.axes,
          [key]: { ...normalized.axes[key], direction },
        },
      }
    })
  }

  function setAxisRange(key: VisualAxisKey, range: VisualAxisRange) {
    setBrief((current) => {
      const normalized = normalizeVisualRedesignBrief(current)
      return {
        ...normalized,
        axes: {
          ...normalized.axes,
          [key]: { ...normalized.axes[key], range },
        },
      }
    })
  }

  return (
    <div
      className="settings-backdrop visual-optimization-backdrop"
      onWheel={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
    >
      <div
        className="settings-dialog visual-optimization-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="视觉优化"
      >
        <div className="settings-dialog-header">
          <div>
            <span className="visual-dialog-eyebrow">Visual Direction</span>
            <h2>{artboard ? `视觉优化 · ${artboard.name}` : '视觉方向 · 新建设计稿'}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="visual-optimization-body">
          {artboard ? (
            <section className="visual-quick-action">
              <div className="visual-action-icon">
                <SlidersHorizontal size={20} />
              </div>
              <div>
                <strong>统一视觉规范</strong>
                <p>
                  按{activeLanguage ? `「${activeLanguage.name}」` : '「新粗野」'}
                  的圆角、描边和深度 Token 统一当前画板，直接修改，可撤销，不调用模型。
                </p>
                {normalizedCount !== undefined ? (
                  <small>
                    <Check size={14} /> 已更新 {normalizedCount} 个节点
                  </small>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() =>
                  setNormalizedCount(
                    onNormalize(brief.designLanguage, { cornerRadius: stylePackRadius }),
                  )
                }
              >
                立即整理
              </button>
            </section>
          ) : null}

          <section className="visual-brief-section">
            <div className="visual-section-title">
              <WandSparkles size={18} />
              <div>
                <strong>{artboard ? '视觉深化并生成新版' : '设定视觉方向并开始生成'}</strong>
                <p>
                  {artboard
                    ? '编译为当前回合的结构化要求，通过现有 Agent 创建 Variant，原稿不会被覆盖。'
                    : '先确定页面的视觉语言与设计约束，再交给 Agent 从零生成可编辑设计稿。'}
                </p>
              </div>
            </div>

            <div className="visual-brief-templates">
              <strong>项目 Brief 模板</strong>
              <div>
                {BUILTIN_VISUAL_BRIEF_TEMPLATES.map((template) => (
                  <span key={template.id}>
                    <button
                      type="button"
                      onClick={() => setBrief((current) => ({ ...current, ...template.patch }))}
                    >
                      {template.name}
                    </button>
                  </span>
                ))}
                {templates.map((template) => (
                  <span key={template.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setBrief(normalizeVisualRedesignBrief(structuredClone(template.brief)))
                      }
                    >
                      {template.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`删除模板 ${template.name}`}
                      onClick={() => onDeleteTemplate?.(template.id)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              {onSaveTemplate ? (
                <label>
                  <input
                    value={templateName}
                    placeholder="模板名称"
                    onChange={(event) => setTemplateName(event.target.value)}
                  />
                  <button
                    type="button"
                    disabled={!templateName.trim()}
                    onClick={() => {
                      onSaveTemplate(templateName.trim(), structuredClone(brief))
                      setTemplateName('')
                    }}
                  >
                    保存当前 Brief
                  </button>
                </label>
              ) : null}
            </div>

            <label className="visual-brief-field">
              <span>视觉概念</span>
              <input
                value={brief.concept}
                onChange={(event) =>
                  setBrief((current) => ({ ...current, concept: event.target.value }))
                }
              />
            </label>

            <div className="visual-brief-field-grid">
              <label className="visual-brief-field">
                <span>目标受众</span>
                <input
                  value={brief.targetAudience}
                  placeholder="例如：18–28 岁年轻音乐爱好者"
                  onChange={(event) =>
                    setBrief((current) => ({
                      ...current,
                      targetAudience: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="visual-brief-field">
                <span>页面核心目标</span>
                <input
                  value={brief.primaryGoal}
                  placeholder="例如：突出阵容并引导购票"
                  onChange={(event) =>
                    setBrief((current) => ({ ...current, primaryGoal: event.target.value }))
                  }
                />
              </label>
            </div>

            <BriefChoiceGroup
              label="页面类型"
              value={brief.pageType}
              options={[
                { value: 'auto', label: '自动判断' },
                { value: 'campaign', label: '活动 H5' },
                { value: 'content', label: '内容产品' },
                { value: 'dashboard', label: '后台数据' },
              ]}
              onChange={(pageType) => setBrief((current) => ({ ...current, pageType }))}
            />

            <div className="visual-brief-control-grid">
              <BriefChoiceGroup
                label="信息密度"
                value={brief.density}
                options={[
                  { value: 'airy', label: '疏朗' },
                  { value: 'balanced', label: '均衡' },
                  { value: 'rich', label: '丰富' },
                ]}
                onChange={(density) => setBrief((current) => ({ ...current, density }))}
              />
              <BriefChoiceGroup
                label="探索幅度"
                value={brief.exploration}
                options={[
                  { value: 'conservative', label: '克制' },
                  { value: 'balanced', label: '适度' },
                  { value: 'bold', label: '大胆' },
                ]}
                onChange={(exploration) => setBrief((current) => ({ ...current, exploration }))}
              />
            </div>

            <BriefChoiceGroup
              label="图片策略"
              value={brief.imagery}
              options={[
                { value: 'auto', label: '自动判断' },
                { value: 'none', label: '不使用图片' },
                { value: 'hero', label: '生成主视觉' },
                { value: 'hero-and-content', label: '主视觉+配图' },
              ]}
              onChange={(imagery) => setBrief((current) => ({ ...current, imagery }))}
            />

            <fieldset className="visual-design-language">
              <legend>设计语言</legend>
              <p>
                决定圆角、描边、深度和材质语言。选「自动」时不施加材质约束，由模型按页面类型判断。
              </p>
              <div className="visual-language-grid">
                <button
                  type="button"
                  className={brief.designLanguage === 'auto' ? 'active' : ''}
                  onClick={() => setBrief((current) => ({ ...current, designLanguage: 'auto' }))}
                >
                  <strong>自动</strong>
                  <small>不限制材质语言</small>
                </button>
                {DESIGN_LANGUAGES.map((language) => (
                  <button
                    key={language.id}
                    type="button"
                    className={brief.designLanguage === language.id ? 'active' : ''}
                    onClick={() =>
                      setBrief((current) => ({ ...current, designLanguage: language.id }))
                    }
                  >
                    <strong>{language.name}</strong>
                    <small>{language.description}</small>
                  </button>
                ))}
              </div>
              {activeLanguage ? (
                <dl className="visual-language-tokens">
                  <div>
                    <dt>圆角</dt>
                    <dd>≤ {activeLanguage.tokens.cornerRadius}px</dd>
                  </div>
                  <div>
                    <dt>描边</dt>
                    <dd>
                      {activeLanguage.tokens.strokeWidth > 0
                        ? `≤ ${activeLanguage.tokens.strokeWidth}px`
                        : '不使用'}
                    </dd>
                  </div>
                  <div>
                    <dt>投影</dt>
                    <dd>
                      {activeLanguage.tokens.shadow
                        ? `${activeLanguage.tokens.shadow.x}/${activeLanguage.tokens.shadow.y}/${activeLanguage.tokens.shadow.blur}`
                        : '不使用'}
                    </dd>
                  </div>
                  <div>
                    <dt>深度</dt>
                    <dd>{activeLanguage.tokens.depthModel}</dd>
                  </div>
                </dl>
              ) : null}
            </fieldset>

            <fieldset className="visual-axis-matrix">
              <legend>逐项变化方向与幅度</legend>
              <p>
                每条轴独立控制。选「保持不变」锁住该属性，选「自动」交由模型判断方向。分轴设置可以表达"构图大胆、配色克制"。
              </p>
              {VISUAL_AXIS_DEFINITIONS.map((definition) => {
                const axis = normalizedBrief.axes[definition.key]
                const locked = axis.direction === 'keep'
                return (
                  <div className="visual-axis-row" key={definition.key}>
                    <span className="visual-axis-label">{definition.label}</span>
                    <div className="visual-axis-directions">
                      <button
                        type="button"
                        className={locked ? 'active' : ''}
                        onClick={() => setAxisDirection(definition.key, 'keep')}
                      >
                        保持不变
                      </button>
                      <button
                        type="button"
                        className={axis.direction === 'auto' ? 'active' : ''}
                        onClick={() => setAxisDirection(definition.key, 'auto')}
                      >
                        自动
                      </button>
                      {definition.directions.map((direction) => (
                        <button
                          key={direction}
                          type="button"
                          className={axis.direction === direction ? 'active' : ''}
                          onClick={() => setAxisDirection(definition.key, direction)}
                        >
                          {direction}
                        </button>
                      ))}
                    </div>
                    <div className="visual-axis-range">
                      {(['subtle', 'moderate', 'extreme'] as VisualAxisRange[]).map((range) => (
                        <button
                          key={range}
                          type="button"
                          disabled={locked}
                          className={!locked && axis.range === range ? 'active' : ''}
                          onClick={() => setAxisRange(definition.key, range)}
                        >
                          {VISUAL_AXIS_RANGE_LABELS[range]}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </fieldset>

            <div className="visual-brief-grid">
              <fieldset>
                <legend>必须保留</legend>
                <BriefToggle
                  checked={brief.preserve.content}
                  label="准确文案与业务内容"
                  onChange={() => togglePreserve('content')}
                />
                <BriefToggle
                  checked={brief.preserve.informationArchitecture}
                  label="信息架构与模块顺序"
                  onChange={() => togglePreserve('informationArchitecture')}
                />
                <BriefToggle
                  checked={brief.preserve.palette}
                  label="当前主色关系"
                  onChange={() => togglePreserve('palette')}
                />
                <BriefToggle
                  checked={brief.preserve.brandAssets}
                  label="Logo、IP 与真实图片资产"
                  onChange={() => togglePreserve('brandAssets')}
                />
                <BriefToggle
                  checked={brief.preserve.keyJourney}
                  label="主 CTA 与关键转化路径"
                  onChange={() => togglePreserve('keyJourney')}
                />
              </fieldset>
            </div>

            <label className="visual-brief-field">
              <span>唯一主视觉焦点</span>
              <input
                value={brief.signatureDescription}
                onChange={(event) =>
                  setBrief((current) => ({
                    ...current,
                    signatureDescription: event.target.value,
                  }))
                }
              />
            </label>

            <div className="visual-brief-control-grid">
              <BriefChoiceGroup
                label="焦点位置"
                value={brief.signaturePlacement}
                options={[
                  { value: 'auto', label: '自动' },
                  { value: 'hero', label: 'Hero 首屏' },
                  { value: 'header', label: '全局页头' },
                ]}
                onChange={(signaturePlacement) =>
                  setBrief((current) => ({ ...current, signaturePlacement }))
                }
              />
              <BriefChoiceGroup
                label="页面段落节奏"
                value={brief.layoutRhythm}
                options={[
                  { value: 'continuous', label: '连续叙事' },
                  { value: 'sectioned', label: '模块分区' },
                  { value: 'editorial', label: '编辑式' },
                ]}
                onChange={(layoutRhythm) => setBrief((current) => ({ ...current, layoutRhythm }))}
              />
            </div>

            <BriefChoiceGroup
              label="内容区表面"
              value={brief.componentSurface}
              options={[
                { value: 'quiet', label: '安静' },
                { value: 'tonal', label: '同色系' },
                { value: 'contrast', label: '强分区' },
              ]}
              onChange={(componentSurface) =>
                setBrief((current) => ({ ...current, componentSurface }))
              }
            />

            <fieldset className="visual-palette-roles">
              <legend>色彩角色（可选）</legend>
              <p>留空时从当前画板推导；可填写 HEX、颜色名称或简短色彩描述。</p>
              <div>
                {PALETTE_ROLE_FIELDS.map((field) => (
                  <label key={field.key}>
                    <span>{field.label}</span>
                    <input
                      value={brief.paletteRoles[field.key]}
                      placeholder={field.placeholder}
                      onChange={(event) =>
                        setBrief((current) => ({
                          ...current,
                          paletteRoles: {
                            ...current.paletteRoles,
                            [field.key]: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="visual-brief-field">
              <span>禁止项</span>
              <input
                value={antiPatternText}
                onChange={(event) =>
                  setBrief((current) => ({
                    ...current,
                    antiPatterns: event.target.value
                      .split(/[、,，]/)
                      .map((item) => item.trim())
                      .filter(Boolean),
                  }))
                }
              />
            </label>
          </section>
        </div>

        <div className="settings-dialog-footer">
          <button className="visual-cancel-action" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="visual-variant-action"
            type="button"
            onClick={() => onCreateVariant(normalizedBrief)}
          >
            <span className="visual-variant-action-icon">
              <Layers3 size={18} />
            </span>
            <span className="visual-variant-action-copy">
              <strong>{artboard ? '生成视觉新版' : '应用视觉方向'}</strong>
              <small>{artboard ? '保留原稿 · 创建独立 Variant' : '保存 Brief · 返回生成器'}</small>
            </span>
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}

function BriefChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <div className="visual-choice-field">
      <span>{label}</span>
      <div
        className="visual-choice-group"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => (
          <button
            key={option.value}
            className={value === option.value ? 'active' : ''}
            type="button"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function BriefToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: () => void
}) {
  return (
    <label className="visual-brief-toggle">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{checked ? <Check size={13} /> : null}</span>
      {label}
    </label>
  )
}
