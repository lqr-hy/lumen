import { PLACEMENT_MODE_OPTIONS, type PlacementMode } from '../utils/placement-intent'
import { cn } from '../../../lib/cn'

interface PlacementModeControlProps {
  value: PlacementMode
  onChange: (value: PlacementMode) => void
  compact?: boolean
}

export function PlacementModeControl({
  value,
  onChange,
  compact = false,
}: PlacementModeControlProps) {
  return (
    <div
      className={cn('placement-mode-control', compact && 'compact')}
      role="group"
      aria-label="生成内容放置位置"
    >
      {PLACEMENT_MODE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? 'active' : undefined}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
