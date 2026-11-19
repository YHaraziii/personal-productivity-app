import { useEffect, useRef, useState } from 'react'
import { useSession } from '../data/session'
import { DEFAULT_PRIORITY_COLORS, type LayoutMode } from '../lib/settings'
import {
  THEME_COLOR_KEYS,
  THEME_COLOR_LABEL,
  THEME_PRESETS,
  contrastWarnings,
  resolveColors,
  type ResolvedMode,
  type ThemeColors,
  type ThemeMode,
  type ThemeSetting,
} from '../lib/theme'
import { LIMITS, PRIORITIES, PRIORITY_LABEL, type LabelRow, type Priority } from '../lib/types'
import type { AppData } from '../lib/view'
import { errorMessage, useFeedback } from './Feedback'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { COLOR_SWATCHES, ColorField, PriorityBadge } from './fields'

type Tab = 'appearance' | 'priorities' | 'labels' | 'dashboard'

/** Apply a value locally at once and persist it after a short pause (color
 *  pickers fire many change events while dragging). */
function useDebouncedSave<T>(value: T, save: (value: T) => Promise<void>, onError: (e: unknown) => void) {
  const [draft, setDraft] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(draft)
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (!timer.current) setDraft(value)
  }, [value])
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
        void saveRef.current(latest.current).catch(onError)
      }
    },
    [],
  )
  const update = (next: T) => {
    setDraft(next)
    latest.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void saveRef.current(next).catch(onError)
    }, 350)
  }
  return [draft, update] as const
}

function Appearance({ data, resolvedMode }: { data: AppData; resolvedMode: ResolvedMode }) {
  const { repo } = useSession()
  const { toast } = useFeedback()
  const [theme, setTheme] = useDebouncedSave<ThemeSetting>(data.settings.theme, (t) => repo.setSetting('theme', t), (e) => toast('error', errorMessage(e)))
  const [editMode, setEditMode] = useState<ResolvedMode>(resolvedMode)
  const colors = resolveColors(theme, editMode)
  const warnings = contrastWarnings(colors)
  const setCustom = (key: keyof ThemeColors, value: string) =>
    setTheme({ ...theme, custom: { ...theme.custom, [editMode]: { ...theme.custom[editMode], [key]: value } } })

  return (
    <div className="stack">
      <fieldset className="fieldset">
        <legend>Mode</legend>
        <div className="segmented">
          {(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => (
            <label key={mode} className={`segment ${theme.mode === mode ? 'segment-on' : ''}`}>
              <input type="radio" name="theme-mode" checked={theme.mode === mode} onChange={() => setTheme({ ...theme, mode })} />
              {mode === 'system' ? 'Match system' : mode === 'light' ? 'Light' : 'Dark'}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="fieldset">
        <legend>Theme preset</legend>
        <div className="preset-grid">
          {THEME_PRESETS.map((preset) => {
            const c = preset[editMode]
            return (
              <button
                key={preset.id}
                type="button"
                className={`preset ${theme.preset === preset.id ? 'preset-on' : ''}`}
                aria-pressed={theme.preset === preset.id}
                onClick={() => setTheme({ ...theme, preset: preset.id, custom: { light: {}, dark: {} } })}
                style={{ background: c.background, color: c.text, borderColor: theme.preset === preset.id ? c.accent : undefined }}
              >
                <span className="preset-swatches" aria-hidden="true">
                  <i style={{ background: c.accent }} />
                  <i style={{ background: c.surface }} />
                </span>
                {preset.name}
              </button>
            )
          })}
        </div>
        <p className="hint">Choosing a preset clears custom colors.</p>
      </fieldset>
      <fieldset className="fieldset">
        <legend>Custom colors</legend>
        <div className="segmented">
          {(['light', 'dark'] as ResolvedMode[]).map((m) => (
            <label key={m} className={`segment ${editMode === m ? 'segment-on' : ''}`}>
              <input type="radio" name="edit-mode" checked={editMode === m} onChange={() => setEditMode(m)} />
              Edit {m} palette
            </label>
          ))}
        </div>
        {THEME_COLOR_KEYS.map((key) => (
          <div key={key} className="inline color-line">
            <ColorField label={THEME_COLOR_LABEL[key]} value={colors[key]} onChange={(v) => setCustom(key, v)} />
          </div>
        ))}
        {warnings.length > 0 && (
          <div className="notice notice-warning" role="status">
            {warnings.map((w, i) => (
              <p key={i}>
                <Icon name="alert" /> {w.message}
              </p>
            ))}
          </div>
        )}
        <button type="button" className="button button-small" onClick={() => setTheme({ ...theme, custom: { ...theme.custom, [editMode]: {} } })}>
          Reset {editMode} colors to the preset
        </button>
      </fieldset>
    </div>
  )
}

function Priorities({ data }: { data: AppData }) {
  const { repo } = useSession()
  const { toast } = useFeedback()
  const [colors, setColors] = useDebouncedSave(data.settings.priority_colors, (c) => repo.setSetting('priority_colors', c), (e) => toast('error', errorMessage(e)))
  return (
    <div className="stack">
      <p className="muted">There are always four priority levels. Each is shown with its name and a bar indicator, so color is never the only cue.</p>
      {PRIORITIES.map((p: Priority) => (
        <div key={p} className="priority-line">
          <PriorityBadge priority={p} color={colors[p]} />
          <ColorField label={`${PRIORITY_LABEL[p]} color`} value={colors[p]} onChange={(v) => setColors({ ...colors, [p]: v })} />
        </div>
      ))}
      <button type="button" className="button button-small" onClick={() => setColors(DEFAULT_PRIORITY_COLORS)}>
        Restore default priority colors
      </button>
    </div>
  )
}

function LabelLine({ label, data }: { label: LabelRow; data: AppData }) {
  const { repo } = useSession()
  const { confirm, toast } = useFeedback()
  const [name, setName] = useState(label.name)
  const [error, setError] = useState<string | null>(null)
  const uses = data.tasks.filter((t) => (data.labelIdsByTask.get(t.id) ?? []).includes(label.id)).length
  const rename = async () => {
    if (name.trim() === label.name) return
    try {
      await repo.updateLabel(label.id, { name })
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  const remove = async () => {
    const ok = await confirm({
      title: `Delete the label “${label.name}”?`,
      message: uses > 0 ? `It will be removed from ${uses} task${uses === 1 ? '' : 's'}. The tasks themselves are kept.` : 'No tasks use this label.',
      confirmLabel: 'Delete label',
      danger: true,
    })
    if (ok) await repo.deleteLabel(label.id).catch((e) => toast('error', errorMessage(e)))
  }
  return (
    <li className="label-line">
      <input
        type="color"
        value={label.color}
        aria-label={`Color of label ${label.name}`}
        onChange={(e) => void repo.updateLabel(label.id, { color: e.target.value }).catch((err) => toast('error', errorMessage(err)))}
      />
      <input
        className="input"
        value={name}
        maxLength={LIMITS.labelName}
        aria-label={`Name of label ${label.name}`}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void rename()}
        onKeyDown={(e) => e.key === 'Enter' && void rename()}
      />
      <span className="muted small">
        {uses} task{uses === 1 ? '' : 's'}
      </span>
      <button type="button" className="icon-button icon-danger" aria-label={`Delete label ${label.name}`} onClick={() => void remove()}>
        <Icon name="trash" />
      </button>
      {error && <p className="field-error">{error}</p>}
    </li>
  )
}

function Labels({ data }: { data: AppData }) {
  const { repo } = useSession()
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLOR_SWATCHES[6]!)
  const [error, setError] = useState<string | null>(null)
  const add = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      await repo.createLabel({ name, color })
      setName('')
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  return (
    <div className="stack">
      <p className="muted">Renaming or recoloring a label updates every task that uses it. Deleting a label removes it from its tasks.</p>
      <ul className="label-list">
        {data.labels.map((label) => (
          <LabelLine key={label.id} label={label} data={data} />
        ))}
        {data.labels.length === 0 && <li className="muted">No labels.</li>}
      </ul>
      <form className="inline" onSubmit={add}>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="New label color" />
        <input className="input" placeholder="New label" aria-label="New label name" value={name} maxLength={LIMITS.labelName} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="button button-small" disabled={!name.trim()}>
          <Icon name="plus" /> Add label
        </button>
      </form>
      {error && <p className="field-error">{error}</p>}
    </div>
  )
}

function DashboardTab({ data }: { data: AppData }) {
  const { repo } = useSession()
  const { toast } = useFeedback()
  const set = (mode: LayoutMode) => void repo.setSetting('layout_mode', mode).catch((e) => toast('error', errorMessage(e)))
  return (
    <div className="stack">
      <fieldset className="fieldset">
        <legend>Card placement</legend>
        <label className="radio-card">
          <input type="radio" name="layout-mode" checked={data.settings.layout_mode === 'auto'} onChange={() => set('auto')} />
          <span>
            <strong>Arrange by group order</strong> — cards flow in group order. Dragging a card changes the order; Move Up / Move Down do the same.
          </span>
        </label>
        <label className="radio-card">
          <input type="radio" name="layout-mode" checked={data.settings.layout_mode === 'free'} onChange={() => set('free')} />
          <span>
            <strong>Free placement</strong> — cards stay where you drop them. Group order (Move Up / Move Down) is kept separately and is used for keyboard order and exports.
          </span>
        </label>
      </fieldset>
      <p className="muted small">Card sizes are kept in both modes. Resize a card by dragging its bottom-right corner, or with Wider / Narrower / Taller / Shorter in the card menu.</p>
    </div>
  )
}

export function SettingsDialog({ data, resolvedMode, onClose }: { data: AppData; resolvedMode: ResolvedMode; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('appearance')
  const tabs: Array<[Tab, string]> = [
    ['appearance', 'Appearance'],
    ['priorities', 'Priorities'],
    ['labels', 'Labels'],
    ['dashboard', 'Dashboard'],
  ]
  return (
    <Modal title="Settings" size="lg" onClose={onClose}>
      <div className="tabs" role="tablist" aria-label="Settings sections">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`} className={`tab ${tab === key ? 'tab-on' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-panel">
        {tab === 'appearance' && <Appearance data={data} resolvedMode={resolvedMode} />}
        {tab === 'priorities' && <Priorities data={data} />}
        {tab === 'labels' && <Labels data={data} />}
        {tab === 'dashboard' && <DashboardTab data={data} />}
      </div>
    </Modal>
  )
}
