import { useState } from 'react'
import { Check, ChevronDown, ChevronUp, GripVertical, Minus, Plus, Trash2 } from 'lucide-react'
import type { BlueprintConfirmation } from '../../ai/types'
import type { PromptMentionOption } from '../../../components/ui/PromptComposer'
import type { PageCompositionBlueprint } from '../types'

interface BlueprintConfirmationEditorProps {
  confirmation: BlueprintConfirmation
  componentOptions: PromptMentionOption[]
  disabled: boolean
  onUpdate: (
    update: (
      sections: PageCompositionBlueprint['sections'],
    ) => PageCompositionBlueprint['sections'],
  ) => void
  onConfirm: () => void
}

export function BlueprintConfirmationEditor({
  confirmation,
  componentOptions,
  disabled,
  onUpdate,
  onConfirm,
}: BlueprintConfirmationEditorProps) {
  const [draggedSectionId, setDraggedSectionId] = useState<string>()
  const blueprint = confirmation.blueprint
  const replacementOptions = componentOptions.filter(
    (option) => option.packId && option.componentName,
  )

  function moveSection(sectionId: string, targetIndex: number) {
    onUpdate((sections) => {
      const sourceIndex = sections.findIndex((section) => section.id === sectionId)
      if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= sections.length) return sections
      const next = [...sections]
      const [section] = next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, section)
      return next
    })
  }

  function updateSectionHeight(sectionId: string, height: number) {
    onUpdate((sections) =>
      sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              bounds: { ...section.bounds, height: Math.max(120, Math.min(3000, height)) },
            }
          : section,
      ),
    )
  }

  return (
    <div className="blueprint-confirmation-card">
      <div className="blueprint-confirmation-header">
        <div>
          <strong>页面结构</strong>
          <small>拖拽排序 · 调整高度 · 替换组件</small>
        </div>
        <span>
          {blueprint.width} × {blueprint.estimatedHeight}
        </span>
      </div>
      <div className="blueprint-confirmation-sections">
        {blueprint.sections.map((section, index) => {
          const currentOption = replacementOptions.find(
            (option) =>
              option.componentName === section.component?.componentName &&
              (!section.component?.reference?.packId ||
                option.packId === section.component?.reference?.packId),
          )
          return (
            <div
              className={draggedSectionId === section.id ? 'dragging' : undefined}
              key={section.id}
              onDragOver={(event) => {
                if (!draggedSectionId || draggedSectionId === section.id) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (draggedSectionId) moveSection(draggedSectionId, index)
                setDraggedSectionId(undefined)
              }}
            >
              <button
                className="blueprint-drag-handle"
                type="button"
                draggable
                title="拖拽调整模块顺序"
                aria-label={`拖拽第 ${index + 1} 个模块`}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', section.id)
                  setDraggedSectionId(section.id)
                }}
                onDragEnd={() => setDraggedSectionId(undefined)}
              >
                <GripVertical size={14} />
              </button>
              <span className="blueprint-section-index">{index + 1}</span>
              <div className="blueprint-section-copy">
                <input
                  className="blueprint-section-role-input"
                  value={section.role}
                  aria-label={`第 ${index + 1} 个模块名称`}
                  onChange={(event) =>
                    onUpdate((sections) =>
                      sections.map((item) =>
                        item.id === section.id ? { ...item, role: event.target.value } : item,
                      ),
                    )
                  }
                />
                <small>{section.component?.componentName ?? section.kind}</small>
              </div>
              <button
                className="blueprint-delete-action"
                type="button"
                title="删除模块"
                disabled={blueprint.sections.length <= 1}
                onClick={() =>
                  onUpdate((sections) => sections.filter((item) => item.id !== section.id))
                }
              >
                <Trash2 size={14} />
              </button>

              <div className="blueprint-section-controls">
                {section.kind === 'component-instance' ? (
                  <label className="blueprint-component-select">
                    <span>组件</span>
                    <select
                      value={currentOption?.id ?? ''}
                      disabled={!replacementOptions.length}
                      onChange={(event) => {
                        const option = replacementOptions.find(
                          (item) => item.id === event.target.value,
                        )
                        if (!option?.packId || !option.componentName) return
                        onUpdate((sections) =>
                          sections.map((item) =>
                            item.id === section.id
                              ? {
                                  ...item,
                                  component: {
                                    componentName: option.componentName!,
                                    reference: {
                                      packId: option.packId!,
                                      componentName: option.componentName!,
                                      label: option.label,
                                    },
                                  },
                                }
                              : item,
                          ),
                        )
                      }}
                    >
                      {!currentOption ? (
                        <option value="">{section.component?.componentName ?? '选择组件'}</option>
                      ) : null}
                      {replacementOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label || option.componentName}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="blueprint-height-control">
                  <span>高度</span>
                  <button
                    type="button"
                    title="减少模块高度"
                    onClick={() => updateSectionHeight(section.id, section.bounds.height - 40)}
                  >
                    <Minus size={12} />
                  </button>
                  <input
                    type="number"
                    min={120}
                    max={3000}
                    step={20}
                    value={Math.round(section.bounds.height)}
                    onChange={(event) =>
                      updateSectionHeight(section.id, Number(event.target.value) || 120)
                    }
                  />
                  <button
                    type="button"
                    title="增加模块高度"
                    onClick={() => updateSectionHeight(section.id, section.bounds.height + 40)}
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <div className="blueprint-order-actions">
                  <button
                    type="button"
                    title="上移模块"
                    disabled={index === 0}
                    onClick={() => moveSection(section.id, index - 1)}
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    type="button"
                    title="下移模块"
                    disabled={index === blueprint.sections.length - 1}
                    onClick={() => moveSection(section.id, index + 1)}
                  >
                    <ChevronDown size={13} />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <button type="button" disabled={disabled} onClick={onConfirm}>
        <Check size={14} />
        确认结构并生成
      </button>
    </div>
  )
}
