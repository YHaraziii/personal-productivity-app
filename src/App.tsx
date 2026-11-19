import { useMemo } from 'react'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { supabaseAuthApi, type AuthApi } from './auth/authApi'
import { AppShell } from './components/AppShell'
import { FeedbackProvider } from './components/Feedback'
import { SignIn } from './components/SignIn'
import { UpdateBanner } from './components/UpdateBanner'
import { SessionProvider } from './data/session'
import { cachedTheme, useTheme } from './hooks/useTheme'
import type { Remote } from './sync/engine'

function Loading({ text }: { text: string }) {
  return (
    <main className="center-page" id="main">
      <div className="spinner" aria-hidden="true" />
      <p role="status">{text}</p>
    </main>
  )
}

function Gate({ remote }: { remote: Remote }) {
  const { state } = useAuth()
  if (state.status === 'loading') return <Loading text="Checking your sign-in…" />
  // Every data route sits behind this check. The database independently
  // refuses all access without a valid session (Row Level Security).
  if (state.status === 'signed_out') return <SignIn />
  return (
    <SessionProvider userId={state.user.userId} remote={remote} fallback={<Loading text="Opening your data…" />}>
      <AppShell email={state.user.email} verified={state.verified} />
    </SessionProvider>
  )
}

function ThemedRoot({ children }: { children: React.ReactNode }) {
  useTheme(useMemo(cachedTheme, []))
  return <>{children}</>
}

export function App({ auth, remote }: { auth: AuthApi; remote: Remote }) {
  return (
    <ThemedRoot>
      <FeedbackProvider>
        <AuthProvider api={auth}>
          <Gate remote={remote} />
        </AuthProvider>
        <UpdateBanner />
      </FeedbackProvider>
    </ThemedRoot>
  )
}

export function ConfigError({ message }: { message: string }) {
  return (
    <main className="center-page" id="main">
      <h1>Configuration needed</h1>
      <p role="alert">{message}</p>
    </main>
  )
}

export { supabaseAuthApi }
