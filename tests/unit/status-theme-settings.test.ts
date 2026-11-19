import { describe, expect, it } from 'vitest'
import { deriveSaveStatus } from '../../src/lib/saveStatus'
import { DEFAULT_SETTINGS, parseSetting, resolveSettings } from '../../src/lib/settings'
import { THEME_PRESETS, applyTheme, contrastRatio, contrastWarnings, resolveColors } from '../../src/lib/theme'

const base = { online: true, phase: 'idle' as const, pending: 0, failed: 0, conflicts: 0, lastError: null }

describe('save status', () => {
  it('only says Saved when the server has confirmed everything', () => {
    expect(deriveSaveStatus(base).kind).toBe('saved')
    expect(deriveSaveStatus({ ...base, pending: 1 }).kind).toBe('pending')
    expect(deriveSaveStatus({ ...base, pending: 1, phase: 'syncing' }).label).toBe('Saving…')
    expect(deriveSaveStatus({ ...base, conflicts: 1 }).kind).toBe('conflict')
    expect(deriveSaveStatus({ ...base, failed: 1 }).label).toBe('Sync failed')
    expect(deriveSaveStatus({ ...base, pending: 2, phase: 'error', lastError: 'Could not reach the server.' }).detail).toMatch(/kept on this device/)
    expect(deriveSaveStatus({ ...base, online: false }).label).toBe('Offline')
    expect(deriveSaveStatus({ ...base, online: false, pending: 3 }).label).toBe('Offline · pending sync')
    for (const s of [{ pending: 1 }, { failed: 1 }, { conflicts: 1 }, { online: false, pending: 1 }, { phase: 'error' as const }]) {
      expect(deriveSaveStatus({ ...base, ...s }).kind).not.toBe('saved')
    }
  })
})

describe('themes', () => {
  it('every preset has readable text in light and dark mode', () => {
    for (const preset of THEME_PRESETS) {
      for (const mode of ['light', 'dark'] as const) {
        const c = preset[mode]
        expect(contrastRatio(c.text, c.surface), `${preset.id} ${mode}`).toBeGreaterThanOrEqual(7)
        expect(contrastWarnings(c), `${preset.id} ${mode}`).toEqual([])
      }
    }
  })

  it('custom colors override the preset per mode, and bad contrast is flagged', () => {
    const theme = { mode: 'dark' as const, preset: 'ocean', custom: { light: { accent: '#ff0000' }, dark: {} } }
    expect(resolveColors(theme, 'light').accent).toBe('#ff0000')
    expect(resolveColors(theme, 'dark').accent).toBe(THEME_PRESETS.find((p) => p.id === 'ocean')!.dark.accent)
    expect(contrastWarnings({ accent: '#ffffff', background: '#ffffff', surface: '#ffffff', text: '#eeeeee' }).length).toBeGreaterThan(0)
  })

  it('applies CSS variables and the resolved mode to the document', () => {
    const root = document.createElement('div')
    expect(applyTheme({ mode: 'system', preset: 'forest', custom: { light: {}, dark: {} } }, true, root)).toBe('dark')
    expect(root.dataset.theme).toBe('dark')
    expect(root.style.getPropertyValue('--accent')).toBe(THEME_PRESETS.find((p) => p.id === 'forest')!.dark.accent)
  })
})

describe('settings parsing', () => {
  it('validates values and falls back to defaults', () => {
    expect(parseSetting('layout_mode', 'grid')).toBeUndefined()
    expect(parseSetting('widget_order', ['upcoming', 'upcoming', 'bogus'])).toEqual(['upcoming', 'today', 'overdue'])
    expect(parseSetting('priority_colors', { urgent: '#000000', low: 'blue' })).toMatchObject({ urgent: '#000000', low: DEFAULT_SETTINGS.priority_colors.low })
    expect(parseSetting('theme', { mode: 'neon', preset: 'nope', custom: { light: { accent: 'javascript:' } } })).toEqual({ mode: 'system', preset: 'aurora', custom: { light: {}, dark: {} } })
    const resolved = resolveSettings([
      { key: 'layout_mode', value: 'free', deleted_at: null },
      { key: 'unknown', value: 1, deleted_at: null },
      { key: 'widget_order', value: null, deleted_at: null },
    ])
    expect(resolved.layout_mode).toBe('free')
    expect(resolved.widget_order).toEqual(DEFAULT_SETTINGS.widget_order)
  })
})
