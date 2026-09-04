import { ChevronDown, Link, Minus, Pipette, Plus, RotateCcw, Unlink, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { RgbaColorPicker, type RgbaColor } from 'react-colorful'
import type {
  InspectorField,
  InspectorFieldValue,
  InspectorSectionSchema,
} from '../inspector/inspector-schema'
import type { CornerValues, EdgeValues, ElementLayoutSizing } from '../types'

export interface InspectorTransactionHandlers {
  onBegin?: () => void
  onCommit?: () => void
  onCancel?: () => void
}

export function InspectorSection({
  schema,
  children,
  transactions,
}: {
  schema: Pick<InspectorSectionSchema, 'id' | 'title' | 'fields' | 'columns' | 'defaultOpen'>
  children?: React.ReactNode
  transactions?: InspectorTransactionHandlers
}) {
  const [open, setOpen] = useState(schema.defaultOpen !== false)
  return (
    <section className={`inspector-section ${open ? 'open' : ''}`} data-section={schema.id}>
      <button
        className="inspector-section-header"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown size={14} />
        <span>{schema.title}</span>
      </button>
      {open ? (
        <div className={`inspector-section-content columns-${schema.columns ?? 1}`}>
          {schema.fields.map((field) => (
            <InspectorFieldRenderer key={field.id} field={field} transactions={transactions} />
          ))}
          {children}
        </div>
      ) : null}
    </section>
  )
}

export function InspectorFieldRenderer({
  field,
  transactions,
}: {
  field: InspectorField
  transactions?: InspectorTransactionHandlers
}) {
  if (field.type === 'toggle') return <ToggleField field={field} transactions={transactions} />
  if (field.type === 'segmented')
    return <SegmentedField field={field} transactions={transactions} />
  if (field.type === 'color') return <ColorField field={field} transactions={transactions} />
  if (field.type === 'image') return <ImageField field={field} />
  if (field.type === 'edges')
    return <BoxValuesField field={field} kind="edges" transactions={transactions} />
  if (field.type === 'corners')
    return <BoxValuesField field={field} kind="corners" transactions={transactions} />
  if (field.type === 'alignment-grid')
    return <AlignmentGridField field={field} transactions={transactions} />
  if (field.type === 'size-limits') {
    const sizing = field.value as ElementLayoutSizing
    return (
      <SizeLimitsField
        key={`${sizing.widthMode}:${sizing.heightMode}`}
        field={field}
        transactions={transactions}
      />
    )
  }

  const interaction = createInteraction(field, transactions)

  return (
    <label className={`inspector-field inspector-field-${field.type}`}>
      <FieldLabel field={field} transactions={transactions} draggable={field.type === 'number'} />
      {field.type === 'textarea' ? (
        <textarea
          rows={field.rows ?? 3}
          value={String(field.value ?? '')}
          readOnly={field.readOnly}
          onFocus={interaction.begin}
          onBlur={interaction.commit}
          onKeyDown={interaction.keyDown}
          onChange={(event) => field.onChange?.(event.target.value)}
        />
      ) : field.type === 'select' ? (
        <select
          value={String(field.value ?? '')}
          onChange={(event) => interaction.discrete(event.target.value)}
        >
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.type === 'readonly' ? (
        <div className="inspector-readonly">{String(field.value ?? '—')}</div>
      ) : (
        <div className="inspector-input-shell">
          <input
            type={field.type === 'number' ? 'number' : 'text'}
            min={field.min}
            max={field.max}
            step={field.step ?? (field.type === 'number' ? 1 : undefined)}
            value={field.mixed ? '' : String(field.value ?? '')}
            placeholder={field.mixed ? '混合' : undefined}
            readOnly={field.readOnly}
            onFocus={interaction.begin}
            onBlur={interaction.commit}
            onKeyDown={interaction.keyDown}
            onChange={(event) =>
              field.onChange?.(
                field.type === 'number'
                  ? event.target.value === ''
                    ? undefined
                    : Number(event.target.value)
                  : event.target.value,
              )
            }
          />
          {field.unit ? <span className="inspector-unit">{field.unit}</span> : null}
        </div>
      )}
    </label>
  )
}

function ToggleField({
  field,
  transactions,
}: {
  field: InspectorField
  transactions?: InspectorTransactionHandlers
}) {
  const interaction = createInteraction(field, transactions)
  return (
    <div className="inspector-field inspector-toggle-field">
      <FieldLabel field={field} transactions={transactions} />
      <button
        className={`inspector-toggle ${field.value ? 'active' : ''} ${field.mixed ? 'mixed' : ''}`}
        type="button"
        role="switch"
        aria-checked={Boolean(field.value)}
        onClick={() => interaction.discrete(!field.value)}
      >
        <span>{field.mixed ? <Minus size={10} /> : null}</span>
      </button>
    </div>
  )
}

function SegmentedField({
  field,
  transactions,
}: {
  field: InspectorField
  transactions?: InspectorTransactionHandlers
}) {
  const interaction = createInteraction(field, transactions)
  return (
    <div className="inspector-field inspector-segmented-field">
      <FieldLabel field={field} transactions={transactions} />
      <div className="inspector-segmented">
        {field.options?.map((option) => (
          <button
            key={option.value}
            className={field.value === option.value ? 'active' : ''}
            type="button"
            disabled={option.disabled}
            title={option.disabled ? '当前布局上下文不支持此模式' : undefined}
            onClick={() => interaction.discrete(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function SizeLimitsField({
  field,
  transactions,
}: {
  field: InspectorField
  transactions?: InspectorTransactionHandlers
}) {
  const sizing = field.value as ElementLayoutSizing
  const definitions: Array<readonly [keyof ElementLayoutSizing, string]> = [
    ...(sizing.widthMode !== 'fixed'
      ? [['minWidth', '最小宽度'] as const, ['maxWidth', '最大宽度'] as const]
      : []),
    ...(sizing.heightMode !== 'fixed'
      ? [['minHeight', '最小高度'] as const, ['maxHeight', '最大高度'] as const]
      : []),
  ]
  const [visible, setVisible] = useState<Array<keyof ElementLayoutSizing>>(
    definitions.map(([key]) => key).filter((key) => sizing[key] !== undefined),
  )
  const interaction = createInteraction(field, transactions)
  const update = (key: keyof ElementLayoutSizing, value: number | undefined) => {
    field.onChange?.({ ...sizing, [key]: value })
  }
  const available = definitions.filter(([key]) => !visible.includes(key))
  return (
    <div className="inspector-field inspector-size-limits-field">
      {visible.length ? (
        <div className="inspector-size-limit-list">
          {definitions
            .filter(([key]) => visible.includes(key))
            .map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <div className="inspector-size-limit-input">
                  <input
                    type="number"
                    min={0}
                    value={typeof sizing[key] === 'number' ? sizing[key] : ''}
                    placeholder="未设置"
                    onFocus={interaction.begin}
                    onBlur={interaction.commit}
                    onKeyDown={interaction.keyDown}
                    onChange={(event) =>
                      update(
                        key,
                        event.target.value === '' ? undefined : Number(event.target.value),
                      )
                    }
                  />
                  <em>px</em>
                  <button
                    type="button"
                    title={`移除${label}`}
                    onClick={() => {
                      interaction.discrete({ ...sizing, [key]: undefined })
                      setVisible((current) => current.filter((item) => item !== key))
                    }}
                  >
                    <X size={11} />
                  </button>
                </div>
              </label>
            ))}
        </div>
      ) : (
        <span className="inspector-size-limits-empty">未设置尺寸限制</span>
      )}
      {available.length ? (
        <div className="inspector-size-limit-actions">
          {available.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setVisible((current) => [...current, key])}
            >
              <Plus size={11} />
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ColorField({
  field,
  transactions,
}: {
  field: InspectorField
  transactions?: InspectorTransactionHandlers
}) {
  const value = String(field.value ?? '')
  const color = parseCssColor(value) ?? { r: 255, g: 255, b: 255, a: 1 }
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<'hex' | 'rgba'>(() =>
    value.trim().toLowerCase().startsWith('rgb') ? 'rgba' : 'hex',
  )
  const [draft, setDraft] = useState(() =>
    formatCssColor(color, value.trim().toLowerCase().startsWith('rgb') ? 'rgba' : 'hex'),
  )
  const [recent, setRecent] = useState<string[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  const update = (next: InspectorFieldValue) => field.onChange?.(next)
  const interaction = createInteraction(field, transactions)
  const close = (commit = true) => {
    if (!open) return
    setOpen(false)
    if (commit) interaction.commit()
    else interaction.cancel()
  }
  const updateColor = (next: RgbaColor, nextFormat = format) =>
    update(formatCssColor(next, nextFormat))
  useEffect(() => {
    setDraft(formatCssColor(parseCssColor(value) ?? { r: 255, g: 255, b: 255, a: 1 }, format))
  }, [format, value])
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
      interaction.commit()
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [interaction, open])
  return (
    <div className="inspector-field inspector-color-field" ref={rootRef}>
      <FieldLabel field={field} transactions={transactions} />
      <div className="inspector-color-control">
        <button
          className="inspector-color-swatch"
          type="button"
          aria-label={`编辑${field.label}颜色`}
          onClick={() => {
            if (open) close(true)
            else {
              interaction.begin()
              setOpen(true)
            }
          }}
        >
          <span style={{ background: formatCssColor(color, 'rgba') }} />
        </button>
        <input
          type="text"
          value={value}
          onFocus={interaction.begin}
          onBlur={interaction.commit}
          onKeyDown={interaction.keyDown}
          onChange={(event) => update(event.target.value)}
        />
        <button
          className="inspector-color-alpha"
          type="button"
          onClick={() => {
            if (!open) interaction.begin()
            setOpen(true)
          }}
        >
          {Math.round(color.a * 100)}%
        </button>
      </div>
      {open ? (
        <div className="inspector-color-popover" role="dialog" aria-label={`${field.label}取色器`}>
          <RgbaColorPicker color={color} onChange={updateColor} />
          <div className="inspector-color-toolbar">
            <div className="inspector-color-format">
              {(['hex', 'rgba'] as const).map((item) => (
                <button
                  key={item}
                  className={format === item ? 'active' : ''}
                  type="button"
                  onClick={() => {
                    setFormat(item)
                    updateColor(color, item)
                  }}
                >
                  {item.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              className="inspector-eyedropper"
              type="button"
              title="从屏幕吸取颜色"
              disabled={!supportsEyeDropper()}
              onClick={() =>
                void pickScreenColor().then((next) => {
                  if (!next) return
                  updateColor({ ...next, a: color.a })
                })
              }
            >
              <Pipette size={13} />
            </button>
          </div>
          <div className="inspector-color-values">
            <input
              aria-label="颜色值"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                const next = parseCssColor(event.target.value)
                if (next) updateColor(next)
              }}
              onBlur={() => setDraft(formatCssColor(color, format))}
            />
            <label>
              <input
                aria-label="透明度"
                type="number"
                min={0}
                max={100}
                value={Math.round(color.a * 100)}
                onChange={(event) =>
                  updateColor({
                    ...color,
                    a: Math.max(0, Math.min(1, Number(event.target.value) / 100)),
                  })
                }
              />
              <span>%</span>
            </label>
          </div>
          {recent.length ? (
            <div className="inspector-recent-colors">
              {recent.map((item) => (
                <button
                  key={item}
                  type="button"
                  title={item}
                  style={{ background: item }}
                  onClick={() => {
                    const next = parseCssColor(item)
                    if (next) updateColor(next)
                  }}
                />
              ))}
            </div>
          ) : null}
          <button
            className="inspector-color-done"
            type="button"
            onClick={() => {
              setRecent((items) =>
                [
                  formatCssColor(color, 'rgba'),
                  ...items.filter((item) => item !== formatCssColor(color, 'rgba')),
                ].slice(0, 8),
              )
              close(true)
            }}
          >
            完成
          </button>
        </div>
      ) : null}
    </div>
  )
}

function BoxValuesField({
  field,
  kind,
  transactions,
}: {
  field: InspectorField
  kind: 'edges' | 'corners'
  transactions?: InspectorTransactionHandlers
}) {
  const value = field.value as EdgeValues | CornerValues
  const keys =
    kind === 'edges'
      ? (['top', 'right', 'bottom', 'left'] as const)
      : (['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const)
  const numericValue = value as unknown as Record<string, number>
  const labels = kind === 'edges' ? ['上', '右', '下', '左'] : ['左上', '右上', '右下', '左下']
  const linkedByValue = keys.every((key) => numericValue[key] === numericValue[keys[0]])
  const [linked, setLinked] = useState(linkedByValue)
  const interaction = createInteraction(field, transactions)
  const change = (key: (typeof keys)[number], next: number) => {
    const patch = linked
      ? Object.fromEntries(keys.map((item) => [item, next]))
      : { ...numericValue, [key]: next }
    field.onChange?.(patch as unknown as EdgeValues | CornerValues)
  }
  return (
    <div className="inspector-field inspector-box-values-field">
      <div className="inspector-field-heading">
        <FieldLabel field={field} transactions={transactions} />
        <button
          type="button"
          title={linked ? '解除联动' : '联动四项'}
          onClick={() => setLinked((current) => !current)}
        >
          {linked ? <Link size={12} /> : <Unlink size={12} />}
        </button>
      </div>
      <div className="inspector-box-values-grid">
        {keys.map((key, index) => (
          <label key={key}>
            <span>{labels[index]}</span>
            <input
              type="number"
              min={0}
              value={numericValue[key]}
              onFocus={interaction.begin}
              onBlur={interaction.commit}
              onKeyDown={interaction.keyDown}
              onChange={(event) => change(key, Number(event.target.value))}
            />
          </label>
        ))}
      </div>
    </div>
  )
}

function AlignmentGridField({
  field,
  transactions,
}: {
  field: InspectorField
  transactions?: InspectorTransactionHandlers
}) {
  const interaction = createInteraction(field, transactions)
  const positions = [
    'start:start',
    'start:center',
    'start:end',
    'center:start',
    'center:center',
    'center:end',
    'end:start',
    'end:center',
    'end:end',
  ]
  return (
    <div className="inspector-field inspector-alignment-field">
      <FieldLabel field={field} transactions={transactions} />
      <div className="inspector-alignment-grid">
        {positions.map((position) => (
          <button
            key={position}
            type="button"
            className={field.value === position ? 'active' : ''}
            aria-label={`对齐 ${position}`}
            onClick={() => interaction.discrete(position)}
          >
            <span />
          </button>
        ))}
      </div>
    </div>
  )
}

function FieldLabel({
  field,
  transactions,
  draggable = false,
}: {
  field: InspectorField
  transactions?: InspectorTransactionHandlers
  draggable?: boolean
}) {
  const content = draggable ? (
    <NumberDragLabel field={field} transactions={transactions} />
  ) : (
    field.label
  )
  if (!field.resettable)
    return (
      <span className={`inspector-field-label ${draggable && !field.readOnly ? 'draggable' : ''}`}>
        {content}
      </span>
    )
  const interaction = createInteraction(field, transactions)
  return (
    <span className="inspector-field-label inspector-resettable-label">
      {content}
      <button
        type="button"
        title={`重置${field.label}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => interaction.discrete(field.defaultValue)}
      >
        <RotateCcw size={10} />
      </button>
    </span>
  )
}

function NumberDragLabel({
  field,
  transactions,
}: {
  field: InspectorField
  transactions?: InspectorTransactionHandlers
}) {
  const drag = useRef<{ startX: number; startValue: number } | undefined>(undefined)
  const interaction = createInteraction(field, transactions)
  if (field.readOnly || typeof field.value !== 'number') return field.label
  return (
    <span
      className="inspector-number-drag-label"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { startX: event.clientX, startValue: field.value as number }
        interaction.begin()
      }}
      onPointerMove={(event) => {
        if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return
        const multiplier = event.shiftKey ? 0.1 : event.altKey ? 10 : 1
        const step = field.step ?? 1
        const raw =
          drag.current.startValue + (event.clientX - drag.current.startX) * step * multiplier
        const next = Math.max(
          field.min ?? Number.NEGATIVE_INFINITY,
          Math.min(field.max ?? Number.POSITIVE_INFINITY, raw),
        )
        field.onChange?.(Math.round(next * 100) / 100)
      }}
      onPointerUp={(event) => {
        if (!drag.current) return
        drag.current = undefined
        event.currentTarget.releasePointerCapture(event.pointerId)
        interaction.commit()
      }}
      onPointerCancel={() => {
        drag.current = undefined
        interaction.cancel()
      }}
    >
      {field.label}
    </span>
  )
}

function createInteraction(field: InspectorField, transactions?: InspectorTransactionHandlers) {
  const enabled = field.transactional !== false && Boolean(transactions?.onBegin)
  return {
    begin: () => {
      if (enabled) transactions?.onBegin?.()
    },
    commit: () => {
      if (enabled) transactions?.onCommit?.()
    },
    cancel: () => {
      if (enabled) transactions?.onCancel?.()
    },
    keyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Escape' || !enabled) return
      event.preventDefault()
      transactions?.onCancel?.()
      event.currentTarget.blur()
    },
    discrete: (value: InspectorFieldValue) => {
      if (!enabled) {
        field.onChange?.(value)
        return
      }
      transactions?.onBegin?.()
      field.onChange?.(value)
      transactions?.onCommit?.()
    },
  }
}

function ImageField({ field }: { field: InspectorField }) {
  const src = String(field.value ?? '')
  return (
    <div className="inspector-field inspector-image-field">
      <span className="inspector-field-label">{field.label}</span>
      <div className="inspector-image-preview">
        {src ? <img src={src} alt="" /> : <span>无图片</span>}
      </div>
    </div>
  )
}

function parseCssColor(value: string): RgbaColor | undefined {
  const source = value.trim()
  const hex = source.match(/^#([0-9a-f]{3,8})$/i)?.[1]
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const expanded =
      hex.length <= 4
        ? hex
            .split('')
            .map((char) => `${char}${char}`)
            .join('')
        : hex
    const number = Number.parseInt(expanded.slice(0, 6), 16)
    return {
      r: number >> 16,
      g: (number >> 8) & 255,
      b: number & 255,
      a: expanded.length === 8 ? Number.parseInt(expanded.slice(6), 16) / 255 : 1,
    }
  }
  const rgba = source.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*[,/]\s*([\d.]+)(%)?)?\s*\)$/i,
  )
  if (!rgba) return undefined
  return {
    r: clampColorChannel(Number(rgba[1])),
    g: clampColorChannel(Number(rgba[2])),
    b: clampColorChannel(Number(rgba[3])),
    a: Math.max(0, Math.min(1, rgba[4] === undefined ? 1 : Number(rgba[4]) / (rgba[5] ? 100 : 1))),
  }
}

function formatCssColor(color: RgbaColor, format: 'hex' | 'rgba') {
  const alpha = Math.max(0, Math.min(1, color.a))
  if (format === 'rgba')
    return `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.round(alpha * 100) / 100})`
  const rgb = [color.r, color.g, color.b]
    .map((channel) => clampColorChannel(channel).toString(16).padStart(2, '0'))
    .join('')
  const alphaHex = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
  return `#${rgb}${alpha < 1 ? alphaHex : ''}`
}

function clampColorChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function supportsEyeDropper() {
  return typeof window !== 'undefined' && 'EyeDropper' in window
}

async function pickScreenColor(): Promise<RgbaColor | undefined> {
  const EyeDropper = (
    window as typeof window & {
      EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> }
    }
  ).EyeDropper
  if (!EyeDropper) return undefined
  try {
    return parseCssColor((await new EyeDropper().open()).sRGBHex)
  } catch {
    return undefined
  }
}
