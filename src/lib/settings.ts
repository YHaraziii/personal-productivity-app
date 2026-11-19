/**
 * User-level preferences. Each key is stored as its own row (and therefore
 * versioned, synchronized and conflict-checked independently), so changing
 * the theme can never overwrite the widget order, and so on.
 *
 * Group order, dashboard position, card size, collapsed state and task sort
 * preference live in their own columns on the group row for the same reason.
 */
import { WIDGET_KEYS, type WidgetKey } from './filters'
import { DEFAULT_THEME, THEME_COLOR_KEYS, THEME_PRESETS, isHexColor, type ThemeColors, type ThemeSetting } from './theme'
import { PRIORITIES, type Priority } from './types'

export type LayoutMode = 'auto' | 'free'

export interface SettingsShape {
  theme: ThemeSetting
  priority_colors: Record<Priority, string>
  widget_order: WidgetKey[]
  layout_mode: LayoutMode
  labels_seeded: boolean
}
export type SettingKey = keyof SettingsShape
export const SETTING_KEYS: readonly SettingKey[] = [
  'theme',
  'priority_colors',
  'widget_order',
  'layout_mode',
  'labels_seeded',
]

export const SETTING_LABEL: Record<SettingKey, string> = {
  theme: 'Theme',
  priority_colors: 'Priority colors',
  widget_order: 'Summary widget order',
  layout_mode: 'Dashboard layout mode',
  labels_seeded: 'Default labels',
}

export const DEFAULT_PRIORITY_COLORS: Record<Priority, string> = {
  low: '#3b82f6',
  medium: '#0d9488',
  high: '#ea580c',
  urgent: '#dc2626',
}

export const DEFAULT_SETTINGS: SettingsShape = {
  theme: DEFAULT_THEME,
  priority_colors: DEFAULT_PRIORITY_COLORS,
  widget_order: [...WIDGET_KEYS],
  layout_mode: 'auto',
  labels_seeded: false,
}

/** Default labels created once per account (the dashboard itself starts empty). */
export const DEFAULT_LABELS: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'Important', color: '#dc2626' },
  { name: 'Quick win', color: '#16a34a' },
  { name: 'Deep work', color: '#7c3aed' },
  { name: 'Waiting on', color: '#d97706' },
  { name: 'Follow-up', color: '#0284c7' },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseColors(value: unknown): Partial<ThemeColors> {
  const result: Partial<ThemeColors> = {}
  if (!isRecord(value)) return result
  for (const key of THEME_COLOR_KEYS) if (isHexColor(value[key])) result[key] = value[key]
  return result
}

/**
 * Validate a stored or imported setting value. Returns a clean value, or
 * undefined when the value is unusable (the caller then uses the default).
 * Settings are never trusted just because this app wrote them.
 */
export function parseSetting<K extends SettingKey>(key: K, value: unknown): SettingsShape[K] | undefined {
  const done = (v: SettingsShape[SettingKey]) => v as SettingsShape[K]
  switch (key) {
    case 'theme': {
      if (!isRecord(value)) return undefined
      const mode = value.mode === 'light' || value.mode === 'dark' || value.mode === 'system' ? value.mode : 'system'
      const preset = THEME_PRESETS.some((p) => p.id === value.preset) ? (value.preset as string) : DEFAULT_THEME.preset
      const custom = isRecord(value.custom) ? value.custom : {}
      return done({ mode, preset, custom: { light: parseColors(custom.light), dark: parseColors(custom.dark) } })
    }
    case 'priority_colors': {
      if (!isRecord(value)) return undefined
      const colors = { ...DEFAULT_PRIORITY_COLORS }
      for (const p of PRIORITIES) if (isHexColor(value[p])) colors[p] = value[p] as string
      return done(colors)
    }
    case 'widget_order': {
      if (!Array.isArray(value)) return undefined
      const seen = value.filter((v, i): v is WidgetKey => WIDGET_KEYS.includes(v) && value.indexOf(v) === i)
      // Tolerate missing entries: append any widget the stored order lacks.
      return done([...seen, ...WIDGET_KEYS.filter((k) => !seen.includes(k))])
    }
    case 'layout_mode':
      return value === 'auto' || value === 'free' ? done(value) : undefined
    case 'labels_seeded':
      return typeof value === 'boolean' ? done(value) : undefined
    default:
      return undefined
  }
}

export function isSettingKey(key: unknown): key is SettingKey {
  return typeof key === 'string' && (SETTING_KEYS as readonly string[]).includes(key)
}

/** Resolve all settings from stored rows, falling back to defaults. */
export function resolveSettings(rows: ReadonlyArray<{ key: string; value: unknown; deleted_at?: string | null }>): SettingsShape {
  const result: SettingsShape = { ...DEFAULT_SETTINGS }
  for (const row of rows) {
    if (row.deleted_at || !isSettingKey(row.key) || row.value == null) continue
    const parsed = parseSetting(row.key, row.value)
    if (parsed !== undefined) (result as unknown as Record<string, unknown>)[row.key] = parsed
  }
  return result
}
