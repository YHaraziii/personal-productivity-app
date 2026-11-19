/**
 * Authorization tests against the real migrations (see tests/helpers/pg.ts).
 * These prove that privacy is enforced by the database, not by the UI.
 */
import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { newId, settingId, taskLabelId } from '../../src/lib/ids'
import { adminRows, asAnon, asUser, createTestDatabase, createUser, pgRemote } from '../helpers/pg'

const TABLES = ['groups', 'labels', 'recurrence_series', 'tasks', 'subtasks', 'task_labels', 'user_settings', 'applied_mutations']
const ALL_TABLES = [...TABLES, 'app_users']

let pg: PGlite
let alice: string
let bob: string
const ids = {
  group: newId(),
  label: newId(),
  series: newId(),
  task: newId(),
  subtask: newId(),
  taskLabel: '',
  setting: '',
}

async function seed(userId: string, x: typeof ids) {
  const remote = pgRemote(pg, userId)
  const results = await remote.push([
    { mutation_id: newId(), table: 'groups', op: 'insert', row_id: x.group, payload: { name: 'Private group', description: '', color: '#112233', icon: '📁', sort_index: 1, collapsed: false, grid_w: 4, grid_h: 8, sort_field: 'due', sort_dir: 'asc' } },
    { mutation_id: newId(), table: 'labels', op: 'insert', row_id: x.label, payload: { name: 'Secret', color: '#445566' } },
    { mutation_id: newId(), table: 'recurrence_series', op: 'insert', row_id: x.series, payload: { group_id: x.group, unit: 'week', interval_count: 1, anchor_date: '2026-10-27', title: 'Private recurring', description: '', priority: 'low', label_ids: [], subtasks: [] } },
    { mutation_id: newId(), table: 'tasks', op: 'insert', row_id: x.task, payload: { group_id: x.group, title: 'Private task', description: '', priority: 'high', manual_index: 1, series_id: x.series, occurrence_date: '2026-10-27', due_date: '2026-10-27' } },
    { mutation_id: newId(), table: 'subtasks', op: 'insert', row_id: x.subtask, payload: { task_id: x.task, text: 'Private step', completed: false, sort_index: 1 } },
    { mutation_id: newId(), table: 'task_labels', op: 'insert', row_id: x.taskLabel, payload: { task_id: x.task, label_id: x.label } },
    { mutation_id: newId(), table: 'user_settings', op: 'insert', row_id: x.setting, payload: { key: 'layout_mode', value: 'free' } },
  ])
  expect(results.map((r) => r.status)).toEqual(Array(7).fill('applied'))
}

beforeAll(async () => {
  pg = await createTestDatabase()
  alice = await createUser(pg)
  bob = await createUser(pg)
  ids.taskLabel = taskLabelId(ids.task, ids.label)
  ids.setting = settingId(alice, 'layout_mode')
  await seed(alice, ids)
})

describe('signed-out visitors (anon role)', () => {
  it.each(TABLES)('cannot read %s', async (table) => {
    await expect(asAnon(pg, (tx) => tx.query(`select * from public.${table}`))).rejects.toThrow(/permission denied/)
  })

  it.each(TABLES)('cannot write %s', async (table) => {
    await expect(asAnon(pg, (tx) => tx.query(`update public.${table} set user_id = user_id`))).rejects.toThrow(/permission denied/)
    await expect(asAnon(pg, (tx) => tx.query(`delete from public.${table}`))).rejects.toThrow(/permission denied/)
  })

  it('cannot read the account allowlist', async () => {
    await expect(asAnon(pg, (tx) => tx.query('select * from public.app_users'))).rejects.toThrow(/permission denied/)
  })

  it('cannot call the sync or import functions', async () => {
    await expect(asAnon(pg, (tx) => tx.query(`select public.sync_pull(null)`))).rejects.toThrow(/permission denied/)
    await expect(asAnon(pg, (tx) => tx.query(`select public.sync_push('[]'::jsonb)`))).rejects.toThrow(/permission denied/)
    await expect(asAnon(pg, (tx) => tx.query(`select public.import_backup('{}'::jsonb, 'merge')`))).rejects.toThrow(/permission denied/)
  })

  it('a request without a user id is rejected even with the authenticated role', async () => {
    await expect(
      pg.transaction(async (tx) => {
        await tx.exec('set local role authenticated')
        await tx.query(`select public.sync_pull(null)`)
      }),
    ).rejects.toThrow(/not authenticated/)
  })
})

describe('row level security between users', () => {
  it('has RLS enabled and forced on every table', async () => {
    const rows = await adminRows<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      pg,
      `select relname, relrowsecurity, relforcerowsecurity from pg_class
        where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname`,
    )
    expect(rows.map((r) => r.relname).sort()).toEqual([...ALL_TABLES].sort())
    for (const row of rows) {
      expect(row.relrowsecurity, row.relname).toBe(true)
      // app_users is only read by a SECURITY DEFINER function owned by the table owner.
      if (row.relname !== 'app_users') expect(row.relforcerowsecurity, row.relname).toBe(true)
    }
  })

  it.each(TABLES)('another user sees no rows in %s', async (table) => {
    const mine = await asUser(pg, alice, (tx) => tx.query(`select * from public.${table}`))
    expect(mine.rows.length).toBeGreaterThan(0)
    const theirs = await asUser(pg, bob, (tx) => tx.query(`select * from public.${table}`))
    expect(theirs.rows).toHaveLength(0)
  })

  it("another user's pull contains nothing of mine", async () => {
    const pulled = await pgRemote(pg, bob).pull(null)
    for (const rows of Object.values(pulled.tables)) expect(rows).toHaveLength(0)
    expect(JSON.stringify(pulled)).not.toContain('Private')
  })

  it("another user cannot update or soft-delete my rows directly", async () => {
    for (const [table, id] of [['groups', ids.group], ['tasks', ids.task], ['labels', ids.label], ['subtasks', ids.subtask], ['user_settings', ids.setting]] as const) {
      const res = await asUser(pg, bob, (tx) => tx.query(`update public.${table} set deleted_at = now() where id = $1`, [id]))
      expect(res.affectedRows, table).toBe(0)
    }
    const [task] = await adminRows<{ deleted_at: string | null; title: string }>(pg, 'select deleted_at, title from public.tasks where id = $1', [ids.task])
    expect(task).toEqual({ deleted_at: null, title: 'Private task' })
  })

  it('hard DELETE is not granted on data tables, even for the owner', async () => {
    await expect(asUser(pg, alice, (tx) => tx.query('delete from public.tasks where id = $1', [ids.task]))).rejects.toThrow(/permission denied/)
    await expect(asUser(pg, bob, (tx) => tx.query('delete from public.groups'))).rejects.toThrow(/permission denied/)
  })

  it("another user's sync mutations cannot touch my rows", async () => {
    const results = await pgRemote(pg, bob).push([
      { mutation_id: newId(), table: 'tasks', op: 'update', row_id: ids.task, base_version: 1, payload: { title: 'hacked' } },
      { mutation_id: newId(), table: 'tasks', op: 'delete', row_id: ids.task, base_version: 1 },
      { mutation_id: newId(), table: 'groups', op: 'delete', row_id: ids.group, base_version: 1 },
      // Re-using my ids for an insert must not overwrite or reveal my rows.
      { mutation_id: newId(), table: 'groups', op: 'insert', row_id: ids.group, payload: { name: 'mine now', description: '', color: '#000000', icon: 'x', sort_index: 1, collapsed: false, grid_w: 4, grid_h: 8, sort_field: 'due', sort_dir: 'asc' } },
      // A task of mine placed in someone else's group is refused by the composite foreign key.
      { mutation_id: newId(), table: 'tasks', op: 'insert', row_id: newId(), payload: { group_id: ids.group, title: 'intruder', description: '', priority: 'low', manual_index: 1 } },
    ])
    expect(results.map((r) => r.status)).toEqual(['missing', 'missing', 'missing', 'error', 'error'])
    expect(JSON.stringify(results)).not.toContain('Private')
    const [group] = await adminRows<{ name: string; user_id: string; deleted_at: string | null }>(pg, 'select name, user_id, deleted_at from public.groups where id = $1', [ids.group])
    expect(group).toEqual({ name: 'Private group', user_id: alice, deleted_at: null })
    expect(await adminRows(pg, `select 1 from public.tasks where title = 'intruder'`)).toHaveLength(0)
  })

  it('ownership cannot be reassigned', async () => {
    // Giving my row to another user fails the WITH CHECK policy / immutability trigger.
    await expect(asUser(pg, alice, (tx) => tx.query('update public.tasks set user_id = $1 where id = $2', [bob, ids.task]))).rejects.toThrow()
    // Inserting a row "as" another user is rewritten to the caller.
    const id = newId()
    await asUser(pg, bob, (tx) =>
      tx.query(`insert into public.labels (id, user_id, name, color) values ($1, $2, 'spoof', '#000000')`, [id, alice]),
    )
    const [label] = await adminRows<{ user_id: string }>(pg, 'select user_id from public.labels where id = $1', [id])
    expect(label!.user_id).toBe(bob)
    // The sync function ignores a user_id supplied in the payload.
    const gid = newId()
    await pgRemote(pg, bob).push([
      { mutation_id: newId(), table: 'groups', op: 'insert', row_id: gid, payload: { user_id: alice, name: 'spoof', description: '', color: '#000000', icon: 'x', sort_index: 1, collapsed: false, grid_w: 4, grid_h: 8, sort_field: 'due', sort_dir: 'asc' } },
    ])
    const [g] = await adminRows<{ user_id: string }>(pg, 'select user_id from public.groups where id = $1', [gid])
    expect(g!.user_id).toBe(bob)
  })

  it("an import can never write into or overwrite another user's data", async () => {
    const payload = {
      format: 'ppd-backup' as const,
      version: 1 as const,
      data: {
        groups: [{ id: ids.group, name: 'taken over', description: '', color: '#000000', icon: 'x', sort_index: 1, collapsed: false, grid_x: null, grid_y: null, grid_w: 4, grid_h: 8, sort_field: 'due' as const, sort_dir: 'asc' as const, created_at: new Date().toISOString() }],
        labels: [], recurrence_series: [], tasks: [], subtasks: [], task_labels: [], user_settings: [],
      },
    }
    for (const mode of ['replace', 'merge'] as const) {
      await expect(pgRemote(pg, bob).importBackup(payload, mode)).rejects.toThrow()
    }
    const [group] = await adminRows<{ name: string; user_id: string }>(pg, 'select name, user_id from public.groups where id = $1', [ids.group])
    expect(group).toEqual({ name: 'Private group', user_id: alice })
  })

  it('a replace import by one user leaves other users untouched', async () => {
    const empty = { format: 'ppd-backup' as const, version: 1 as const, data: { groups: [], labels: [], recurrence_series: [], tasks: [], subtasks: [], task_labels: [], user_settings: [] } }
    await pgRemote(pg, bob).importBackup(empty, 'replace')
    const rows = await adminRows(pg, 'select 1 from public.tasks where user_id = $1 and deleted_at is null', [alice])
    expect(rows).toHaveLength(1)
  })
})

describe('account allowlist (defense in depth against accidental open sign-up)', () => {
  it('a signed-in account that is not on the allowlist can neither read nor write, even its own rows', async () => {
    const stranger = await createUser(pg, undefined, false)
    await expect(pgRemote(pg, stranger).pull(null)).rejects.toThrow(/not enabled/)
    await expect(pgRemote(pg, stranger).push([])).rejects.toThrow(/not enabled/)
    // Bypassing the RPCs and using the tables directly is also refused by RLS.
    const id = newId()
    await expect(
      asUser(pg, stranger, (tx) => tx.query(`insert into public.labels (id, name, color) values ($1, 'x', '#000000')`, [id])),
    ).rejects.toThrow(/row-level security/)
    const res = await asUser(pg, stranger, (tx) => tx.query('select * from public.sync_pull_impl(null)'))
    expect(JSON.stringify(res.rows)).not.toContain('Private')
    for (const table of TABLES) {
      const rows = await asUser(pg, stranger, (tx) => tx.query(`select * from public.${table}`))
      expect(rows.rows, table).toHaveLength(0)
    }
  })

  it('users cannot add themselves to the allowlist or read it', async () => {
    const stranger = await createUser(pg, undefined, false)
    await expect(asUser(pg, stranger, (tx) => tx.query('insert into public.app_users (user_id) values ($1)', [stranger]))).rejects.toThrow(/permission denied/)
    await expect(asUser(pg, alice, (tx) => tx.query('select * from public.app_users'))).rejects.toThrow(/permission denied/)
  })
})

describe('integrity rules enforced by the database', () => {
  it('a task cannot be moved to another group', async () => {
    const other = newId()
    await pgRemote(pg, alice).push([
      { mutation_id: newId(), table: 'groups', op: 'insert', row_id: other, payload: { name: 'Other', description: '', color: '#112233', icon: '📁', sort_index: 2, collapsed: false, grid_w: 4, grid_h: 8, sort_field: 'due', sort_dir: 'asc' } },
    ])
    await expect(asUser(pg, alice, (tx) => tx.query('update public.tasks set group_id = $1 where id = $2', [other, ids.task]))).rejects.toThrow(/immutable/)
  })

  it('rejects invalid values (priority, due time without date, bad color)', async () => {
    const results = await pgRemote(pg, alice).push([
      { mutation_id: newId(), table: 'tasks', op: 'insert', row_id: newId(), payload: { group_id: ids.group, title: 'x', description: '', priority: 'critical', manual_index: 1 } },
      { mutation_id: newId(), table: 'tasks', op: 'insert', row_id: newId(), payload: { group_id: ids.group, title: 'x', description: '', priority: 'low', manual_index: 1, due_time: '10:00' } },
      { mutation_id: newId(), table: 'labels', op: 'insert', row_id: newId(), payload: { name: 'x', color: 'red' } },
      { mutation_id: newId(), table: 'tasks', op: 'insert', row_id: newId(), payload: { group_id: ids.group, title: '', description: '', priority: 'low', manual_index: 1 } },
    ])
    expect(results.map((r) => r.status)).toEqual(['error', 'error', 'error', 'error'])
  })

  it('deleting a user removes all of their data (foreign-key cascade)', async () => {
    const carol = await createUser(pg)
    const x = { ...ids, group: newId(), label: newId(), series: newId(), task: newId(), subtask: newId(), taskLabel: '', setting: settingId(carol, 'layout_mode') }
    x.taskLabel = taskLabelId(x.task, x.label)
    await seed(carol, x)
    await pg.query('delete from auth.users where id = $1', [carol])
    for (const table of ALL_TABLES) {
      expect(await adminRows(pg, `select 1 from public.${table} where user_id = $1`, [carol]), table).toHaveLength(0)
    }
  })
})
