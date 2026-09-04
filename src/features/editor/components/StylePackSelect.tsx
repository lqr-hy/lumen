import { useEffect, useState } from 'react'
import { Palette } from 'lucide-react'
import { listAvailableStylePacks, type StylePackSummary } from '../../ai/style-packs'
import { CompactSelectMenu } from './CompactSelectMenu'

interface StylePackSelectProps {
  value: string
  onChange: (id: string) => void
}

export function StylePackSelect({ value, onChange }: StylePackSelectProps) {
  const [packs, setPacks] = useState<StylePackSummary[]>([])

  useEffect(() => {
    let cancelled = false
    listAvailableStylePacks()
      .then((items) => {
        if (cancelled) return
        setPacks(items.filter((item) => item.enabled))
      })
      .catch(() => {
        if (!cancelled) setPacks([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (value && packs.length && !packs.some((pack) => pack.id === value)) onChange('')
  }, [onChange, packs, value])

  const selected = packs.find((pack) => pack.id === value)
  return (
    <CompactSelectMenu
      ariaLabel="设计风格"
      className="style-pack"
      icon={<Palette size={14} />}
      value={value}
      displayValue={selected?.name || '自动'}
      options={[
        { value: '', label: '自动', description: '跟随 KV 或当前设计上下文' },
        ...packs.map((pack) => ({
          value: pack.id,
          label: pack.name,
          description: pack.description,
          swatch: Object.values(pack.colors)[0],
        })),
      ]}
      onChange={onChange}
    />
  )
}
