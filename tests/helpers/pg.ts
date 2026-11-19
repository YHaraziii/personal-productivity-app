/**
 * Test database: the real SQL migrations applied to PGlite (PostgreSQL
 * compiled to WebAssembly, running in-process). Requests are executed exactly
 * as PostgREST would run them for a signed-in user: inside a transaction, as
 * the `authenticated` role, with the user id in request.jwt.claims. RLS,
 * grants, triggers and the RPC functions are therefore exercised for real.
 */
import { PGlite, type Transaction } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ImportMode, ImportPayload, ImportSummary } from '../../src/lib/backup'
import { newId } from '../../src/lib/ids'
import { RemoteError, type PullResult, type PushMutation, type PushResult, type Remote } from '../../src/sync/engine'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase')

export async function createTestDatabase(): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(readFileSync(join(root, 'tests', 'auth_shim.sql'), 'utf8'))
  for (const file of readdirSync(join(root, 'migrations')).sort()) {
    await db.exec(readFileSync(join(root, 'migrations', file), 'utf8'))
  }
  return db
}

/** Create an auth user. Like the real provisioning steps, the account is also
 *  added to the allowlist unless `allowed` is false. */
export async function createUser(db: PGlite, email = `${newId()}@example.test`, allowed = true): Promise<string> {
  const id = newId()
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email])
  if (allowed) await db.query('insert into public.app_users (user_id) values ($1)', [id])
  return id
}

/** Run `fn` as a signed-in user (role authenticated + JWT claims). */
export function asUser<T>(db: PGlite, userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })])
    await tx.exec('set local role authenticated')
    return fn(tx)
  }) as Promise<T>
}

/** Run `fn` as a signed-out visitor (role anon, no claims). */
export function asAnon<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec('set local role anon')
    return fn(tx)
  }) as Promise<T>
}

/** Unrestricted access (table owner), used only to inspect results. */
export async function adminRows<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows
}

export interface TestRemote extends Remote {
  /** Simulate being offline / the server being unreachable. */
  offline: boolean
  /** Fail the next N requests before they reach the server. */
  failNext: number
  /** Let the next N pushes reach the server but lose the response. */
  dropResponses: number
  pushCalls: PushMutation[][]
}

/** A Remote backed by the test database, acting as `userId`. */
export function pgRemote(db: PGlite, userId: string): TestRemote {
  const remote: TestRemote = {
    offline: false,
    failNext: 0,
    dropResponses: 0,
    pushCalls: [],
    async push(mutations: PushMutation[]): Promise<PushResult[]> {
      gate(remote)
      remote.pushCalls.push(mutations)
      const rows = await asUser(db, userId, (tx) =>
        tx.query<{ r: PushResult[] }>('select public.sync_push($1::jsonb) as r', [JSON.stringify(mutations)]),
      )
      if (remote.dropResponses > 0) {
        remote.dropResponses--
        throw new RemoteError('network', 'response lost')
      }
      return rows.rows[0]!.r
    },
    async pull(since: string | null): Promise<PullResult> {
      gate(remote)
      const rows = await asUser(db, userId, (tx) =>
        tx.query<{ r: PullResult }>('select public.sync_pull($1::timestamptz) as r', [since]),
      )
      return rows.rows[0]!.r
    },
    async importBackup(payload: ImportPayload, mode: ImportMode): Promise<ImportSummary> {
      gate(remote)
      try {
        const rows = await asUser(db, userId, (tx) =>
          tx.query<{ r: ImportSummary }>('select public.import_backup($1::jsonb, $2) as r', [JSON.stringify(payload), mode]),
        )
        return rows.rows[0]!.r
      } catch (error) {
        throw new RemoteError('server', error instanceof Error ? error.message : String(error))
      }
    },
  }
  return remote
}

function gate(remote: TestRemote): void {
  if (remote.offline) throw new RemoteError('network', 'offline')
  if (remote.failNext > 0) {
    remote.failNext--
    throw new RemoteError('network', 'simulated failure')
  }
}
