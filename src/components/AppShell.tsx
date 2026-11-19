import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { deleteLocalData, useSession } from '../data/session'
import { useAppData, useEngineState, useSaveStatus } from '../hooks/useAppData'
import { useTheme } from '../hooks/useTheme'
import { formatTimestamp } from '../lib/dates'
import { Dashboard } from './Dashboard'
import { DataDialog } from './DataDialog'
import { useFeedback } from './Feedback'
import { Icon } from './Icon'
import { SaveIndicator } from './SaveIndicator'
import { SettingsDialog } from './SettingsDialog'
import { SyncPanel } from './SyncPanel'

type Panel = 'settings' | 'data' | 'sync' | null

export function AppShell({ email, verified }: { email: string; verified: boolean }) {
  const session = useSession()
  const { signOut } = useAuth()
  const { confirm } = useFeedback()
  const data = useAppData(session.db)
  const engineState = useEngineState(session.engine)
  const status = useSaveStatus(session.engine, data)
  const resolvedMode = useTheme(data?.settings.theme ?? { mode: 'system', preset: 'aurora', custom: { light: {}, dark: {} } })
  const [panel, setPanel] = useState<Panel>(null)

  const doSignOut = async () => {
    const unsynced = (await session.db.outbox.count()) > 0
    const ok = await confirm({
      title: 'Sign out?',
      message: unsynced ? (
        <>
          <p>
            <strong>This device has changes that are not saved on the server yet.</strong>
          </p>
          <p>They will stay on this device and sync the next time you sign in here. If you sign in on a different device instead, they will not be there.</p>
        </>
      ) : (
        <p>Your data is saved on the server. The copy stored on this device for offline use will be removed.</p>
      ),
      confirmLabel: 'Sign out',
    })
    if (!ok) return
    const userId = session.userId
    await signOut()
    if (!unsynced) await deleteLocalData(userId).catch(() => console.warn('[app] could not remove local data'))
  }

  const loading = !data || (!engineState.initialPullDone && data.groups.length === 0 && engineState.phase !== 'error' && engineState.online)

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to dashboard
      </a>
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ✓
          </span>
          <span className="brand-name">Dashboard</span>
        </div>
        <SaveIndicator status={status} onOpenIssues={() => setPanel('sync')} onRetry={() => void session.engine.retryFailed().then(() => session.engine.syncNow())} />
        <div className="header-actions">
          {engineState.lastSyncedAt && <span className="muted small last-sync">Last synced {formatTimestamp(engineState.lastSyncedAt)}</span>}
          <button type="button" className="button button-ghost" onClick={() => setPanel('data')}>
            <Icon name="download" /> Backup &amp; export
          </button>
          <button type="button" className="button button-ghost" onClick={() => setPanel('settings')}>
            <Icon name="settings" /> Settings
          </button>
          <span className="user-email" title={email}>
            {email}
          </span>
          <button type="button" className="button button-ghost" onClick={() => void doSignOut()}>
            <Icon name="logout" /> Sign out
          </button>
        </div>
      </header>
      {!verified && (
        <p className="banner banner-warning" role="status">
          You are offline, so your sign-in could not be checked. Your data from this device is shown and changes are saved here; they sync once you are back online and signed in.
        </p>
      )}
      {!engineState.initialPullDone && !engineState.online && data && data.groups.length === 0 && (
        <p className="banner banner-warning" role="status">
          You are offline and this device has not downloaded your data yet. Connect to the internet to load your dashboard.
        </p>
      )}
      {loading ? (
        <main className="center-page" id="main">
          <div className="spinner" aria-hidden="true" />
          <p role="status">Loading your dashboard…</p>
        </main>
      ) : engineState.phase === 'error' && !engineState.initialPullDone && data.groups.length === 0 ? (
        <main className="center-page" id="main">
          <h1>Could not load your dashboard</h1>
          <p role="alert">{engineState.lastError ?? 'The server could not be reached.'}</p>
          <button type="button" className="button button-primary" onClick={() => void session.engine.syncNow()}>
            Try again
          </button>
        </main>
      ) : (
        <Dashboard data={data} />
      )}
      {panel === 'settings' && data && <SettingsDialog data={data} resolvedMode={resolvedMode} onClose={() => setPanel(null)} />}
      {panel === 'data' && <DataDialog pending={data?.outbox.length ?? 0} onClose={() => setPanel(null)} />}
      {panel === 'sync' && data && <SyncPanel data={data} onClose={() => setPanel(null)} />}
    </div>
  )
}
