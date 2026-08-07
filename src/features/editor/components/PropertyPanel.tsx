import { Copy, Download, SlidersHorizontal, WandSparkles } from 'lucide-react'
import { useEditorStore } from '../store/editor-store'
import type { Artboard, ComponentInstance, DesignDocument, DesignElement } from '../types'
import {
  canRegenerateComponentSlot,
  createComponentSlotRegenerationText,
  isComponentRootElement,
} from '../utils/component-edit-scope'

interface PropertyPanelProps {
  onExportComponent?: (instanceId: string) => void
  onExportStructural?: (instanceId: string) => void
}

export function PropertyPanel({ onExportComponent, onExportStructural }: PropertyPanelProps) {
  const document = useEditorStore((state) => state.document)
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const updateElement = useEditorStore((state) => state.updateElement)
  const updateArtboard = useEditorStore((state) => state.updateArtboard)
  const setSectionAutoLayout = useEditorStore((state) => state.setSectionAutoLayout)
  const addQueuedChatText = useEditorStore((state) => state.addQueuedChatText)
  const element = document?.elements.find((item) => item.id === selectedElementIds[0])
  const componentInstance = element?.componentBinding
    ? document?.componentInstances?.[element.componentBinding.instanceId]
    : undefined
  const structuralInstance = element?.componentBinding
    ? document?.structuralInstances?.[element.componentBinding.instanceId]
    : undefined
  const showComponentDesign = Boolean(componentInstance && isComponentRootElement(element))

  if (!document) return null

  if (!element) {
    const artboard = document.artboards.find((item) => item.id === useEditorStore.getState().activeArtboardId)
    const setArtboard = (patch: Partial<Artboard>) => {
      if (!artboard) return
      updateArtboard(artboard.id, patch)
    }

    return (
      <aside className="property-panel">
        <div className="panel-title">
          <SlidersHorizontal size={16} />
          属性
        </div>
        {artboard ? (
          <div className="field-stack">
            <Field label="名称">
              <input value={artboard.name} onChange={(event) => setArtboard({ name: event.target.value })} />
            </Field>
            <div className="field-grid">
              <NumberField label="X" value={artboard.x} onChange={(x) => setArtboard({ x })} />
              <NumberField label="Y" value={artboard.y} onChange={(y) => setArtboard({ y })} />
              <NumberField label="宽" value={artboard.width} onChange={(width) => setArtboard({ width })} />
              <NumberField label="高" value={artboard.height} onChange={(height) => setArtboard({ height })} />
            </div>
            <Field label="背景">
              <input
                type="color"
                value={normalizeColorValue(artboard.background)}
                onChange={(event) => setArtboard({ background: event.target.value })}
              />
            </Field>
            <NumberField
              label="圆角"
              min={0}
              value={artboard.borderRadius ?? 0}
              onChange={(borderRadius) => setArtboard({ borderRadius })}
            />
            <div className="component-artboard-summary">
              组件实例
              <strong>{Object.values(document.componentInstances ?? {}).filter(
                (instance) => instance.artboardId === artboard.id,
              ).length}</strong>
            </div>
          </div>
        ) : (
          <div className="empty-panel">
            选择一个元素进行编辑
          </div>
        )}
      </aside>
    )
  }

  const setElement = (patch: Partial<DesignElement>) => updateElement(element.id, patch)

  return (
    <aside className="property-panel">
      <div className="panel-title">
        <SlidersHorizontal size={16} />
        属性
      </div>
      <div className="field-stack">
        <Field label="名称">
          <input value={element.name} onChange={(event) => setElement({ name: event.target.value })} />
        </Field>
        <div className="field-grid">
          <NumberField label="X" value={element.x} onChange={(x) => setElement({ x })} />
          <NumberField label="Y" value={element.y} onChange={(y) => setElement({ y })} />
          <NumberField label="宽" value={element.width} onChange={(width) => setElement({ width })} />
          <NumberField label="高" value={element.height} onChange={(height) => setElement({ height })} />
        </div>
        <NumberField
          label="透明度"
          min={0}
          max={1}
          step={0.05}
          value={element.opacity ?? 1}
          onChange={(opacity) => setElement({ opacity })}
        />
        <Field label="显示">
          <input
            type="checkbox"
            checked={element.visible !== false}
            onChange={(event) => setElement({ visible: event.target.checked })}
          />
        </Field>
        <Field label="裁剪内容">
          <input
            type="checkbox"
            checked={element.clipContent === true}
            onChange={(event) => setElement({ clipContent: event.target.checked })}
          />
        </Field>
        <Field label="阴影">
          <input
            type="checkbox"
            checked={Boolean(element.shadow)}
            onChange={(event) => setElement({
              shadow: event.target.checked
                ? { x: 0, y: 8, blur: 24, color: 'rgba(0,0,0,0.22)' }
                : undefined,
            })}
          />
        </Field>
        {element.shadow ? (
          <div className="field-grid">
            <NumberField
              label="阴影 X"
              value={element.shadow.x}
              onChange={(x) => setElement({ shadow: { ...element.shadow!, x } })}
            />
            <NumberField
              label="阴影 Y"
              value={element.shadow.y}
              onChange={(y) => setElement({ shadow: { ...element.shadow!, y } })}
            />
            <NumberField
              label="模糊"
              min={0}
              value={element.shadow.blur}
              onChange={(blur) => setElement({ shadow: { ...element.shadow!, blur } })}
            />
          </div>
        ) : null}
        {renderTypeFields(element, setElement, setSectionAutoLayout)}
        {element.componentBinding ? (
          <div className="component-binding-summary">
            <strong>{element.componentBinding.componentName}</strong>
            <small>{element.componentBinding.regionId}</small>
            {element.componentBinding.slotId ? <code>{element.componentBinding.slotId}</code> : null}
            {Object.entries(element.componentBinding.bindings).map(([kind, path]) => (
              <div key={kind}>
                <span>{kind}</span>
                <code>{path}</code>
              </div>
            ))}
            {canRegenerateComponentSlot(element) ? (
              <button
                type="button"
                onClick={() => addQueuedChatText({
                  id: `component-edit-${Date.now()}`,
                  text: createComponentSlotRegenerationText(element),
                  elementId: element.id,
                  target: 'bottom',
                })}
              >
                <WandSparkles size={14} />
                局部重生成
              </button>
            ) : null}
          </div>
        ) : null}
        {componentInstance && showComponentDesign ? (
          <ComponentDesignSummary
            instance={componentInstance}
            onExport={() => onExportComponent?.(componentInstance.id)}
          />
        ) : null}
        {structuralInstance ? (
          <StructuralInstanceSummary
            instance={structuralInstance}
            onExport={() => onExportStructural?.(structuralInstance.id)}
          />
        ) : null}
      </div>
    </aside>
  )
}

function StructuralInstanceSummary({
  instance,
  onExport,
}: {
  instance: NonNullable<DesignDocument['structuralInstances']>[string]
  onExport: () => void
}) {
  return (
    <div className="component-binding-summary structural-instance-summary">
      <strong>{instance.componentName}</strong>
      <small>{instance.nodeType === 'container' ? '容器结构' : '页面根节点'}</small>
      {instance.designPaths.map((path) => (
        <code key={path}>{path}</code>
      ))}
      <button className="component-export-button" type="button" onClick={onExport}>
        <Download size={14} />
        导出结构包
      </button>
    </div>
  )
}

function ComponentDesignSummary({
  instance,
  onExport,
}: {
  instance: ComponentInstance
  onExport: () => void
}) {
  const design = instance.design
  return (
    <div className="component-design-summary">
      <div className="component-design-summary-header">
        <div>
          <strong>{instance.componentName}</strong>
          <small>{instance.profile}</small>
        </div>
        <button
          type="button"
          title="复制 Props Patch"
          onClick={() => void navigator.clipboard.writeText(JSON.stringify(design.propsPatch, null, 2))}
        >
          <Copy size={14} />
        </button>
      </div>
      <div className="component-design-summary-stats">
        {design.visualShell ? <span>视觉外壳</span> : null}
        <span>{design.assetTasks.length} 个 Props 素材</span>
        <span>{design.diagnostics.length} 条诊断</span>
      </div>
      {design.qualityReview ? (
        <div className="component-quality-grid">
          {Object.entries(design.qualityReview.scores).map(([key, score]) => (
            <div key={key}>
              <span>{qualityScoreLabel(key)}</span>
              <strong>{Math.round(score * 100)}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {design.runtimeValidation ? (
        <div className={`runtime-validation-status ${design.runtimeValidation.status}`}>
          <span>Runtime</span>
          <strong>{runtimeStatusLabel(design.runtimeValidation.status)}</strong>
          <small>{design.runtimeValidation.message}</small>
        </div>
      ) : null}
      <Field label="Props Patch">
        <textarea rows={8} readOnly value={formatPropsPatchPreview(design.propsPatch)} />
      </Field>
      <button className="component-export-button" type="button" onClick={onExport}>
        <Download size={14} />
        导出组件包
      </button>
    </div>
  )
}

function qualityScoreLabel(key: string) {
  return ({
    structure: '结构',
    theme: '主题',
    readability: '可读性',
    completeness: '完整度',
    developmentReadiness: '开发',
  } as Record<string, string>)[key] ?? key
}

function runtimeStatusLabel(status: 'passed' | 'failed' | 'unsupported') {
  if (status === 'passed') return '通过'
  if (status === 'failed') return '失败'
  return '未接入'
}

function normalizeColorValue(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'
}

function formatPropsPatchPreview(propsPatch: Record<string, unknown>) {
  return JSON.stringify(propsPatch, (_key, value) => {
    if (typeof value !== 'string' || !value.startsWith('data:image/')) return value
    return `[独立图片素材 ${Math.max(1, Math.round(value.length / 1024))}KB]`
  }, 2)
}

function renderTypeFields(
  element: DesignElement,
  setElement: (patch: Partial<DesignElement>) => void,
  setSectionAutoLayout: (
    elementId: string,
    autoLayout: import('../types').SectionElement['autoLayout'],
  ) => void,
) {
  if (element.type === 'text') {
    return (
      <>
        <Field label="内容">
          <textarea
            rows={4}
            value={element.content}
            onChange={(event) => setElement({ content: event.target.value } as Partial<DesignElement>)}
          />
        </Field>
        <NumberField
          label="字号"
          value={element.style.fontSize}
          onChange={(fontSize) =>
            setElement({ style: { ...element.style, fontSize } } as Partial<DesignElement>)
          }
        />
        <Field label="颜色">
          <input
            type="color"
            value={element.style.color}
            onChange={(event) =>
              setElement({ style: { ...element.style, color: event.target.value } } as Partial<DesignElement>)
            }
          />
        </Field>
        <Field label="溢出">
          <select
            value={element.style.overflow ?? 'hidden'}
            onChange={(event) => setElement({
              style: {
                ...element.style,
                overflow: event.target.value as 'visible' | 'hidden' | 'ellipsis',
              },
            } as Partial<DesignElement>)}
          >
            <option value="visible">显示</option>
            <option value="hidden">隐藏</option>
            <option value="ellipsis">省略号</option>
          </select>
        </Field>
      </>
    )
  }

  if (element.type === 'button') {
    return (
      <>
        <Field label="文案">
          <input
            value={element.content}
            onChange={(event) => setElement({ content: event.target.value } as Partial<DesignElement>)}
          />
        </Field>
        <Field label="背景">
          <input
            type="color"
            value={element.style.background}
            onChange={(event) =>
              setElement({ style: { ...element.style, background: event.target.value } } as Partial<DesignElement>)
            }
          />
        </Field>
      </>
    )
  }

  if (element.type === 'shape') {
    return (
      <Field label="填充">
        <input
          value={element.fill}
          onChange={(event) => setElement({ fill: event.target.value } as Partial<DesignElement>)}
        />
      </Field>
    )
  }

  if (element.type === 'section') {
    const autoLayout = element.autoLayout
    return (
      <>
        <Field label="组件分组"><input value={element.label} readOnly /></Field>
        <Field label="Auto Layout">
          <input
            type="checkbox"
            checked={Boolean(autoLayout)}
            onChange={(event) => setSectionAutoLayout(element.id, event.target.checked
              ? { direction: 'vertical', gap: 12, padding: 16, align: 'center' }
              : undefined)}
          />
        </Field>
        {autoLayout ? (
          <>
            <Field label="方向">
              <select
                value={autoLayout.direction}
                onChange={(event) => setSectionAutoLayout(element.id, {
                  ...autoLayout,
                  direction: event.target.value as 'vertical' | 'horizontal',
                })}
              >
                <option value="vertical">垂直</option>
                <option value="horizontal">水平</option>
              </select>
            </Field>
            <div className="field-grid">
              <NumberField label="间距" min={0} value={autoLayout.gap} onChange={(gap) => setSectionAutoLayout(element.id, { ...autoLayout, gap })} />
              <NumberField label="内边距" min={0} value={autoLayout.padding} onChange={(padding) => setSectionAutoLayout(element.id, { ...autoLayout, padding })} />
            </div>
          </>
        ) : null}
      </>
    )
  }

  if (element.type === 'runtime-placeholder') {
    return (
      <Field label="运行时区域">
        <input value={element.label} readOnly />
      </Field>
    )
  }

  return (
    <>
      <Field label="图片地址">
        <input
          value={element.src}
          onChange={(event) => setElement({ src: event.target.value } as Partial<DesignElement>)}
        />
      </Field>
      <Field label="裁剪模式">
        <select
          value={element.objectFit ?? 'cover'}
          onChange={(event) => setElement({ objectFit: event.target.value as 'cover' | 'contain' | 'fill' } as Partial<DesignElement>)}
        >
          <option value="cover">填满</option>
          <option value="contain">完整显示</option>
          <option value="fill">拉伸</option>
        </select>
      </Field>
      <Field label="焦点">
        <select
          value={element.objectPosition ?? '50% 50%'}
          onChange={(event) => setElement({ objectPosition: event.target.value } as Partial<DesignElement>)}
        >
          <option value="50% 50%">居中</option>
          <option value="50% 0%">顶部</option>
          <option value="50% 100%">底部</option>
          <option value="0% 50%">左侧</option>
          <option value="100% 50%">右侧</option>
        </select>
      </Field>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  )
}
