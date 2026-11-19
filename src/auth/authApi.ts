/**
 * Authentication boundary. The UI talks to this small interface; the real
 * implementation wraps Supabase Auth, tests use an in-memory fake.
 *
 * There is deliberately no sign-up and no password reset here: the single
 * account is created by the project owner in the Supabase dashboard, and
 * public registration is disabled in the project settings.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AuthUser {
  userId: string
  email: string
}

export type SessionLookup =
  | { kind: 'signed_in'; user: AuthUser }
  | { kind: 'signed_out' }
  /** The stored session could not be verified because the network is down. */
  | { kind: 'unreachable' }

export type SignInResult = { ok: true; user: AuthUser } | { ok: false; message: string }

export interface AuthApi {
  getSession(): Promise<SessionLookup>
  signIn(email: string, password: string): Promise<SignInResult>
  /** Removes the local session even when offline. */
  signOut(): Promise<void>
  /** Notifies when the session ends or changes outside of signIn/signOut. */
  onChange(listener: (user: AuthUser | null) => void): () => void
}

const isNetworkError = (error: { name?: string; status?: number; message?: string } | null | undefined) =>
  !!error &&
  (error.name === 'AuthRetryableFetchError' ||
    error.status === 0 ||
    /failed to fetch|network|load failed/i.test(error.message ?? ''))

export function supabaseAuthApi(client: SupabaseClient): AuthApi {
  const toUser = (user: { id: string; email?: string | null }): AuthUser => ({ userId: user.id, email: user.email ?? '' })
  return {
    async getSession() {
      try {
        const { data, error } = await client.auth.getSession()
        if (data.session?.user) return { kind: 'signed_in', user: toUser(data.session.user) }
        if (isNetworkError(error) || (typeof navigator !== 'undefined' && !navigator.onLine && error)) {
          return { kind: 'unreachable' }
        }
        return { kind: 'signed_out' }
      } catch (error) {
        return isNetworkError(error as Error) ? { kind: 'unreachable' } : { kind: 'signed_out' }
      }
    },
    async signIn(email, password) {
      try {
        const { data, error } = await client.auth.signInWithPassword({ email, password })
        if (error || !data.user) {
          if (isNetworkError(error)) {
            return { ok: false, message: 'Could not reach the sign-in service. Check your connection and try again.' }
          }
          if (error?.status === 429) {
            return { ok: false, message: 'Too many attempts. Wait a minute, then try again.' }
          }
          // Deliberately generic: never reveal whether the e-mail exists.
          return { ok: false, message: 'The e-mail or password is incorrect.' }
        }
        return { ok: true, user: toUser(data.user) }
      } catch {
        return { ok: false, message: 'Could not reach the sign-in service. Check your connection and try again.' }
      }
    },
    async signOut() {
      // scope 'local' removes this device's session without needing the network.
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) console.warn('[auth] sign-out reported an error; the local session was still removed')
    },
    onChange(listener) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') listener(null)
        else if ((event === 'SIGNED_IN' || event === 'USER_UPDATED') && session?.user) listener(toUser(session.user))
      })
      return () => data.subscription.unsubscribe()
    },
  }
}
