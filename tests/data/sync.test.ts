import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import type { TaskDraft } from '../../src/data/repo'
import { deriveSaveStatus } from '../../src/lib/saveStatus'
import { resolveSettings } from '../../src/lib/settings'
import { createDevice, live, type Device } from '../helpers/client'
import { adminRows, asUser, createTestDatabase, createUser } from '../helpers/pg'

let pg: PGlite
beforeAll(async () => {
  pg = await createTestDatabase()
})

const draft = (group_id: string, over: Partial<TaskDraft> = {}): TaskDraft => ({
  group_id,
  title: 'Task',
  description: '',
  priority: 'medium',
  due_date: null,
  due_time: null,
  label_ids: [],
  subtasks: [],
  recurrence: null,
  ...over,
})

/** Two devices of one user, both holding one synced group and task. */
async function pair() {
  const user = await createUser(pg)
  const a = await createDevice(pg, user)
  const g = await a.repo.createGroup({ name: 'Work', description: '', color: '#3366ff', icon: '💼' })
  const t = await a.repo.createTask(draft(g, { title: 'Original', priority: 'low' }))
  await a.sync()
  const b = await createDevice(pg, user)
  await b.sync()
  return { user, a, b, g, t }
}

const serverTask = async (id: string) =>
  (await adminRows<Record<string, unknown>>(pg, 'select * from public.tasks where id = $1', [id]))[0]!

async function status(d: Device) {
  const entries = await d.db.outbox.toArray()
  const s = d.engine.getState()
  return deriveSaveStatus({
    online: d.online,
    phase: s.phase,
    lastError: s.lastError,
    pending: entries.filter((e) => e.status === 'pending' || e.status === 'inflight').length,
    failed: entries.filter((e) => e.status === 'error').length,
    conflicts: entries.filter((e) => e.status === 'conflict').length,
  }).kind
}

describe('offline editing', () => {
  it('creates, edits, completes, reopens and deletes while offline; everything survives a reload and syncs later', async () => {
    const { user, a, g, t } = await pair()
    a.online = false
    const created = await a.repo.createTask(draft(g, { title: 'Made offline', subtasks: [{ text: 'step', completed: false }] }))
    await a.repo.updateTask(t, draft(g, { title: 'Edited offline', priority: 'high' }))
    await a.repo.setTaskCompleted(t, true)
    await a.repo.setTaskCompleted(created, true)
    await a.repo.setTaskCompleted(created, false)
    const doomed = await a.repo.createTask(draft(g, { title: 'Deleted offline' }))
    await a.repo.deleteTask(doomed)
    await a.repo.updateGroup(g, { name: 'Work (renamed offline)' })
    await a.repo.setSetting('layout_mode', 'free')
    await a.sync() // offline: nothing is sent
    expect(a.remote.pushCalls).toHaveLength(1) // only the initial sync from pair()
    expect(await status(a)).toBe('offline')
    const queued = await a.db.outbox.count()
    expect(queued).toBeGreaterThan(0)

    // "Close the browser": the local data and the queue are still there.
    await a.reload()
    expect(await a.db.outbox.count()).toBe(queued)
    expect((await a.db.tasks.get(t))!.title).toBe('Edited offline')
    expect((await a.db.tasks.get(created))!.title).toBe('Made offline')
    expect((await serverTask(t)).title).toBe('Original') // server not touched yet
    expect(await status(a)).toBe('offline')

    // Connectivity returns.
    a.online = true
    await a.sync()
    expect(await a.db.outbox.count()).toBe(0)
    expect(await status(a)).toBe('saved')
    expect(await serverTask(t)).toMatchObject({ title: 'Edited offline', priority: 'high' })
    expect((await serverTask(t)).completed_at).not.toBeNull()
    expect(await serverTask(created)).toMatchObject({ title: 'Made offline', completed_at: null })
    expect((await serverTask(doomed)).deleted_at).not.toBeNull()
    const [grp] = await adminRows<{ name: string }>(pg, 'select name from public.groups where id = $1', [g])
    expect(grp!.name).toBe('Work (renamed offline)')
    const settings = await adminRows<{ value: unknown }>(pg, `select value from public.user_settings where user_id = $1 and key = 'layout_mode'`, [user])
    expect(settings[0]!.value).toBe('free')
  })

  it('folds repeated offline edits of one record into a single mutation', async () => {
    const { a, g, t } = await pair()
    a.online = false
    await a.repo.updateTask(t, draft(g, { title: 'One', priority: 'low' }))
    await a.repo.updateTask(t, draft(g, { title: 'Two', priority: 'low' }))
    await a.repo.updateTask(t, draft(g, { title: 'Three', priority: 'urgent' }))
    const entries = await a.db.outbox.toArray()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ op: 'update', payload: { title: 'Three', priority: 'urgent' }, base: { title: 'Original', priority: 'low' } })
    // Undoing an unsent edit leaves nothing to sync.
    await a.repo.updateTask(t, draft(g, { title: 'Original', priority: 'low' }))
    expect(await a.db.outbox.count()).toBe(0)
  })
})

describe('failures never lose changes', () => {
  it('keeps the queue when requests fail and delivers it once the server is reachable', async () => {
    const { a, g, t } = await pair()
    await a.repo.updateTask(t, draft(g, { title: 'Will arrive' }))
    a.remote.failNext = 3
    await a.sync()
    expect(a.engine.getState().phase).toBe('error')
    expect(await a.db.outbox.count()).toBe(1)
    expect((await a.db.outbox.toArray())[0]!.status).toBe('pending') // not stuck "in flight"
    expect(await status(a)).toBe('failed')
    expect((await a.db.tasks.get(t))!.title).toBe('Will arrive') // local edit intact
    await a.sync()
    await a.sync()
    await a.sync()
    expect(await a.db.outbox.count()).toBe(0)
    expect((await serverTask(t)).title).toBe('Will arrive')
    expect(await status(a)).toBe('saved')
  })

  it('a lost response is retried without applying the mutation twice', async () => {
    const { a, g, t } = await pair()
    await a.repo.updateTask(t, draft(g, { title: 'Once' }))
    await a.repo.createTask(draft(g, { title: 'Created once' }))
    a.remote.dropResponses = 1
    await a.sync() // server applied it, client never heard back
    expect(await a.db.outbox.count()).toBe(2)
    expect((await serverTask(t)).version).toBe(2)
    await a.sync() // retry: same mutation ids
    expect(await a.db.outbox.count()).toBe(0)
    expect(await serverTask(t)).toMatchObject({ title: 'Once', version: 2 }) // not bumped again
    const created = await adminRows(pg, `select 1 from public.tasks where title = 'Created once' and user_id = $1`, [a.repo.userId])
    expect(created).toHaveLength(1)
    expect((await a.db.tasks.get(t))!.version).toBe(2)
  })

  it('an interrupted push (page closed mid-request) is recovered on the next start', async () => {
    const { a, g, t } = await pair()
    await a.repo.updateTask(t, draft(g, { title: 'Interrupted' }))
    await a.db.outbox.toCollection().modify({ status: 'inflight' })
    await a.reload()
    expect((await a.db.outbox.toArray())[0]!.status).toBe('pending')
    await a.sync()
    expect((await serverTask(t)).title).toBe('Interrupted')
  })

  it('repeated synchronization sends nothing new', async () => {
    const { a, g } = await pair()
    await a.repo.createTask(draft(g, { title: 'Just once' }))
    await a.sync()
    const calls = a.remote.pushCalls.length
    await a.sync()
    await a.sync()
    expect(a.remote.pushCalls.length).toBe(calls)
    const rows = await adminRows(pg, `select 1 from public.tasks where title = 'Just once' and user_id = $1`, [a.repo.userId])
    expect(rows).toHaveLength(1)
  })

  it('keeps a mutation the server rejects, reports it, and lets the user discard it explicitly', async () => {
    const { a, g, t } = await pair()
    // Bypass client validation to simulate a server-side rejection.
    await a.db.transaction('rw', a.db.allTables, async () => {
      const task = (await a.db.tasks.get(t))!
      await a.db.tasks.put({ ...task, priority: 'bogus' as never })
      await a.db.outbox.add({ mutation_id: crypto.randomUUID(), table: 'tasks', op: 'update', row_id: t, payload: { priority: 'bogus' }, base: { priority: 'low' }, adopt: false, status: 'pending', attempts: 0, last_error: null, created_at: new Date().toISOString(), server_row: null, conflict_fields: [] })
    })
    await a.repo.createTask(draft(g, { title: 'Unrelated' })) // other work still syncs
    for (let i = 0; i < 4; i++) await a.sync()
    const entries = await a.db.outbox.toArray()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ status: 'error', attempts: 3 })
    expect(entries[0]!.last_error).toMatch(/not allowed/)
    expect(await status(a)).toBe('failed')
    expect((await serverTask(t)).priority).toBe('low')
    await a.engine.discardFailed(entries[0]!.seq!)
    await a.sync()
    expect(await a.db.outbox.count()).toBe(0)
    expect((await a.db.tasks.get(t))!.priority).toBe('low') // server state restored locally
    expect(await status(a)).toBe('saved')
  })
})

describe('merging without conflict', () => {
  it('merges edits to different fields of the same task', async () => {
    const { a, b, g, t } = await pair()
    await a.repo.updateTask(t, draft(g, { title: 'Title from A', priority: 'low' }))
    await a.sync()
    b.online = false
    await b.repo.updateTask(t, draft(g, { title: 'Original', priority: 'urgent' })) // B only changes priority
    b.online = true
    await b.sync()
    expect((await b.db.outbox.toArray()).filter((e) => e.status === 'conflict')).toHaveLength(0)
    expect(await serverTask(t)).toMatchObject({ title: 'Title from A', priority: 'urgent' })
    expect(await b.db.tasks.get(t)).toMatchObject({ title: 'Title from A', priority: 'urgent' })
  })

  it('a pull never overwrites an unsent local edit', async () => {
    const { a, b, g, t } = await pair()
    await a.repo.updateTask(t, draft(g, { title: 'Original', priority: 'high' }))
    await a.sync()
    await b.repo.updateTask(t, draft(g, { title: 'Local title', priority: 'low' }))
    b.remote.failNext = 1 // push fails...
    await b.sync()
    const entry = (await b.db.outbox.toArray())[0]!
    expect(entry.payload).toEqual({ title: 'Local title' })
    expect((await b.db.tasks.get(t))!.title).toBe('Local title')
    await b.sync()
    expect(await serverTask(t)).toMatchObject({ title: 'Local title', priority: 'high' })
    expect(await b.db.tasks.get(t)).toMatchObject({ title: 'Local title', priority: 'high' })
  })

  it('both devices completing the same task is not a conflict', async () => {
    const { a, b, t } = await pair()
    await a.repo.setTaskCompleted(t, true, new Date('2026-05-01T10:00:00Z'))
    await b.repo.setTaskCompleted(t, true, new Date('2026-05-01T10:05:00Z'))
    await a.sync()
    await b.sync()
    expect(await b.db.outbox.count()).toBe(0)
    expect(new Date((await serverTask(t)).completed_at as string).toISOString()).toBe('2026-05-01T10:00:00.000Z')
  })
})

describe('conflicts', () => {
  async function conflict() {
    const ctx = await pair()
    const { a, b, g, t } = ctx
    await a.repo.updateTask(t, draft(g, { title: 'Server title', priority: 'high' }))
    await a.sync()
    b.online = false
    await b.repo.updateTask(t, draft(g, { title: 'Local title', priority: 'low', due_date: '2026-09-09' }))
    b.online = true
    await b.sync()
    const parked = (await b.db.outbox.toArray()).filter((e) => e.status === 'conflict')
    return { ...ctx, parked }
  }

  it('detects an overlapping change, keeps both versions, and does not overwrite the server', async () => {
    const { b, t, parked } = await conflict()
    expect(parked).toHaveLength(1)
    const entry = parked[0]!
    expect(entry).toMatchObject({ table: 'tasks', row_id: t, conflict_fields: ['title'] })
    expect(entry.payload).toMatchObject({ title: 'Local title' }) // my version
    expect(entry.server_row).toMatchObject({ title: 'Server title', priority: 'high' }) // their version
    expect(await serverTask(t)).toMatchObject({ title: 'Server title', priority: 'high', due_date: null })
    expect((await b.db.tasks.get(t))!.title).toBe('Local title') // local edit still visible
    expect(await status(b)).toBe('conflict')
    // It stays parked across sync attempts and reloads until resolved.
    await b.sync()
    await b.reload()
    await b.sync()
    expect((await b.db.outbox.toArray()).filter((e) => e.status === 'conflict')).toHaveLength(1)
    expect((await serverTask(t)).title).toBe('Server title')
  })

  it('resolving with "keep mine" persists my version on the server', async () => {
    const { a, b, t, parked } = await conflict()
    await b.engine.resolveConflict(parked[0]!.seq!, 'local')
    await b.sync()
    expect(await b.db.outbox.count()).toBe(0)
    // Mine for the conflicting field, plus my non-conflicting change, plus their other change.
    expect(await serverTask(t)).toMatchObject({ title: 'Local title', priority: 'high' })
    expect(String((await serverTask(t)).due_date)).toContain('2026')
    await a.sync()
    expect(await a.db.tasks.get(t)).toMatchObject({ title: 'Local title', due_date: '2026-09-09' })
    expect(await status(b)).toBe('saved')
  })

  it('resolving with "keep theirs" persists the server version locally and still sends my other changes', async () => {
    const { b, t, parked } = await conflict()
    await b.engine.resolveConflict(parked[0]!.seq!, 'server')
    await b.sync()
    expect(await b.db.outbox.count()).toBe(0)
    expect(await b.db.tasks.get(t)).toMatchObject({ title: 'Server title', priority: 'high', due_date: '2026-09-09' })
    expect((await serverTask(t)).title).toBe('Server title')
  })

  it('supports a per-field decision', async () => {
    const { a, b, g, t } = await pair()
    await a.repo.updateTask(t, draft(g, { title: 'A title', priority: 'high' }))
    await a.sync()
    await b.repo.updateTask(t, draft(g, { title: 'B title', priority: 'urgent' }))
    await b.sync()
    const entry = (await b.db.outbox.toArray())[0]!
    expect(entry.conflict_fields.sort()).toEqual(['priority', 'title'])
    await b.engine.resolveConflict(entry.seq!, { title: 'local', priority: 'server' })
    await b.sync()
    expect(await serverTask(t)).toMatchObject({ title: 'B title', priority: 'high' })
    expect(await b.db.tasks.get(t)).toMatchObject({ title: 'B title', priority: 'high' })
  })

  it('raises a new conflict instead of overwriting when the server changes again before resolution lands', async () => {
    const { a, b, g, t, parked } = await conflict()
    await a.repo.updateTask(t, draft(g, { title: 'Server title v2', priority: 'high' }))
    await a.sync()
    await b.engine.resolveConflict(parked[0]!.seq!, 'local')
    await b.sync()
    const again = (await b.db.outbox.toArray()).filter((e) => e.status === 'conflict')
    expect(again).toHaveLength(1)
    expect(again[0]!.server_row).toMatchObject({ title: 'Server title v2' })
    expect((await serverTask(t)).title).toBe('Server title v2')
  })

  it('edit here vs delete there: can restore with my changes or accept the deletion', async () => {
    for (const choice of ['local', 'server'] as const) {
      const { a, b, g, t } = await pair()
      await a.repo.deleteTask(t)
      await a.sync()
      await b.repo.updateTask(t, draft(g, { title: 'Still needed' }))
      await b.sync()
      const entry = (await b.db.outbox.toArray())[0]!
      expect(entry).toMatchObject({ status: 'conflict' })
      expect(entry.conflict_fields).toContain('deleted_at')
      await b.engine.resolveConflict(entry.seq!, choice)
      await b.sync()
      expect(await b.db.outbox.count()).toBe(0)
      const row = await serverTask(t)
      if (choice === 'local') expect(row).toMatchObject({ title: 'Still needed', deleted_at: null })
      else expect(row.deleted_at).not.toBeNull()
      expect(!!(await b.db.tasks.get(t))!.deleted_at).toBe(choice === 'server')
    }
  })

  it('delete here vs edit there: can delete anyway or keep the edited task', async () => {
    for (const choice of ['local', 'server'] as const) {
      const { a, b, g, t } = await pair()
      await a.repo.updateTask(t, draft(g, { title: 'Edited elsewhere', subtasks: [{ text: 'new step', completed: false }] }))
      await a.sync()
      await b.repo.deleteTask(t)
      await b.sync()
      const entry = (await b.db.outbox.toArray())[0]!
      expect(entry).toMatchObject({ status: 'conflict', op: 'delete' })
      expect((await serverTask(t)).deleted_at).toBeNull() // not deleted behind the user's back
      await b.engine.resolveConflict(entry.seq!, choice)
      await b.sync()
      expect(await b.db.outbox.count()).toBe(0)
      if (choice === 'local') expect((await serverTask(t)).deleted_at).not.toBeNull()
      else {
        expect(await b.db.tasks.get(t)).toMatchObject({ title: 'Edited elsewhere', deleted_at: null })
        expect(live(await b.db.subtasks.where('task_id').equals(t).toArray()).map((s) => s.text)).toEqual(['new step'])
      }
    }
  })

  it('detects conflicting settings changes', async () => {
    const { a, b } = await pair()
    await a.repo.setSetting('layout_mode', 'free')
    await a.sync()
    await b.sync()
    await a.repo.setSetting('widget_order', ['overdue', 'today', 'upcoming'])
    await a.sync()
    b.online = false
    await b.repo.setSetting('widget_order', ['upcoming', 'overdue', 'today'])
    b.online = true
    await b.sync()
    const entry = (await b.db.outbox.toArray())[0]!
    expect(entry).toMatchObject({ status: 'conflict', table: 'user_settings', conflict_fields: ['value'] })
    await b.engine.resolveConflict(entry.seq!, 'local')
    await b.sync()
    await a.sync()
    expect(resolveSettings(await a.db.user_settings.toArray()).widget_order).toEqual(['upcoming', 'overdue', 'today'])
  })

  it('a change made directly on the server while a local edit is queued is surfaced on pull', async () => {
    const { user, b, g, t } = await pair()
    await b.repo.updateTask(t, draft(g, { title: 'Mine' }))
    await asUser(pg, user, (tx) => tx.query(`update public.tasks set title = 'Theirs' where id = $1`, [t]))
    b.remote.failNext = 1
    await b.sync() // push fails, nothing pulled
    await b.sync()
    const entry = (await b.db.outbox.toArray())[0]!
    expect(entry).toMatchObject({ status: 'conflict', conflict_fields: ['title'] })
    expect((await serverTask(t)).title).toBe('Theirs')
  })
})
