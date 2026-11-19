/** Theme presets, custom colors and contrast helpers. */
import { HEX_COLOR_RE } from './types'

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedMode = 'light' | 'dark'

export interface ThemeColors {
  accent: string
  background: string
  surface: string
  text: string
}
export const THEME_COLOR_KEYS: ReadonlyArray<keyof ThemeColors> = ['accent', 'background', 'surface', 'text']
export const THEME_COLOR_LABEL: Record<keyof ThemeColors, string> = {
  accent: 'Accent',
  background: 'Page background',
  surface: 'Card surface',
  text: 'Text',
}

export interface ThemePreset {
  id: string
  name: string
  light: ThemeColors
  dark: ThemeColors
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    light: { accent: '#4f46e5', background: '#f4f5fb', surface: '#ffffff', text: '#1c1f2e' },
    dark: { accent: '#8b93ff', background: '#10121d', surface: '#1a1d2e', text: '#e9eaf4' },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    light: { accent: '#c2255c', background: '#fdf5f2', surface: '#ffffff', text: '#2b1a1f' },
    dark: { accent: '#ff7a9c', background: '#1b1114', surface: '#291a1f', text: '#f7e9ed' },
  },
  {
    id: 'forest',
    name: 'Forest',
    light: { accent: '#15803d', background: '#f2f7f2', surface: '#ffffff', text: '#16241a' },
    dark: { accent: '#4ade80', background: '#0e1611', surface: '#17231b', text: '#e3f1e7' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    light: { accent: '#0b7285', background: '#f0f7f9', surface: '#ffffff', text: '#10242b' },
    dark: { accent: '#3bc9db', background: '#0b1519', surface: '#122128', text: '#e0f1f5' },
  },
  {
    id: 'grape',
    name: 'Grape',
    light: { accent: '#7c3aed', background: '#f7f4fd', surface: '#ffffff', text: '#221a33' },
    dark: { accent: '#b197fc', background: '#14101e', surface: '#1f192f', text: '#ece7f8' },
  },
  {
    id: 'slate',
    name: 'Slate',
    light: { accent: '#334155', background: '#f3f4f6', surface: '#ffffff', text: '#16191f' },
    dark: { accent: '#a3b1c6', background: '#0f1115', surface: '#191c22', text: '#e6e8ec' },
  },
]

export interface ThemeSetting {
  mode: ThemeMode
  preset: string
  custom: { light: Partial<ThemeColors>; dark: Partial<ThemeColors> }
}

export const DEFAULT_THEME: ThemeSetting = {
  mode: 'system',
  preset: 'aurora',
  custom: { light: {}, dark: {} },
}

export function resolveMode(mode: ThemeMode, systemPrefersDark: boolean): ResolvedMode {
  return mode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : mode
}

export function resolveColors(theme: ThemeSetting, mode: ResolvedMode): ThemeColors {
  const preset = THEME_PRESETS.find((p) => p.id === theme.preset) ?? THEME_PRESETS[0]!
  return { ...preset[mode], ...theme.custom[mode] }
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** WCAG contrast ratio between two #rrggbb colors (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Black or white, whichever is more readable on `background`. */
export function readableOn(background: string): string {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#111111') ? '#ffffff' : '#111111'
}

export interface ContrastWarning {
  message: string
}

/** Warn when a custom palette would make text hard to read (WCAG AA = 4.5:1). */
export function contrastWarnings(colors: ThemeColors): ContrastWarning[] {
  const warnings: ContrastWarning[] = []
  if (contrastRatio(colors.text, colors.surface) < 4.5) {
    warnings.push({ message: 'Text has low contrast against the card surface.' })
  }
  if (contrastRatio(colors.text, colors.background) < 4.5) {
    warnings.push({ message: 'Text has low contrast against the page background.' })
  }
  if (contrastRatio(colors.accent, colors.surface) < 3) {
    warnings.push({ message: 'The accent color is hard to see against the card surface.' })
  }
  return warnings
}

/** CSS custom properties for a resolved palette. Everything else in the
 *  stylesheet is derived from these with color-mix(). */
export function themeCssVariables(colors: ThemeColors, mode: ResolvedMode): Record<string, string> {
  return {
    '--accent': colors.accent,
    '--on-accent': readableOn(colors.accent),
    '--bg': colors.background,
    '--surface': colors.surface,
    '--text': colors.text,
    'color-scheme': mode,
  }
}

export function applyTheme(theme: ThemeSetting, systemPrefersDark: boolean, root: HTMLElement): ResolvedMode {
  const mode = resolveMode(theme.mode, systemPrefersDark)
  const vars = themeCssVariables(resolveColors(theme, mode), mode)
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
  root.dataset.theme = mode
  return mode
}

export const isHexColor = (value: unknown): value is string => typeof value === 'string' && HEX_COLOR_RE.test(value)
