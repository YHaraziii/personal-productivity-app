/**
 * Synchronization engine.
 *
 * push  Sends the outbox to the server in order. Every mutation carries a
 *       stable mutation_id (the server ignores one it has already applied) and
 *       the row version it was based on (the server refuses to apply it over a
 *       newer row and returns that row instead).
 * pull  Fetches rows changed since the last pull and merges them into the
 *       local database without discarding unsent local edits.
 *
 * Conflict rule: a local edit conflicts with a server change only when both
 * changed the SAME column to DIFFERENT values. Edits to different columns of
 * one row are merged automatically. A real conflict is never resolved by
 * timestamp: the mutation is parked with both versions until the user decides.
 */
import { valuesEqual } from '../lib/compare'
import type { ImportMode, ImportPayload, ImportSummary } from '../lib/backup'
import { TABLES, type AnyRow, type TableName } from '../lib/types'
import type { AppDB, OutboxEntry } from '../data/db'

export interface PushMutation {
  mutation_id: string
  table: TableName
  op: 'insert' | 'update' | 'delete'
  row_id: string
  base_version?: number
  payload?: Record<string, unknown>
}

export type PushStatus = 'applied' | 'duplicate' | 'exists' | 'conflict' | 'missing' | 'error'

export interface PushResult {
  mutation_id: string
  status: PushStatus
  row?: Record<string, unknown> | null
  message?: string
  code?: string
}

export interface PullResult {
  next_since: string
  tables: Partial<Record<TableName, Array<Record<string, unknown>>>>
}

export type RemoteErrorKind = 'network' | 'auth' | 'server'

export class RemoteError extends Error {
  constructor(
    readonly kind: RemoteErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'RemoteError'
  }
}

/** The server API the engine needs. Implemented with Supabase RPCs in the
 *  app and with an in-process PostgreSQL in the automated tests. */
export interface Remote {
  push(mutations: PushMutation[]): Promise<PushResult[]>
  pull(since: string | null): Promise<PullResult>
  importBackup(payload: ImportPayload, mode: ImportMode): Promise<ImportSummary>
}

export interface EngineState {
  phase: 'idle' | 'syncing' | 'error'
  online: boolean
  lastError: string | null
  lastSyncedAt: string | null
  initialPullDone: boolean
}

export type Resolution = 'local' | 'server' | Record<string, 'local' | 'server'>

export const MAX_ATTEMPTS = 3
const BATCH_SIZE = 200
const MAX_ROUNDS = 12
const META_SINCE = 'pull_since'
const META_INITIAL = 'initial_pull_done'
const META_LAST_SYNC = 'last_synced_at'

type Row = Record<string, unknown>

const rowKey = (table: string, id: string) => `${table}:${id}`

const STATE_FIELDS = new Set(['deleted_at', 'completed_at', 'ended_at'])

/** "Deleted", "completed" and "ended" are compared as states (set or not set):
 *  two devices completing the same task a minute apart agree with each other,
 *  and the exact instant is not a meaningful conflict. */
function same(field: string, a: unknown, b: unknown): boolean {
  if (STATE_FIELDS.has(field)) return (a == null) === (b == null)
  return valuesEqual(field, a, b)
}

function friendlyServerError(code: string | undefined, message: string | undefined): string {
  switch (code) {
    case '23514':
      return 'The server rejected this change because a value is not allowed.'
    case '23503':
      return 'The server rejected this change because it refers to an item that no longer exists.'
    case '23505':
      return 'The server rejected this change because the item already exists.'
    case '23502':
      return 'The server rejected this change because a required value is missing.'
    case '42501':
      return 'The server did not permit this change.'
    default:
      return `The server rejected this change${message ? `: ${message.slice(0, 200)}` : '.'}`
  }
}

export interface EngineEnv {
  isOnline: () => boolean
}

const browserEnv: EngineEnv = {
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
}

export class SyncEngine {
  private state: EngineState = {
    phase: 'idle',
    online: true,
    lastError: null,
    lastSyncedAt: null,
    initialPullDone: false,
  }
  private listeners = new Set<() => void>()
  private running: Promise<void> | null = null
  private rerun = false
  private debounce: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private retryDelay = 2000
  private stopped = false
  private detach: Array<() => void> = []

  constructor(
    private readonly db: AppDB,
    private readonly remote: Remote,
    private readonly env: EngineEnv = browserEnv,
  ) {
    this.state.online = env.isOnline()
  }

  // ------------------------------------------------------------- lifecycle

  getState = (): EngineState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setState(patch: Partial<EngineState>) {
    const next = { ...this.state, ...patch }
    const changed = (Object.keys(next) as Array<keyof EngineState>).some((k) => next[k] !== this.state[k])
    if (!changed) return
    this.state = next
    for (const listener of this.listeners) listener()
  }

  /** Load persisted sync state and recover from an interrupted push. */
  async init(): Promise<void> {
    // A request that was in flight when the page closed may or may not have
    // reached the server. Re-sending is safe: mutation ids make it idempotent.
    await this.db.outbox.where('status').equals('inflight').modify({ status: 'pending' })
    this.setState({
      initialPullDone: (await this.db.getMeta<boolean>(META_INITIAL)) === true,
      lastSyncedAt: (await this.db.getMeta<string>(META_LAST_SYNC)) ?? null,
      online: this.env.isOnline(),
    })
  }

  /** Start automatic synchronization (browser only). */
  async start(): Promise<void> {
    await this.init()
    this.stopped = false
    if (typeof window !== 'undefined') {
      const onOnline = () => {
        this.setState({ online: true })
        this.requestSync(0)
      }
      const onOffline = () => this.setState({ online: false })
      const onVisible = () => {
        if (document.visibilityState === 'visible') this.requestSync(0)
      }
      window.addEventListener('online', onOnline)
      window.addEventListener('offline', onOffline)
      document.addEventListener('visibilitychange', onVisible)
      this.detach.push(
        () => window.removeEventListener('online', onOnline),
        () => window.removeEventListener('offline', onOffline),
        () => document.removeEventListener('visibilitychange', onVisible),
      )
      this.interval = setInterval(() => this.requestSync(0), 60_000)
    }
    void this.syncNow()
  }

  stop(): void {
    this.stopped = true
    for (const off of this.detach) off()
    this.detach = []
    if (this.interval) clearInterval(this.interval)
    if (this.debounce) clearTimeout(this.debounce)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.interval = this.debounce = this.retryTimer = null
  }

  /** Ask for a sync soon. Calls made close together are coalesced. */
  requestSync(delayMs = 400): void {
    if (this.stopped) return
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      this.debounce = null
      void this.syncNow()
    }, delayMs)
  }

  /** Run a full push + pull cycle now. Never rejects; inspect getState(). */
  syncNow(): Promise<void> {
    if (this.running) {
      this.rerun = true
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false
          await this.cycle()
        } while (this.rerun && !this.stopped)
      } finally {
        this.running = null
      }
    })()
    return this.running
  }

  private async cycle(): Promise<void> {
    const online = this.env.isOnline()
    if (!online) {
      this.setState({ online: false, phase: 'idle' })
      return
    }
    this.setState({ online: true, phase: 'syncing' })
    try {
      await this.pushAll()
      await this.pull()
      const now = new Date().toISOString()
      await this.db.setMeta(META_LAST_SYNC, now)
      this.retryDelay = 2000
      this.setState({ phase: 'idle', lastError: null, lastSyncedAt: now })
    } catch (error) {
      const kind = error instanceof RemoteError ? error.kind : 'server'
      // Diagnostic only: never log row contents, credentials or tokens.
      console.warn(`[sync] cycle failed (${kind})`)
      const message =
        kind === 'network'
          ? 'Could not reach the server.'
          : kind === 'auth'
            ? 'The server did not accept this session (it may have expired, or the account is not enabled). Sign out and sign in again to continue syncing; your changes stay on this device.'
            : 'The server reported a problem while syncing.'
      this.setState({ phase: 'error', lastError: message })
      if (kind !== 'auth' && !this.stopped && typeof window !== 'undefined') {
        if (this.retryTimer) clearTimeout(this.retryTimer)
        this.retryTimer = setTimeout(() => void this.syncNow(), this.retryDelay)
        this.retryDelay = Math.min(this.retryDelay * 2, 60_000)
      }
    }
  }

  // ------------------------------------------------------------------ push

  private async nextBatch(): Promise<OutboxEntry[]> {
    const entries = await this.db.outbox.orderBy('seq').toArray()
    // A row with an unresolved conflict or a rejected mutation is held back
    // entirely, so later edits to it are never applied out of order.
    const blocked = new Set<string>()
    const batch: OutboxEntry[] = []
    for (const entry of entries) {
      const key = rowKey(entry.table, entry.row_id)
      if (entry.status === 'conflict' || (entry.status === 'error' && entry.attempts >= MAX_ATTEMPTS)) {
        blocked.add(key)
        continue
      }
      if (blocked.has(key)) continue
      batch.push(entry)
      if (batch.length >= BATCH_SIZE) break
    }
    return batch
  }

  private async pushAll(): Promise<void> {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const batch = await this.nextBatch()
      if (batch.length === 0) return
      const mutations: PushMutation[] = []
      for (const entry of batch) {
        const mutation: PushMutation = {
          mutation_id: entry.mutation_id,
          table: entry.table,
          op: entry.op,
          row_id: entry.row_id,
        }
        if (entry.op === 'insert') mutation.payload = entry.payload
        else {
          const local = await this.db.rows(entry.table).get(entry.row_id)
          mutation.base_version = local?.version ?? 0
          if (entry.op === 'update') mutation.payload = entry.payload
        }
        mutations.push(mutation)
      }
      const seqs = batch.map((e) => e.seq!)
      await this.db.outbox.where('seq').anyOf(seqs).modify({ status: 'inflight' })
      let results: PushResult[]
      try {
        results = await this.remote.push(mutations)
        if (!Array.isArray(results) || results.length !== mutations.length) {
          throw new RemoteError('server', 'Unexpected response from the server')
        }
      } catch (error) {
        // Nothing is lost: the mutations go back to "pending" and are re-sent.
        await this.db.outbox
          .where('seq')
          .anyOf(seqs)
          .modify((e) => {
            if (e.status === 'inflight') e.status = 'pending'
          })
        throw error
      }
      const progress = await this.db.transaction('rw', this.db.allTables, () => this.applyResults(batch, results))
      if (!progress) return
    }
  }

  private async applyResults(batch: OutboxEntry[], results: PushResult[]): Promise<boolean> {
    let progress = false
    for (const [i, sent] of batch.entries()) {
      const result = results[i]!
      const entry = await this.db.outbox.get(sent.seq!)
      if (!entry || entry.status !== 'inflight') continue // already folded into a conflict
      const server = (result.row ?? null) as Row | null
      switch (result.status) {
        case 'applied':
          // The server applied this on top of exactly the version we knew, so
          // its row is our known state plus this change: adopt it and keep any
          // newer queued edits on top.
          await this.db.outbox.delete(entry.seq!)
          if (server) await this.overlay(entry.table, server)
          progress = true
          break
        case 'duplicate':
          // Already applied by an earlier attempt. The row returned is the
          // current one and may contain newer changes, so merge it carefully.
          await this.db.outbox.delete(entry.seq!)
          if (server) await this.integrate(entry.table, server)
          progress = true
          break
        case 'exists':
          if (server && (await this.handleExists(entry, server))) progress = true
          break
        case 'conflict':
          if (server && (await this.handleConflict(entry, server))) progress = true
          break
        case 'missing':
          await this.db.outbox.update(entry.seq!, {
            status: 'error',
            attempts: MAX_ATTEMPTS,
            last_error: 'This item no longer exists on the server.',
          })
          break
        default:
          await this.db.outbox.update(entry.seq!, {
            status: 'error',
            attempts: entry.attempts + 1,
            last_error: friendlyServerError(result.code, result.message),
          })
      }
    }
    return progress
  }

  /** An insert found the id already on the server. */
  private async handleExists(entry: OutboxEntry, server: Row): Promise<boolean> {
    const diff = Object.keys(entry.payload).filter(
      (key) => key !== 'created_at' && !valuesEqual(key, server[key], entry.payload[key]),
    )
    const serverDeleted = server.deleted_at != null
    if (entry.adopt || (diff.length === 0 && !serverDeleted)) {
      // Every device derives this record identically (or it is identical):
      // the server's copy is the record.
      await this.db.outbox.delete(entry.seq!)
      await this.integrate(entry.table, server)
      return true
    }
    const local = await this.db.rows(entry.table).get(entry.row_id)
    if (diff.length === 0) {
      // Same content, but the server's copy was deleted: this insert means
      // "it should exist", so turn it into a restore.
      await this.db.outbox.update(entry.seq!, {
        op: 'update',
        payload: { deleted_at: null },
        base: { deleted_at: server.deleted_at },
        status: 'pending',
      })
      if (local) await this.db.rows(entry.table).put({ ...local, version: server.version as number })
      return true
    }
    // Same id, different content: keep both and let the user decide.
    const payload: Row = {}
    for (const key of diff) payload[key] = entry.payload[key]
    await this.db.outbox.update(entry.seq!, {
      op: 'update',
      payload,
      base: {},
      status: 'conflict',
      server_row: server,
      conflict_fields: serverDeleted ? [...diff, 'deleted_at'] : diff,
    })
    return false
  }

  /** The server refused an update/delete because the row's version moved on. */
  private async handleConflict(entry: OutboxEntry, server: Row): Promise<boolean> {
    const local = (await this.db.rows(entry.table).get(entry.row_id)) as Row | undefined
    if (!local) {
      await this.db.outbox.delete(entry.seq!)
      await this.integrate(entry.table, server)
      return true
    }
    if (local.version === server.version) {
      // Not a real conflict: an earlier mutation in the same request advanced
      // the version. Send again with the version we now know.
      await this.db.outbox.update(entry.seq!, { status: 'pending' })
      return true
    }
    if (entry.op === 'delete') {
      // Deleted here, changed on the server since: the user must choose.
      await this.db.outbox.update(entry.seq!, { status: 'conflict', server_row: server, conflict_fields: [] })
      return false
    }
    const overlap = Object.keys(entry.payload).filter(
      (key) => !same(key, server[key], entry.base[key]) && !same(key, server[key], entry.payload[key]),
    )
    const serverDeleted = server.deleted_at != null && !('deleted_at' in entry.payload)
    if (overlap.length === 0 && !serverDeleted) {
      // The server changed other columns only (or already holds the same
      // value): rebase onto its row and re-send what is still different.
      const payload: Row = {}
      const base: Row = {}
      for (const key of Object.keys(entry.payload)) {
        if (same(key, server[key], entry.payload[key])) continue
        payload[key] = entry.payload[key]
        base[key] = server[key] ?? null
      }
      if (Object.keys(payload).length === 0) {
        await this.db.outbox.delete(entry.seq!)
        await this.integrate(entry.table, server)
      } else {
        await this.db.outbox.update(entry.seq!, { status: 'pending', payload, base })
        await this.overlay(entry.table, server)
      }
      return true
    }
    await this.db.outbox.update(entry.seq!, {
      status: 'conflict',
      server_row: server,
      conflict_fields: serverDeleted ? [...overlap, 'deleted_at'] : overlap,
    })
    return false
  }

  /** Local row := server row + every queued local change on top. */
  private async overlay(table: TableName, server: Row): Promise<void> {
    const id = server.id as string
    const local = (await this.db.rows(table).get(id)) as Row | undefined
    const entries = await this.db.outbox.where('[table+row_id]').equals([table, id]).sortBy('seq')
    const next: Row = { ...server }
    for (const entry of entries) {
      if (entry.op === 'delete') next.deleted_at = (local?.deleted_at as string | null) ?? new Date().toISOString()
      else Object.assign(next, entry.payload)
    }
    await this.db.rows(table).put(next as unknown as AnyRow)
  }

  /**
   * Merge a row received from the server (push response or pull) into the
   * local database while respecting queued local changes.
   */
  private async integrate(table: TableName, server: Row, known?: OutboxEntry[]): Promise<void> {
    const id = server.id as string
    const entries = known ?? (await this.db.outbox.where('[table+row_id]').equals([table, id]).sortBy('seq'))
    if (entries.length === 0) {
      await this.db.rows(table).put(server as unknown as AnyRow)
      return
    }
    const local = (await this.db.rows(table).get(id)) as Row | undefined
    if (local && local.version === server.version) return // nothing new from the server

    // A queued insert or delete is settled when it is pushed (the server
    // answers 'exists' / 'conflict' and that path decides).
    if (entries.some((e) => e.op === 'insert' || e.op === 'delete')) return

    const parked = entries.find((e) => e.status === 'conflict')
    const first = parked ?? entries[0]!
    const firstBase: Row = {}
    const finalPatch: Row = {}
    for (const entry of entries) {
      for (const key of Object.keys(entry.payload)) {
        if (!(key in firstBase)) firstBase[key] = entry.base[key] ?? null
        finalPatch[key] = entry.payload[key]
      }
    }
    const overlap = Object.keys(finalPatch).filter(
      (key) => !same(key, server[key], firstBase[key]) && !same(key, server[key], finalPatch[key]),
    )
    const serverDeleted = server.deleted_at != null && !('deleted_at' in finalPatch)

    if (overlap.length === 0 && !serverDeleted && !parked) {
      // No overlap: take the server's row, keep local edits on top, and move
      // the comparison baseline of the queued edits to this server state.
      await this.db.rows(table).put({ ...server, ...finalPatch } as unknown as AnyRow)
      for (const entry of entries) {
        const base: Row = { ...entry.base }
        for (const key of Object.keys(entry.payload)) base[key] = server[key] ?? null
        await this.db.outbox.update(entry.seq!, { base })
      }
      return
    }
    // Overlap: fold every queued edit of this row into one parked conflict
    // that carries both versions. The local row keeps showing the local values.
    const fields = parked && overlap.length === 0 && !serverDeleted ? parked.conflict_fields : overlap
    await this.db.outbox.update(first.seq!, {
      payload: finalPatch,
      base: firstBase,
      status: 'conflict',
      server_row: server,
      conflict_fields: serverDeleted && !fields.includes('deleted_at') ? [...fields, 'deleted_at'] : fields,
    })
    for (const entry of entries) if (entry.seq !== first.seq) await this.db.outbox.delete(entry.seq!)
  }

  // ------------------------------------------------------------------ pull

  private async pull(): Promise<void> {
    const since = (await this.db.getMeta<string | null>(META_SINCE)) ?? null
    const result = await this.remote.pull(since)
    if (!result || typeof result.next_since !== 'string' || typeof result.tables !== 'object') {
      throw new RemoteError('server', 'Unexpected response from the server')
    }
    await this.db.transaction('rw', this.db.allTables, async () => {
      const queued = new Map<string, OutboxEntry[]>()
      for (const entry of await this.db.outbox.orderBy('seq').toArray()) {
        const key = rowKey(entry.table, entry.row_id)
        queued.set(key, [...(queued.get(key) ?? []), entry])
      }
      for (const table of TABLES) {
        const rows = result.tables[table] ?? []
        const plain: AnyRow[] = []
        for (const row of rows) {
          const entries = queued.get(rowKey(table, row.id as string))
          if (entries) await this.integrate(table, row, entries)
          else plain.push(row as unknown as AnyRow)
        }
        if (plain.length > 0) await this.db.rows(table).bulkPut(plain)
        if (since === null) {
          // A full pull is authoritative: drop local rows the server does not
          // have, unless a queued local change still refers to them.
          const serverIds = new Set(rows.map((r) => r.id as string))
          const stale = (await this.db.rows(table).toCollection().primaryKeys()).filter(
            (id) => !serverIds.has(id) && !queued.has(rowKey(table, id)),
          )
          if (stale.length > 0) await this.db.rows(table).bulkDelete(stale)
        }
      }
      await this.db.setMeta(META_SINCE, result.next_since)
      await this.db.setMeta(META_INITIAL, true)
    })
    this.setState({ initialPullDone: true })
  }

  /** Discard the pull cursor so the next sync re-downloads everything. */
  async requestFullPull(): Promise<void> {
    await this.db.setMeta(META_SINCE, null)
  }

  // ------------------------------------------------- conflicts and failures

  /**
   * Resolve a parked conflict.
   *  'local'  keep my version (it is re-sent on top of the server's row)
   *  'server' keep the server's version (my conflicting change is dropped)
   *  {field}  choose per overlapping field
   * The outcome is then pushed like any other change; if the server row has
   * changed yet again, a new conflict is raised rather than overwriting it.
   */
  async resolveConflict(seq: number, resolution: Resolution): Promise<void> {
    let fullPull = false
    await this.db.transaction('rw', this.db.allTables, async () => {
      const entry = await this.db.outbox.get(seq)
      if (!entry || entry.status !== 'conflict' || !entry.server_row) return
      const server = entry.server_row
      const table = entry.table
      const local = (await this.db.rows(table).get(entry.row_id)) as Row | undefined
      const choose = (field: string) => (typeof resolution === 'string' ? resolution : (resolution[field] ?? 'local'))
      const cleared = { status: 'pending' as const, server_row: null, conflict_fields: [], attempts: 0, last_error: null }

      if (entry.op === 'delete') {
        if (choose('deleted_at') === 'server') {
          await this.db.outbox.delete(seq)
          await this.db.rows(table).put(server as unknown as AnyRow)
          fullPull = true // children hidden by the local delete must come back
        } else {
          if (local) await this.db.rows(table).put({ ...local, version: server.version } as unknown as AnyRow)
          await this.db.outbox.update(seq, cleared)
        }
        return
      }

      const serverDeleted = server.deleted_at != null
      if (serverDeleted && choose('deleted_at') === 'server') {
        // Accept the deletion: every queued edit of this row is moot.
        await this.db.outbox.where('[table+row_id]').equals([table, entry.row_id]).delete()
        await this.db.rows(table).put(server as unknown as AnyRow)
        return
      }
      const payload: Row = {}
      for (const key of Object.keys(entry.payload)) {
        if (!entry.conflict_fields.includes(key) || choose(key) === 'local') payload[key] = entry.payload[key]
      }
      if (serverDeleted) payload.deleted_at = null // keep mine = restore it
      if (Object.keys(payload).length === 0) {
        await this.db.outbox.delete(seq)
        await this.integrate(table, server)
        return
      }
      const base: Row = {}
      for (const key of Object.keys(payload)) base[key] = server[key] ?? null
      await this.db.outbox.update(seq, { ...cleared, payload, base })
      await this.overlay(table, server)
    })
    if (fullPull) await this.requestFullPull()
    this.requestSync(0)
  }

  /** Give every rejected mutation a fresh set of attempts. */
  async retryFailed(): Promise<void> {
    await this.db.outbox
      .where('status')
      .equals('error')
      .modify({ status: 'pending', attempts: 0, last_error: null })
    this.requestSync(0)
  }

  /**
   * Permanently drop a rejected mutation. Only ever called from an explicit,
   * confirmed user action; the affected data is then re-read from the server.
   */
  async discardFailed(seq: number): Promise<void> {
    await this.db.transaction('rw', this.db.allTables, async () => {
      const entry = await this.db.outbox.get(seq)
      if (!entry || entry.status !== 'error') return
      await this.db.outbox.delete(seq)
      if (entry.op === 'insert') {
        const others = await this.db.outbox.where('[table+row_id]').equals([entry.table, entry.row_id]).count()
        if (others === 0) await this.db.rows(entry.table).delete(entry.row_id)
      }
      await this.db.setMeta(META_SINCE, null)
    })
    this.requestSync(0)
  }
}
