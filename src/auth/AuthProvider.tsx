import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AuthApi, AuthUser, SignInResult } from './authApi'

/**
 * A marker (user id + e-mail, nothing secret) remembered on this device after
 * a successful sign-in. It lets the app open the local data when the stored
 * session cannot be verified because the device is offline. It is removed on
 * sign-out. Without a prior successful sign-in on this device there is no
 * marker and no local data, so nothing can be shown.
 */
const IDENTITY_KEY = 'ppd.identity'

function readIdentity(): AuthUser | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY)
    if (!raw) return null
    const value = JSON.parse(raw)
    return typeof value?.userId === 'string' && typeof value?.email === 'string' ? value : null
  } catch {
    return null
  }
}

function writeIdentity(user: AuthUser | null): void {
  try {
    if (user) localStorage.setItem(IDENTITY_KEY, JSON.stringify(user))
    else localStorage.removeItem(IDENTITY_KEY)
  } catch {
    // Storage unavailable (private mode): offline start will not be possible.
  }
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  /** `verified` is false when running from the remembered identity while offline. */
  | { status: 'signed_in'; user: AuthUser; verified: boolean }

interface AuthContextValue {
  state: AuthState
  signIn(email: string, password: string): Promise<SignInResult>
  signOut(): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ api, children }: { api: AuthApi; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    void api.getSession().then((lookup) => {
      if (cancelled) return
      if (lookup.kind === 'signed_in') {
        writeIdentity(lookup.user)
        setState({ status: 'signed_in', user: lookup.user, verified: true })
      } else if (lookup.kind === 'unreachable') {
        const remembered = readIdentity()
        setState(remembered ? { status: 'signed_in', user: remembered, verified: false } : { status: 'signed_out' })
      } else {
        setState({ status: 'signed_out' })
      }
    })
    const off = api.onChange((user) => {
      if (cancelled) return
      if (user) {
        writeIdentity(user)
        setState({ status: 'signed_in', user, verified: true })
      } else {
        // The session ended (expired or revoked). Local data is kept so that
        // unsynced changes are not lost; signing in again resumes syncing.
        setState({ status: 'signed_out' })
      }
    })
    return () => {
      cancelled = true
      off()
    }
  }, [api])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await api.signIn(email, password)
      if (result.ok) {
        writeIdentity(result.user)
        setState({ status: 'signed_in', user: result.user, verified: true })
      }
      return result
    },
    [api],
  )

  const signOut = useCallback(async () => {
    writeIdentity(null)
    await api.signOut()
    setState({ status: 'signed_out' })
  }, [api])

  const value = useMemo(() => ({ state, signIn, signOut }), [state, signIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
