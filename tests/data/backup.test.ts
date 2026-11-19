import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { exportBackup, exportCsv, importBackup, ImportBlockedError } from '../../src/data/backupIO'
import type { TaskDraft } from '../../src/data/repo'
import { describeImportSummary, parseBackupText, prepareImport, type Backup } from '../../src/lib/backup'
import { successorTaskId } from '../../src/lib/ids'
import { resolveSettings } from '../../src/lib/settings'
import { createDevice, live, type Device } from '../helpers/client'
import { adminRows, createTestDatabase, createUser } from '../helpers/pg'

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

const ctx = (d: Device) => ({ db: d.db, engine: d.engine, remote: d.remote, userId: d.repo.userId })

/** A device with a representative data set, fully synced. */
async function populated(email?: string) {
  const user = await createUser(pg, email)
  const a = await createDevice(pg, user)
  await a.sync()
  const school = await a.repo.createGroup({ name: 'School', description: 'Classes', color: '#ff0000', icon: '🎓' })
  const podcast = await a.repo.createGroup({ name: 'Podcast', description: '', color: '#00aa00', icon: '🎙️' })
  const urgent = await a.repo.createLabel({ name: 'Urgent stuff', color: '#aa0000' })
  const reading = await a.repo.createLabel({ name: 'Reading', color: '#0000aa' })
  const essay = await a.repo.createTask(
    draft(school, {
      title: 'Essay, "draft" one',
      description: '<p><strong>Bold</strong> text</p><ul><li>point</li></ul>',
      priority: 'urgent',
      due_date: '2026-10-27',
      due_time: '15:30',
      label_ids: [urgent, reading],
      subtasks: [{ text: 'Outline', completed: true }, { text: 'Write', completed: false }],
    }),
  )
  const weekly = await a.repo.createTask(draft(podcast, { title: 'Record episode', due_date: '2026-03-02', recurrence: { unit: 'week', interval_count: 2 }, label_ids: [reading] }))
  await a.repo.setTaskCompleted(weekly, true, new Date('2026-03-02T12:00:00'))
  const done = await a.repo.createTask(draft(school, { title: 'Done task' }))
  await a.repo.setTaskCompleted(done, true, new Date('2026-02-01T09:00:00Z'))
  await a.repo.setGroupLayouts([{ id: school, grid_x: 2, grid_y: 3, grid_w: 6, grid_h: 10 }])
  await a.repo.setGroupCollapsed(podcast, true)
  await a.repo.setGroupSort(school, 'priority', 'desc')
  await a.repo.setSetting('theme', { mode: 'dark', preset: 'ocean', custom: { light: { accent: '#123456' }, dark: {} } })
  await a.repo.setSetting('widget_order', ['upcoming', 'overdue', 'today'])
  await a.repo.setSetting('priority_colors', { low: '#010101', medium: '#020202', high: '#030303', urgent: '#040404' })
  const deleted = await a.repo.createTask(draft(school, { title: 'Deleted task' }))
  await a.repo.deleteTask(deleted)
  await a.sync()
  return { user, a, school, podcast, urgent, reading, essay, weekly, done }
}

const comparable = (b: Backup) => {
  const sortById = <T extends { id: string }>(rows: T[]) => [...rows].sort((x, y) => (x.id < y.id ? -1 : 1))
  const d = b.data
  // created_at precision differs between the client clock and the server; compare instants.
  const norm = <T extends { created_at: string }>(rows: T[]) => rows.map((r) => ({ ...r, created_at: new Date(r.created_at).getTime() }))
  return {
    groups: norm(sortById(d.groups)),
    labels: norm(sortById(d.labels)),
    series: norm(sortById(d.recurrence_series)).map((s) => ({ ...s, label_ids: [...s.label_ids].sort() })),
    tasks: norm(sortById(d.tasks)).map((t) => ({ ...t, completed_at: t.completed_at ? new Date(t.completed_at).getTime() : null })),
    subtasks: norm(sortById(d.subtasks)),
    task_labels: [...d.task_labels].sort((x, y) => (x.task_id + x.label_id < y.task_id + y.label_id ? -1 : 1)),
    // labels_seeded is bookkeeping that every import sets; it is not user data.
    settings: { ...d.settings, labels_seeded: undefined },
  }
}

describe('JSON export', () => {
  it('contains everything needed to rebuild the state, and no credentials', async () => {
    const { user, a, school, essay, weekly, done } = await populated('private.person@example.test')
    const backup = await exportBackup(a.db)
    expect(backup).toMatchObject({ format: 'ppd-backup', version: 1 })
    const d = backup.data
    expect(d.groups.map((g) => g.name)).toEqual(['School', 'Podcast']) // in group order
    expect(d.groups[0]).toMatchObject({ id: school, grid_x: 2, grid_y: 3, grid_w: 6, grid_h: 10, sort_field: 'priority', sort_dir: 'desc', collapsed: false, color: '#ff0000', icon: '🎓' })
    expect(d.groups[1]).toMatchObject({ collapsed: true })
    expect(d.tasks.map((t) => t.title).sort()).toEqual(['Done task', 'Essay, "draft" one', 'Record episode', 'Record episode'])
    expect(d.tasks.find((t) => t.id === essay)).toMatchObject({ due_date: '2026-10-27', due_time: '15:30:00', priority: 'urgent', description: '<p><strong>Bold</strong> text</p><ul><li>point</li></ul>' })
    expect(d.tasks.find((t) => t.id === done)!.completed_at).toBeTruthy()
    // Recurrence definition and occurrence history.
    expect(d.recurrence_series).toHaveLength(1)
    expect(d.recurrence_series[0]).toMatchObject({ unit: 'week', interval_count: 2, anchor_date: '2026-03-02' })
    expect(d.tasks.find((t) => t.id === weekly)).toMatchObject({ occurrence_date: '2026-03-02' })
    expect(d.tasks.find((t) => t.id === successorTaskId(weekly))).toMatchObject({ occurrence_date: '2026-03-16', completed_at: null })
    expect(d.subtasks.map((s) => s.text).sort()).toEqual(['Outline', 'Write'])
    expect(d.labels.map((l) => [l.name, l.color])).toEqual(expect.arrayContaining([['Urgent stuff', '#aa0000'], ['Reading', '#0000aa']]))
    expect(d.task_labels).toHaveLength(4)
    expect(d.settings).toMatchObject({ theme: { mode: 'dark', preset: 'ocean' }, widget_order: ['upcoming', 'overdue', 'today'], priority_colors: { urgent: '#040404' } })
    // Nothing about the account or session.
    const text = JSON.stringify(backup).toLowerCase()
    for (const secret of [user, 'private.person', 'user_id', 'password', 'token', 'apikey', 'service_role', 'session', 'email']) {
      expect(text, secret).not.toContain(secret.toLowerCase())
    }
    expect(text).not.toContain('deleted task')
  })

  it('round-trips: export, wipe with an empty replace, import, export again gives the same data', async () => {
    const { a } = await populated()
    const original = await exportBackup(a.db)
    const text = JSON.stringify(original)

    const empty: Backup = { ...original, data: { groups: [], labels: [], recurrence_series: [], tasks: [], subtasks: [], task_labels: [], settings: {} } }
    await importBackup(ctx(a), empty, 'replace')
    expect(live(await a.db.groups.toArray())).toHaveLength(0)
    expect(live(await a.db.tasks.toArray())).toHaveLength(0)

    const parsed = parseBackupText(text)
    if (!parsed.ok) throw new Error(parsed.errors.join('; '))
    const outcome = await importBackup(ctx(a), parsed.backup, 'replace')
    expect(outcome.summary.tables.tasks).toMatchObject({ restored: 4 })
    const restored = await exportBackup(a.db)
    expect(comparable(restored)).toEqual(comparable(original))
    expect(resolveSettings(await a.db.user_settings.toArray()).theme.preset).toBe('ocean')

    // A brand-new account restores the same backup from scratch.
    const other = await createDevice(pg, await createUser(pg))
    // (ids are globally unique, so the same backup cannot be loaded into two accounts of one project)
    await expect(importBackup(ctx(other), parsed.backup, 'replace')).rejects.toThrow(/not available to this account|permission|policy/i)
    expect(await other.db.groups.count()).toBe(0)
  })
})

describe('JSON import: replace', () => {
  it('replaces current data with the backup and a second device follows', async () => {
    const { user, a, school } = await populated()
    const backup = await exportBackup(a.db)
    const b = await createDevice(pg, user)
    await b.sync()
    // Diverge after the backup was taken.
    const extraGroup = await a.repo.createGroup({ name: 'Added later', description: '', color: '#123123', icon: '🆕' })
    const extraTask = await a.repo.createTask(draft(school, { title: 'Added later' }))
    await a.repo.updateGroup(school, { name: 'School (renamed later)' })
    await a.repo.setSetting('layout_mode', 'free')
    await a.sync()

    const outcome = await importBackup(ctx(a), backup, 'replace')
    expect(outcome.summary.tables.groups).toMatchObject({ removed: 1, updated: 2, added: 0 })
    expect(outcome.summary.tables.tasks).toMatchObject({ removed: 1 })
    expect(describeImportSummary(outcome.summary).join('\n')).toMatch(/Groups: 2 overwritten from the backup, 1 removed/)
    expect(live(await a.db.groups.toArray()).map((g) => g.name).sort()).toEqual(['Podcast', 'School'])
    expect((await a.db.groups.get(extraGroup))?.deleted_at ?? 'gone').not.toBeNull()
    expect(live(await a.db.tasks.toArray()).some((t) => t.id === extraTask)).toBe(false)
    expect(resolveSettings(await a.db.user_settings.toArray()).layout_mode).toBe('auto') // not in the backup -> default
    expect(comparable(await exportBackup(a.db))).toEqual(comparable(backup))
    await b.sync()
    expect(comparable(await exportBackup(b.db))).toEqual(comparable(backup))
  })

  it('is all-or-nothing: a failure part-way leaves the database exactly as it was', async () => {
    const { user, a } = await populated()
    const before = comparable(await exportBackup(a.db))
    const backup = await exportBackup(a.db)
    const prepared = prepareImport(backup, { userId: user, mode: 'replace', existingLabels: [] })
    // Corrupt a late record so the failure happens after earlier tables were written.
    prepared.payload.data.groups[0]!.name = 'Changed by failed import'
    prepared.payload.data.subtasks[0]!.text = ''
    await expect(a.remote.importBackup(prepared.payload, 'replace')).rejects.toThrow()
    await a.engine.requestFullPull()
    await a.sync()
    expect(comparable(await exportBackup(a.db))).toEqual(before)
    const names = await adminRows<{ name: string }>(pg, 'select name from public.groups where user_id = $1', [user])
    expect(names.map((n) => n.name)).not.toContain('Changed by failed import')
  })

  it('the database rejects structurally invalid payloads even if client validation is bypassed', async () => {
    const { user, a } = await populated()
    const base = prepareImport(await exportBackup(a.db), { userId: user, mode: 'merge', existingLabels: [] }).payload
    const variants: Array<[string, (p: typeof base) => void, RegExp]> = [
      ['unsupported version', (p) => ((p as { version: number }).version = 99), /Unsupported backup version/],
      ['wrong format', (p) => ((p as { format: string }).format = 'something-else'), /Not a Personal Productivity Dashboard backup/],
      ['duplicate ids', (p) => p.data.tasks.push({ ...p.data.tasks[0]! }), /Duplicate ids/],
      ['missing id', (p) => delete (p.data.groups[0] as { id?: string }).id, /has no id/],
      ['dangling group', (p) => (p.data.tasks[0]!.group_id = crypto.randomUUID()), /group that is not in the backup/],
      ['dangling task', (p) => (p.data.subtasks[0]!.task_id = crypto.randomUUID()), /task that is not in the backup/],
      ['bad priority', (p) => ((p.data.tasks[0] as { priority: string }).priority = 'extreme'), /check constraint/],
    ]
    for (const [name, mutate, message] of variants) {
      const payload = structuredClone(base)
      mutate(payload)
      await expect(a.remote.importBackup(payload, 'merge'), name).rejects.toThrow(message)
    }
    await expect(a.remote.importBackup(base, 'sideways' as never)).rejects.toThrow(/Invalid import mode/)
  })
})

describe('JSON import: merge', () => {
  it('adds what is missing, keeps existing records, restores deleted ones, and never duplicates', async () => {
    const { a, school, essay, weekly } = await populated()
    const backup = await exportBackup(a.db)
    // After the backup: edit one task, delete another, add a new one.
    await a.repo.updateTask(essay, draft(school, { title: 'Essay (edited after backup)' }))
    await a.repo.deleteTask(successorTaskId(weekly), 'this')
    const added = await a.repo.createTask(draft(school, { title: 'New since backup' }))
    await a.sync()

    const outcome = await importBackup(ctx(a), backup, 'merge')
    const tasks = live(await a.db.tasks.toArray())
    expect(tasks.find((t) => t.id === essay)!.title).toBe('Essay (edited after backup)') // existing wins
    expect(tasks.some((t) => t.id === added)).toBe(true) // not removed
    expect(tasks.some((t) => t.id === successorTaskId(weekly))).toBe(true) // restored
    expect(outcome.summary.tables.tasks).toMatchObject({ skipped: 3, restored: 1, added: 0 })
    expect(describeImportSummary(outcome.summary).join('\n')).toMatch(/Tasks: 1 previously deleted and restored, 3 already existed and kept/)

    // Importing the same file again changes nothing: no duplicate groups, tasks or occurrences.
    const countBefore = { groups: live(await a.db.groups.toArray()).length, tasks: tasks.length, series: live(await a.db.recurrence_series.toArray()).length }
    const again = await importBackup(ctx(a), backup, 'merge')
    expect(again.summary.tables.tasks).toMatchObject({ added: 0, restored: 0 })
    expect({ groups: live(await a.db.groups.toArray()).length, tasks: live(await a.db.tasks.toArray()).length, series: live(await a.db.recurrence_series.toArray()).length }).toEqual(countBefore)
  })

  it('merges a backup from elsewhere, mapping labels with the same name onto existing labels', async () => {
    const { a: source } = await populated()
    const backup = await exportBackup(source.db)
    const target = await createDevice(pg, await createUser(pg))
    await target.sync()
    const mine = await target.repo.createGroup({ name: 'Mine', description: '', color: '#000000', icon: '⭐' })
    const existingLabel = await target.repo.createLabel({ name: 'reading', color: '#ffffff' }) // same name, different case and id
    await target.sync()
    // Regenerate ids so the foreign backup does not collide with the source account's rows.
    const text = JSON.stringify(backup).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => id.slice(0, 35) + (id.endsWith('f') ? '0' : 'f'))
    const parsed = parseBackupText(text)
    if (!parsed.ok) throw new Error(parsed.errors.join('; '))
    const outcome = await importBackup(ctx(target), parsed.backup, 'merge')
    expect(outcome.notes.join(' ')).toMatch(/1 label\(s\) matched/)
    expect(live(await target.db.groups.toArray()).map((g) => g.name).sort()).toEqual(['Mine', 'Podcast', 'School'])
    const labels = live(await target.db.labels.toArray())
    expect(labels.filter((l) => l.name.toLowerCase() === 'reading')).toHaveLength(1)
    expect(labels.find((l) => l.id === existingLabel)).toMatchObject({ name: 'reading', color: '#ffffff' }) // mine is kept
    const linked = live(await target.db.task_labels.toArray()).filter((l) => l.label_id === existingLabel)
    expect(linked).toHaveLength(3) // essay + two recurring occurrences now use my label
    expect(live(await target.db.groups.toArray()).some((g) => g.id === mine)).toBe(true)
  })
})

describe('import safeguards', () => {
  it('refuses to import while offline or with unsynced changes, and changes nothing', async () => {
    const { a, school } = await populated()
    const backup = await exportBackup(a.db)
    a.online = false
    await expect(importBackup(ctx(a), backup, 'replace')).rejects.toBeInstanceOf(ImportBlockedError)
    a.online = true
    a.remote.failNext = 5
    await a.repo.createTask(draft(school, { title: 'Unsynced' }))
    await expect(importBackup(ctx(a), backup, 'replace')).rejects.toThrow(/not saved on the server yet/)
    expect(live(await a.db.tasks.toArray()).some((t) => t.title === 'Unsynced')).toBe(true)
    expect(await a.db.outbox.count()).toBeGreaterThan(0)
  })
})

describe('CSV export', () => {
  it('exports every task from every group in one file', async () => {
    const { a } = await populated()
    const csv = await exportCsv(a.db)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const lines = csv.slice(1).split('\r\n').filter(Boolean)
    expect(lines[0]).toBe('"Task ID","Title","Group","Description","Status","Due Date","Due Time","Priority","Labels","Created At","Completed At","Recurrence","Recurrence Series ID","Subtasks","Subtasks Completed","Subtasks Total"')
    expect(csv).toContain('"Essay, ""draft"" one","School","Bold text\n• point","Active","2026-10-27","15:30","Urgent","Reading; Urgent stuff"')
    expect(csv).toContain('"[x] Outline\n[ ] Write","1","2"')
    expect(csv).toContain('"Every 2 weeks on Monday"')
    expect(csv).toContain('"Done task","School","","Completed"')
    expect(csv.match(/"Record episode"/g)).toHaveLength(2)
    expect(csv).not.toContain('Deleted task')
  })
})
