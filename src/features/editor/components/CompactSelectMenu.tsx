import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export interface CompactSelectOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
  swatch?: string
}

interface CompactSelectMenuProps {
  ariaLabel: string
  icon: ReactNode
  value: string
  displayValue: string
  options: CompactSelectOption[]
  onChange: (value: string) => void
  className?: string
}

export function CompactSelectMenu({
  ariaLabel,
  icon,
  value,
  displayValue,
  options,
  onChange,
  className,
}: CompactSelectMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, bottom: 0, width: 224 })

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const width = Math.min(252, Math.max(216, rect.width * 2.4))
    setPosition({
      left: Math.min(window.innerWidth - width - 10, Math.max(10, rect.left)),
      bottom: Math.max(10, window.innerHeight - rect.top + 7),
      width,
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const closeOnViewportChange = () => setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeOnViewportChange)
    window.addEventListener('scroll', closeOnViewportChange, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeOnViewportChange)
      window.removeEventListener('scroll', closeOnViewportChange, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`compact-select-trigger${className ? ` ${className}` : ''}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        title={`${ariaLabel}：${displayValue}`}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        <span>{displayValue}</span>
        <ChevronDown size={13} />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="compact-select-popover"
              role="listbox"
              aria-label={ariaLabel}
              style={{ left: position.left, bottom: position.bottom, width: position.width }}
            >
              <strong>{ariaLabel}</strong>
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  disabled={option.disabled}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                >
                  {option.swatch ? <i style={{ background: option.swatch }} /> : null}
                  <span>
                    <b>{option.label}</b>
                    {option.description ? <small>{option.description}</small> : null}
                  </span>
                  {option.value === value ? <Check size={15} /> : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
