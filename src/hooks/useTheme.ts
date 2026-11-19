import { useEffect, useState } from 'react'
import { DEFAULT_THEME, applyTheme, type ResolvedMode, type ThemeSetting } from '../lib/theme'

const CACHE_KEY = 'ppd.theme'

function prefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

/** Last applied theme, cached so the sign-in screen and the first paint use it. */
export function cachedTheme(): ThemeSetting {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as ThemeSetting) : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function useTheme(theme: ThemeSetting): ResolvedMode {
  const [dark, setDark] = useState(prefersDark)
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query) return
    const onChange = () => setDark(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  const [mode, setMode] = useState<ResolvedMode>('light')
  useEffect(() => {
    setMode(applyTheme(theme, dark, document.documentElement))
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(theme))
    } catch {
      // ignore
    }
  }, [theme, dark])
  return mode
}
