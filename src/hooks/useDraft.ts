/**
 * Preserve unsaved form input across reloads, crashes and connectivity
 * problems. Drafts live in sessionStorage per form key and are cleared once
 * the form is saved or deliberately discarded.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

const PREFIX = 'ppd.draft.'

export function readDraft<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function clearDraft(key: string): void {
  try {
    sessionStorage.removeItem(PREFIX + key)
  } catch {
    // ignore
  }
}

export function useDraft<T>(key: string, initial: () => T): [T, (update: T | ((prev: T) => T)) => void, boolean] {
  const restored = useRef<T | null>(readDraft<T>(key))
  const [value, setValue] = useState<T>(() => restored.current ?? initial())
  const dirty = useRef(false)
  useEffect(() => {
    if (!dirty.current) return
    try {
      sessionStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
      // Storage full or unavailable: the form still works, it just is not preserved.
    }
  }, [key, value])
  const set = useCallback((update: T | ((prev: T) => T)) => {
    dirty.current = true
    setValue(update)
  }, [])
  return [value, set, restored.current !== null]
}
