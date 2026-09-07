import {
  Box,
  Copy,
  Download,
  Eye,
  EyeOff,
  Frame,
  Image as ImageIcon,
  Lock,
  LockOpen,
  MousePointer2,
  Type,
  WandSparkles,
} from 'lucide-react'
import { useState } from 'react'
import { InspectorSection, type InspectorTransactionHandlers } from './InspectorFields'
import {
  resolveArtboardInspectorSchema,
  resolveElementInspectorSchema,
  resolveMultiSelectionSchema,
  type InspectorSectionSchema,
} from '../inspector/inspector-schema'
import { useEditorStore } from '../store/editor-store'
import type { Artboard, ComponentInstance, DesignDocument, DesignElement } from '../types'
import {
  canRegenerateComponentSlot,
  createComponentSlotRegenerationText,
  isComponentRootElement,
} from '../utils/selection-scope'
import { resolveComposerQueueTarget } from '../utils/composer-target'

interface PropertyPanelProps {
  onExportPng?: () => void
  onExportComponent?: (instanceId: string) => void
  onExportStructural?: (instanceId: string) => void
  chatPanelOpen?: boolean
}

export function PropertyPanel({
  onExportPng,
  onExportComponent,
  onExportStructural,
  chatPanelOpen,
}: PropertyPanelProps) {
  const document = useEditorStore((state) => state.document)
  const selectedElementIds = useEditorStore((state) => state.selectedElementIds)
  const selectedArtboardId = useEditorStore((state) => state.selectedArtboardId)
  const updateElement = useEditorStore((state) => state.updateElement)
  const replaceElementImage = useEditorStore((state) => state.replaceElementImage)
  const updateArtboard = useEditorStore((state) => state.updateArtboard)
  const beginPropertyTransaction = useEditorStore((state) => state.beginPropertyTransaction)
  const previewElementProperties = useEditorStore((state) => state.previewElementProperties)
  const previewSectionAutoLayout = useEditorStore((state) => state.previewSectionAutoLayout)
  const commitPropertyTransaction = useEditorStore((state) => state.commitPropertyTransaction)
  const cancelPropertyTransaction = useEditorStore((state) => state.cancelPropertyTransaction)
  const addQueuedChatText = useEditorStore((state) => state.addQueuedChatText)

  if (!document) return null

  const selectedElements = document.elements.filter((item) => selectedElementIds.includes(item.id))
  const element = selectedElements[0]
  const artboard = document.artboards.find(
    (item) => item.id === (element?.artboardId ?? selectedArtboardId),
  )
  const transactions: InspectorTransactionHandlers = {
    onBegin: beginPropertyTransaction,
    onCommit: commitPropertyTransaction,
    onCancel: cancelPropertyTransaction,
  }

  if (selectedElements.length > 1) {
    const previewSelection = (patch: Partial<DesignElement>) =>
      previewElementProperties(selectedElements.map((item) => ({ id: item.id, patch })))
    return (
      <PropertyPanelShell>
        <InspectorHeader
          icon={<MousePointer2 size={15} />}
          title={`${selectedElements.length} 个图层`}
          subtitle="多选"
        />
        <div className="inspector-sections">
          {resolveMultiSelectionSchema(selectedElements, previewSelection).map((section) => (
            <InspectorSection key={section.id} schema={section} transactions={transactions} />
          ))}
        </div>
      </PropertyPanelShell>
    )
  }

  if (!element) {
    return (
      <PropertyPanelShell>
        {artboard ? (
          <>
            <InspectorHeader
              icon={<Frame size={15} />}
              title={artboard.name}
              subtitle="画板"
              onRename={(name) => updateArtboard(artboard.id, { name })}
            />
            <div className="inspector-sections">
              {resolveArtboardInspectorSchema(artboard, (patch) =>
                updateArtboard(artboard.id, patch),
              ).map((section) => (
                <InspectorSection key={section.id} schema={section} />
              ))}
              <InspectorSection
                schema={{ id: 'document', title: '文档', fields: [], defaultOpen: false }}
              >
                <InspectorStat
                  label="组件实例"
                  value={String(
                    Object.values(document.componentInstances ?? {}).filter(
                      (instance) => instance.artboardId === artboard.id,
                    ).length,
                  )}
                />
                <InspectorStat
                  label="节点数量"
                  value={String(
                    document.elements.filter((item) => item.artboardId === artboard.id).length,
                  )}
                />
                {artboard.designSpec ? (
                  <InspectorStat
                    label="设计模式"
                    value={surfaceKindLabel(artboard.designSpec.surfaceKind)}
                  />
                ) : null}
              </InspectorSection>
            </div>
          </>
        ) : (
          <div className="inspector-empty">
            <MousePointer2 size={18} />
            <strong>未选择对象</strong>
            <span>选择画板或图层后编辑属性</span>
          </div>
        )}
      </PropertyPanelShell>
    )
  }

  const setElement = (patch: Partial<DesignElement>) => updateElement(element.id, patch)
  const previewElement = (patch: Partial<DesignElement>) =>
    previewElementProperties([{ id: element.id, patch }])
  const componentInstance = element.componentBinding
    ? document.componentInstances?.[element.componentBinding.instanceId]
    : undefined
  const structuralInstance = element.componentBinding
    ? document.structuralInstances?.[element.componentBinding.instanceId]
    : undefined
  const showComponentDesign = Boolean(componentInstance && isComponentRootElement(element))
  const block = artboard?.designSpec?.blocks.find((item) => item.id === element.designBlockId)
  const parent = element.parentId
    ? document.elements.find((item) => item.id === element.parentId)
    : undefined
  const schema = resolveElementInspectorSchema(element, {
    update: previewElement,
    setAutoLayout: (autoLayout) => previewSectionAutoLayout(element.id, autoLayout),
    replaceImage: (image) => replaceElementImage(element.id, image),
    parent,
    responsive: Boolean(artboard?.designSpec?.responsive),
  })

  return (
    <PropertyPanelShell>
      <InspectorHeader
        icon={elementIcon(element.type)}
        title={element.name}
        subtitle={elementTypeLabel(element.type)}
        onRename={(name) => setElement({ name })}
        transactions={transactions}
        onPreviewRename={(name) => previewElement({ name })}
        actions={
          <>
            <button
              type="button"
              title={element.visible === false ? '显示图层' : '隐藏图层'}
              onClick={() => setElement({ visible: element.visible === false })}
            >
              {element.visible === false ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button
              type="button"
              title={element.locked ? '解锁图层' : '锁定图层'}
              onClick={() => setElement({ locked: !element.locked })}
            >
              {element.locked ? <Lock size={14} /> : <LockOpen size={14} />}
            </button>
          </>
        }
      />
      <div className="inspector-sections">
        {schema.map((section) => (
          <InspectorSection key={section.id} schema={section} transactions={transactions} />
        ))}
        {block ? <DesignBlockSection block={block} /> : null}
        {element.componentBinding ? (
          <InspectorSection schema={{ id: 'component-binding', title: '组件绑定', fields: [] }}>
            <ComponentBindingSummary
              element={element}
              onRegenerate={
                canRegenerateComponentSlot(element)
                  ? () =>
                      addQueuedChatText({
                        id: `component-edit-${Date.now()}`,
                        text: createComponentSlotRegenerationText(element),
                        elementId: element.id,
                        target: resolveComposerQueueTarget(chatPanelOpen),
                        kind: 'component-region-regeneration',
                      })
                  : undefined
              }
            />
          </InspectorSection>
        ) : null}
        {componentInstance && showComponentDesign ? (
          <InspectorSection
            schema={{ id: 'component-design', title: '组件设计', fields: [], defaultOpen: false }}
          >
            <ComponentDesignSummary
              instance={componentInstance}
              onExportPng={onExportPng}
              onExport={() => onExportComponent?.(componentInstance.id)}
            />
          </InspectorSection>
        ) : null}
        {structuralInstance ? (
          <InspectorSection
            schema={{
              id: 'structural-instance',
              title: '结构实例',
              fields: [],
              defaultOpen: false,
            }}
          >
            <StructuralInstanceSummary
              instance={structuralInstance}
              onExportPng={onExportPng}
              onExport={() => onExportStructural?.(structuralInstance.id)}
            />
          </InspectorSection>
        ) : null}
      </div>
    </PropertyPanelShell>
  )
}

function PropertyPanelShell({ children }: { children: React.ReactNode }) {
  return <aside className="property-panel inspector-panel">{children}</aside>
}

function InspectorHeader({
  icon,
  title,
  subtitle,
  onRename,
  onPreviewRename,
  transactions,
  actions,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  onRename?: (name: string) => void
  onPreviewRename?: (name: string) => void
  transactions?: InspectorTransactionHandlers
  actions?: React.ReactNode
}) {
  return (
    <header className="inspector-header">
      <span className="inspector-header-icon">{icon}</span>
      <div className="inspector-header-copy">
        {onRename ? (
          <input
            aria-label="对象名称"
            value={title}
            onFocus={() => transactions?.onBegin?.()}
            onBlur={() => transactions?.onCommit?.()}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              transactions?.onCancel?.()
              event.currentTarget.blur()
            }}
            onChange={(event) => (onPreviewRename ?? onRename)(event.target.value)}
          />
        ) : (
          <strong>{title}</strong>
        )}
        <span>{subtitle}</span>
      </div>
      {actions ? <div className="inspector-header-actions">{actions}</div> : null}
    </header>
  )
}

function DesignBlockSection({
  block,
}: {
  block: NonNullable<Artboard['designSpec']>['blocks'][number]
}) {
  const schema: InspectorSectionSchema = {
    id: 'design-block',
    title: '设计区块',
    defaultOpen: false,
    fields: [
      { id: 'kind', label: '类型', type: 'readonly', value: block.kind },
      { id: 'label', label: '名称', type: 'readonly', value: block.label },
      { id: 'title', label: '标题', type: 'readonly', value: block.title ?? '—' },
    ],
  }
  return (
    <InspectorSection schema={schema}>
      <div className="inspector-stat-grid">
        <InspectorStat label="条目" value={String(block.items.length)} />
        <InspectorStat label="字段" value={String(block.fields.length)} />
        <InspectorStat label="操作" value={String(block.actions.length)} />
        <InspectorStat label="列" value={String(block.columns.length)} />
      </div>
    </InspectorSection>
  )
}

function ComponentBindingSummary({
  element,
  onRegenerate,
}: {
  element: DesignElement
  onRegenerate?: () => void
}) {
  if (!element.componentBinding) return null
  return (
    <div className="inspector-detail-list">
      <InspectorStat label="组件" value={element.componentBinding.componentName} />
      <InspectorStat label="区域" value={element.componentBinding.regionId} />
      {element.componentBinding.slotId ? (
        <InspectorStat label="插槽" value={element.componentBinding.slotId} mono />
      ) : null}
      {Object.entries(element.componentBinding.bindings).map(([kind, path]) => (
        <InspectorStat key={kind} label={kind} value={path} mono />
      ))}
      {onRegenerate ? (
        <button className="inspector-command-button" type="button" onClick={onRegenerate}>
          <WandSparkles size={14} />
          局部重生成
        </button>
      ) : null}
    </div>
  )
}

function StructuralInstanceSummary({
  instance,
  onExportPng,
  onExport,
}: {
  instance: NonNullable<DesignDocument['structuralInstances']>[string]
  onExportPng?: () => void
  onExport: () => void
}) {
  return (
    <div className="inspector-detail-list">
      <InspectorStat label="组件" value={instance.componentName} />
      <InspectorStat
        label="结构"
        value={instance.nodeType === 'container' ? '容器' : '页面根节点'}
      />
      {instance.designPaths.map((path) => (
        <InspectorStat key={path} label="路径" value={path} mono />
      ))}
      <button className="inspector-command-button" type="button" onClick={onExport}>
        <Download size={14} />
        导出结构包
      </button>
      {onExportPng ? (
        <button className="inspector-command-button" type="button" onClick={onExportPng}>
          <ImageIcon size={14} />
          导出模块 PNG
        </button>
      ) : null}
    </div>
  )
}

function ComponentDesignSummary({
  instance,
  onExportPng,
  onExport,
}: {
  instance: ComponentInstance
  onExportPng?: () => void
  onExport: () => void
}) {
  const design = instance.design
  const [copied, setCopied] = useState(false)
  const copyPropsPatch = async () => {
    await navigator.clipboard.writeText(JSON.stringify(design.propsPatch, null, 2))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div className="inspector-detail-list">
      <div className="inspector-component-title">
        <div>
          <strong>{instance.componentName}</strong>
          <span>{instance.profile}</span>
        </div>
      </div>
      <div className="inspector-stat-grid">
        <InspectorStat label="素材" value={String(design.assetTasks.length)} />
        <InspectorStat label="诊断" value={String(design.diagnostics.length)} />
      </div>
      {design.runtimeValidation ? (
        <InspectorStat
          label="Runtime"
          value={runtimeStatusLabel(design.runtimeValidation.status)}
        />
      ) : null}
      <div className="inspector-json-toolbar">
        <strong>Props Patch</strong>
        <button type="button" onClick={() => void copyPropsPatch()}>
          <Copy size={12} />
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <details className="inspector-json-details">
        <summary>查看 JSON</summary>
        <pre>{formatPropsPatchPreview(design.propsPatch)}</pre>
      </details>
      <button className="inspector-command-button" type="button" onClick={onExport}>
        <Download size={14} />
        导出组件包
      </button>
      {onExportPng ? (
        <button className="inspector-command-button" type="button" onClick={onExportPng}>
          <ImageIcon size={14} />
          导出模块 PNG
        </button>
      ) : null}
    </div>
  )
}

function InspectorStat({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="inspector-stat">
      <span>{label}</span>
      <strong className={mono ? 'mono' : ''}>{value}</strong>
    </div>
  )
}

function elementIcon(type: DesignElement['type']) {
  if (type === 'text') return <Type size={15} />
  if (type === 'image') return <ImageIcon size={15} />
  if (type === 'section') return <Frame size={15} />
  return <Box size={15} />
}

function elementTypeLabel(type: DesignElement['type']) {
  return (
    (
      {
        text: '文本',
        image: '图片',
        shape: '图形',
        button: '按钮',
        section: '容器',
        'runtime-placeholder': '运行时区域',
      } as Record<string, string>
    )[type] ?? type
  )
}

function surfaceKindLabel(kind: NonNullable<Artboard['designSpec']>['surfaceKind']) {
  return ({ 'desktop-admin': '后台管理', 'desktop-web': '桌面网页', mobile: '移动端' } as const)[
    kind
  ]
}

function runtimeStatusLabel(status: 'passed' | 'failed' | 'unsupported') {
  if (status === 'passed') return '通过'
  if (status === 'failed') return '失败'
  return '未接入'
}

function formatPropsPatchPreview(propsPatch: Record<string, unknown>) {
  return JSON.stringify(
    propsPatch,
    (_key, value) => {
      if (typeof value !== 'string' || !value.startsWith('data:image/')) return value
      return `[独立图片素材 ${Math.max(1, Math.round(value.length / 1024))}KB]`
    },
    2,
  )
}
