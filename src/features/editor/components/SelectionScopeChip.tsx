import { ChevronDown, LocateFixed, X } from 'lucide-react'
import type { SelectionScope } from '../../ai/types'
import { getSelectionScopeLabel } from '../utils/selection-scope'

interface SelectionScopeChipProps {
  scope: SelectionScope
  action?: 'edit' | 'regenerate'
  onLocate: () => void
  onLocateTarget?: (elementId: string) => void
  onRemoveTarget?: (elementId: string) => void
  onClear: () => void
}

export function SelectionScopeChip({
  scope,
  action = 'edit',
  onLocate,
  onLocateTarget,
  onRemoveTarget,
  onClear,
}: SelectionScopeChipProps) {
  if (scope.type === 'component-region-batch' && scope.targets.length > 1) {
    return (
      <details className="selection-scope-batch">
        <summary>
          <span>局部重生成</span>
          <strong>{scope.targets.length} 个组件素材</strong>
          <ChevronDown size={13} />
          <button
            type="button"
            title="清除全部目标"
            onClick={(event) => {
              event.preventDefault()
              onClear()
            }}
          >
            <X size={13} />
          </button>
        </summary>
        <div className="selection-scope-batch-items">
          {scope.targets.map((target) => (
            <div key={target.elementId}>
              <button
                type="button"
                onClick={() => (onLocateTarget ? onLocateTarget(target.elementId) : onLocate())}
              >
                <LocateFixed size={12} />
                <span>
                  {target.componentName} / {target.regionId}
                </span>
              </button>
              <button
                type="button"
                title={`移除 ${target.regionId}`}
                onClick={() => onRemoveTarget?.(target.elementId)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </details>
    )
  }
  return (
    <div className="selection-scope-chip" title={`AI 只修改当前范围 · ${scope.scopeId}`}>
      <span>{action === 'regenerate' ? '局部重生成' : '修改范围'}</span>
      <button type="button" className="selection-scope-main" onClick={onLocate}>
        <LocateFixed size={13} />
        <strong>{getSelectionScopeLabel(scope)}</strong>
      </button>
      <button
        type="button"
        className="selection-scope-clear"
        title="清除修改范围"
        onClick={onClear}
      >
        <X size={13} />
      </button>
    </div>
  )
}

export function InvalidSelectionScopeChip({ onClear }: { onClear: () => void }) {
  return (
    <div className="selection-scope-chip invalid" title="跨画板或业务组件混合多选不能执行局部修改">
      <span>修改范围无效</span>
      <strong>请重新选择同画板普通节点</strong>
      <button
        type="button"
        className="selection-scope-clear"
        title="清除修改范围"
        onClick={onClear}
      >
        <X size={13} />
      </button>
    </div>
  )
}
