import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, ConfigError } from './App'
import { supabaseAuthApi, type AuthApi } from './auth/authApi'
import { supabase, supabaseConfigError } from './supabaseClient'
import type { Remote } from './sync/engine'
import { SupabaseRemote } from './sync/supabaseRemote'
import './styles/app.css'

const root = createRoot(document.getElementById('root')!)

function render(auth: AuthApi, remote: Remote) {
  root.render(
    <StrictMode>
      <App auth={auth} remote={remote} />
    </StrictMode>,
  )
}

if (import.meta.env.VITE_E2E === 'true') {
  // Test builds only; this branch and its module are removed from production builds.
  void import('./testing/e2eBackend').then(({ createE2EBackend }) => {
    const { auth, remote } = createE2EBackend()
    render(auth, remote)
  })
} else if (!supabase) {
  root.render(<ConfigError message={supabaseConfigError ?? 'Unknown configuration problem.'} />)
} else {
  render(supabaseAuthApi(supabase), new SupabaseRemote(supabase))
}

// Ask the browser not to evict this site's storage under pressure, which
// protects changes that have not been synchronized yet.
void navigator.storage?.persist?.().catch(() => undefined)
