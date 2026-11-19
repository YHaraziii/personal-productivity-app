import { useEffect, useState } from 'react'

/** Offers to load a new app version. Never reloads on its own, so an
 *  unsaved form is never thrown away by an update. */
export function UpdateBanner() {
  const [update, setUpdate] = useState<null | (() => Promise<void>)>(null)
  useEffect(() => {
    if (import.meta.env.DEV || !('serviceWorker' in navigator)) return
    let cancelled = false
    void import('virtual:pwa-register').then(({ registerSW }) => {
      if (cancelled) return
      const updateSW = registerSW({
        onNeedRefresh: () => setUpdate(() => () => updateSW(true)),
        onRegisterError: () => console.warn('[pwa] service worker registration failed; offline start is unavailable'),
      })
    })
    return () => {
      cancelled = true
    }
  }, [])
  if (!update) return null
  return (
    <div className="update-banner" role="status">
      A new version of the dashboard is available.
      <button type="button" className="button button-small button-primary" onClick={() => void update()}>
        Reload to update
      </button>
      <button type="button" className="button button-small" onClick={() => setUpdate(null)}>
        Later
      </button>
    </div>
  )
}
