/**
 * END-TO-END TEST BACKEND — never part of a production build.
 *
 * Loaded only when the app is built with VITE_E2E=true (see playwright.config.ts).
 * It runs the real SQL migrations in PGlite (PostgreSQL in WebAssembly) inside
 * the browser, so the UI is tested against the same schema, RLS policies and
 * sync functions that run on Supabase. Authentication is simulated: one test
 * user whose password is generated per test run.
 */
import { PGlite } from '@electric-sql/pglite'
import shim from '../../supabase/tests/auth_shim.sql?raw'
import type { AuthApi, AuthUser } from '../auth/authApi'
import type { ImportMode, ImportPayload, ImportSummary } from '../lib/backup'
import { RemoteError, type PullResult, type PushMutation, type PushResult, type Remote } from '../sync/engine'

const migrations = import.meta.glob('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const USER: AuthUser = { userId: '0e2e0e2e-0000-4000-8000-00000000e2e0', email: 'e2e-user@example.test' }
const SESSION_KEY = 'ppd.e2e.session'

async function openDatabase(): Promise<PGlite> {
  const db = new PGlite('idb://ppd-e2e-server')
  const { rows } = await db.query<{ ok: boolean }>(`select to_regclass('public.tasks') is not null as ok`)
  if (!rows[0]!.ok) {
    await db.exec(shim)
    for (const name of Object.keys(migrations).sort()) await db.exec(migrations[name]!)
    await db.query('insert into auth.users (id, email) values ($1, $2)', [USER.userId, USER.email])
    await db.query('insert into public.app_users (user_id) values ($1)', [USER.userId])
  }
  return db
}

export function createE2EBackend(): { auth: AuthApi; remote: Remote } {
  const dbPromise = openDatabase()
  // Lets e2e tests inspect the simulated server.
  ;(window as unknown as { __e2eServer: Promise<PGlite> }).__e2eServer = dbPromise
  const listeners = new Set<(u: AuthUser | null) => void>()
  const signedIn = () => localStorage.getItem(SESSION_KEY) === 'yes'

  const call = async <T>(sql: string, params: unknown[]): Promise<T> => {
    // Simulated network: the "server" is unreachable while the browser is offline.
    if (!navigator.onLine) throw new RemoteError('network', 'offline')
    if (!signedIn()) throw new RemoteError('auth', 'not authenticated')
    if ((window as unknown as { __e2eFailRequests?: boolean }).__e2eFailRequests) throw new RemoteError('network', 'simulated outage')
    const db = await dbPromise
    try {
      return await db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: USER.userId })])
        await tx.exec('set local role authenticated')
        const result = await tx.query<{ r: T }>(sql, params)
        return result.rows[0]!.r
      })
    } catch (error) {
      if (error instanceof RemoteError) throw error
      throw new RemoteError('server', error instanceof Error ? error.message : String(error))
    }
  }

  const remote: Remote = {
    push: (mutations: PushMutation[]) => call<PushResult[]>('select public.sync_push($1::jsonb) as r', [JSON.stringify(mutations)]),
    pull: (since: string | null) => call<PullResult>('select public.sync_pull($1::timestamptz) as r', [since]),
    importBackup: (payload: ImportPayload, mode: ImportMode) =>
      call<ImportSummary>('select public.import_backup($1::jsonb, $2) as r', [JSON.stringify(payload), mode]),
  }

  const auth: AuthApi = {
    async getSession() {
      if (!signedIn()) return { kind: 'signed_out' }
      return navigator.onLine ? { kind: 'signed_in', user: USER } : { kind: 'unreachable' }
    },
    async signIn(email, password) {
      if (!navigator.onLine) return { ok: false, message: 'Could not reach the sign-in service. Check your connection and try again.' }
      if (email !== USER.email || password !== import.meta.env.VITE_E2E_PASSWORD) {
        return { ok: false, message: 'The e-mail or password is incorrect.' }
      }
      localStorage.setItem(SESSION_KEY, 'yes')
      return { ok: true, user: USER }
    },
    async signOut() {
      localStorage.removeItem(SESSION_KEY)
      for (const l of listeners) l(null)
    },
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return { auth, remote }
}

export const E2E_USER = USER
