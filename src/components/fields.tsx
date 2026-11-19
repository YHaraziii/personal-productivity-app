/** Small shared form controls. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { PRIORITY_LABEL, type LabelRow, type Priority } from '../lib/types'
import { isHexColor } from '../lib/theme'
import { Icon } from './Icon'

export const COLOR_SWATCHES = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', '#64748b',
]

export const ICON_CHOICES = [
  '📁', '🎓', '📚', '🔬', '🧪', '🎙️', '🎧', '💼', '💻', '🛠️', '📝', '✏️',
  '🏠', '🛒', '💪', '🏃', '🍎', '💰', '✈️', '🎨', '🎵', '📷', '🌱', '⭐',
  '❤️', '🧠', '📅', '📌', '🚀', '🎯', '🧹', '🐾',
]

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="color-field">
        <div className="swatches" role="group" aria-label={`${label} presets`}>
          {COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              className={`swatch ${value.toLowerCase() === color ? 'swatch-selected' : ''}`}
              style={{ background: color }}
              aria-label={`Use color ${color}`}
              aria-pressed={value.toLowerCase() === color}
              onClick={() => onChange(color)}
            />
          ))}
        </div>
        <input id={id} type="color" value={isHexColor(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} aria-label={`${label} (custom)`} />
        <code className="color-code">{value}</code>
      </div>
    </div>
  )
}

export function IconField({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>Icon or emoji</label>
      <div className="icon-choices" role="group" aria-label="Icon presets">
        {ICON_CHOICES.map((icon) => (
          <button
            key={icon}
            type="button"
            className={`icon-choice ${value === icon ? 'icon-choice-selected' : ''}`}
            aria-label={`Use icon ${icon}`}
            aria-pressed={value === icon}
            onClick={() => onChange(icon)}
          >
            {icon}
          </button>
        ))}
      </div>
      <input id={id} className="input input-short" value={value} maxLength={16} onChange={(e) => onChange(e.target.value)} placeholder="Type any emoji" />
    </div>
  )
}

/** Priority is always shown as text plus a shape; color is only an accent. */
export function PriorityBadge({ priority, color }: { priority: Priority; color: string }) {
  const bars = { low: 1, medium: 2, high: 3, urgent: 4 }[priority]
  return (
    <span className={`badge priority priority-${priority}`} style={{ '--tone': color } as React.CSSProperties}>
      <span className="priority-bars" aria-hidden="true">
        {[1, 2, 3, 4].map((n) => (
          <i key={n} className={n <= bars ? 'on' : ''} />
        ))}
      </span>
      {PRIORITY_LABEL[priority]}
    </span>
  )
}

export function LabelChip({ label, onRemove }: { label: Pick<LabelRow, 'name' | 'color'>; onRemove?: () => void }) {
  return (
    <span className="badge label-chip" style={{ '--tone': label.color } as React.CSSProperties}>
      <span className="dot" aria-hidden="true" />
      {label.name}
      {onRemove && (
        <button type="button" className="chip-remove" onClick={onRemove} aria-label={`Remove label ${label.name}`}>
          ×
        </button>
      )}
    </span>
  )
}

interface MenuOption {
  value: string
  label: string
  color?: string
}

/** Multi-select dropdown with checkboxes (used by the filter bar). */
export function MultiSelectMenu({
  label,
  options,
  selected,
  onChange,
  emptyText = 'Nothing to choose from yet',
}: {
  label: string
  options: MenuOption[]
  selected: string[]
  onChange: (values: string[]) => void
  emptyText?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuId = useId()
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className={`button button-small ${selected.length > 0 ? 'button-active' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        {selected.length > 0 && <span className="count-pill">{selected.length}</span>}
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="menu-popover" id={menuId} role="group" aria-label={label}>
          {options.length === 0 && <p className="muted menu-empty">{emptyText}</p>}
          {options.map((option) => (
            <label key={option.value} className="check-row">
              <input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggle(option.value)} />
              {option.color && <span className="dot" style={{ background: option.color }} aria-hidden="true" />}
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/** Button that opens a small popover menu of actions. */
export function ActionMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="icon-button" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen((v) => !v)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu-popover menu-actions menu-right" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
