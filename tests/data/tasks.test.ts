import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { ValidationError, type TaskDraft } from '../../src/data/repo'
import { sortTasks } from '../../src/lib/sorting'
import { resolveSettings } from '../../src/lib/settings'
import { createDevice, live, type Device } from '../helpers/client'
import { adminRows, createTestDatabase, createUser } from '../helpers/pg'

let pg: PGlite
beforeAll(async () => {
  pg = await createTestDatabase()
})

async function setup(): Promise<{ user: string; a: Device }> {
  const user = await createUser(pg)
  return { user, a: await createDevice(pg, user) }
}

const draft = (group_id: string, over: Partial<TaskDraft> = {}): TaskDraft => ({
  group_id,
  title: 'Write report',
  description: '<p>Notes</p>',
  priority: 'medium',
  due_date: null,
  due_time: null,
  label_ids: [],
  subtasks: [],
  recurrence: null,
  ...over,
})

const group = (d: Device, name = 'School') => d.repo.createGroup({ name, description: '', color: '#3366ff', icon: '🎓' })

describe('groups', () => {
  it('starts empty: no groups or tasks are created automatically', async () => {
    const { a } = await setup()
    await a.sync()
    await a.repo.seedDefaultLabels()
    await a.sync()
    expect(await a.db.groups.count()).toBe(0)
    expect(await a.db.tasks.count()).toBe(0)
    expect(live(await a.db.labels.toArray()).length).toBeGreaterThan(0) // default labels only
  })

  it('creates, edits and persists a group; new groups sort by due date ascending', async () => {
    const { user, a } = await setup()
    const id = await group(a)
    await a.repo.updateGroup(id, { name: 'University', description: 'Fall term', color: '#aa00aa', icon: '📚' })
    await a.sync()
    const [row] = await adminRows<Record<string, unknown>>(pg, 'select * from public.groups where id = $1', [id])
    expect(row).toMatchObject({ user_id: user, name: 'University', description: 'Fall term', color: '#aa00aa', icon: '📚', sort_field: 'due', sort_dir: 'asc', collapsed: false })
    await expect(a.repo.updateGroup(id, { name: '   ' })).rejects.toBeInstanceOf(ValidationError)
  })

  it('deleting a group deletes its tasks, checklists, labels links and series, locally and on the server', async () => {
    const { a } = await setup()
    const keep = await group(a, 'Keep')
    const gone = await group(a, 'Gone')
    const label = await a.repo.createLabel({ name: 'L', color: '#123456' })
    const kept = await a.repo.createTask(draft(keep, { label_ids: [label], subtasks: [{ text: 'k', completed: false }] }))
    await a.repo.createTask(draft(gone, { label_ids: [label], subtasks: [{ text: 's1', completed: false }], due_date: '2026-10-27', recurrence: { unit: 'day', interval_count: 1 } }))
    await a.sync()
    await a.repo.deleteGroup(gone)
    // Locally, immediately:
    expect(live(await a.db.tasks.toArray()).map((t) => t.id)).toEqual([kept])
    expect(live(await a.db.subtasks.toArray())).toHaveLength(1)
    expect(live(await a.db.task_labels.toArray())).toHaveLength(1)
    expect(live(await a.db.recurrence_series.toArray())).toHaveLength(0)
    await a.sync()
    // On the server, via the tombstone cascade:
    for (const [table, expected] of [['groups', 1], ['tasks', 1], ['subtasks', 1], ['task_labels', 1], ['recurrence_series', 0]] as const) {
      const rows = await adminRows(pg, `select 1 from public.${table} where user_id = $1 and deleted_at is null`, [a.repo.userId])
      expect(rows, table).toHaveLength(expected)
    }
    expect(await a.db.outbox.count()).toBe(0)
    // A second device sees the same result.
    const b = await createDevice(pg, a.repo.userId)
    await b.sync()
    expect(live(await b.db.tasks.toArray()).map((t) => t.id)).toEqual([kept])
  })

  it('keeps group order, position, size, collapsed state and task sort as independent settings', async () => {
    const { a } = await setup()
    const g1 = await group(a, 'One')
    const g2 = await group(a, 'Two')
    const g3 = await group(a, 'Three')
    const t1 = await a.repo.createTask(draft(g1, { title: 'b' }))
    const t2 = await a.repo.createTask(draft(g1, { title: 'a' }))
    await a.sync()
    const before = (await a.db.groups.get(g1))!

    await a.repo.setGroupLayouts([{ id: g1, grid_w: 6, grid_h: 12 }])
    let now = (await a.db.groups.get(g1))!
    expect(now).toMatchObject({ grid_w: 6, grid_h: 12, grid_x: before.grid_x, grid_y: before.grid_y, sort_index: before.sort_index, sort_field: before.sort_field, collapsed: before.collapsed })

    await a.repo.setGroupLayouts([{ id: g1, grid_x: 3, grid_y: 5 }])
    now = (await a.db.groups.get(g1))!
    expect(now).toMatchObject({ grid_x: 3, grid_y: 5, grid_w: 6, grid_h: 12, sort_index: before.sort_index })

    await a.repo.setGroupCollapsed(g1, true)
    await a.repo.setGroupSort(g1, 'title', 'desc')
    await a.repo.moveGroup(g3, -1)
    await a.repo.reorderTasks(g1, [t2, t1])
    now = (await a.db.groups.get(g1))!
    expect(now).toMatchObject({ grid_x: 3, grid_y: 5, grid_w: 6, grid_h: 12, collapsed: true, sort_field: 'title', sort_dir: 'desc', sort_index: before.sort_index })

    // Group order changed (One, Three, Two); task order within the group is separate.
    const order = live(await a.db.groups.toArray()).sort((x, y) => x.sort_index - y.sort_index).map((g) => g.name)
    expect(order).toEqual(['One', 'Three', 'Two'])

    // Everything survives a reload and reaches another device.
    await a.sync()
    await a.reload()
    expect(await a.db.groups.get(g1)).toMatchObject({ grid_x: 3, grid_y: 5, grid_w: 6, grid_h: 12, collapsed: true, sort_field: 'title', sort_dir: 'desc' })
    const b = await createDevice(pg, a.repo.userId)
    await b.sync()
    expect(await b.db.groups.get(g1)).toMatchObject({ grid_x: 3, grid_y: 5, grid_w: 6, grid_h: 12, collapsed: true, sort_field: 'title', sort_dir: 'desc' })
    expect(live(await b.db.groups.toArray()).sort((x, y) => x.sort_index - y.sort_index).map((g) => g.name)).toEqual(['One', 'Three', 'Two'])
    expect(g2).toBeTruthy()
  })

  it('clamps card sizes to sensible limits', async () => {
    const { a } = await setup()
    const g = await group(a)
    await a.repo.setGroupLayouts([{ id: g, grid_w: 99, grid_h: 1, grid_x: 50 }])
    expect(await a.db.groups.get(g)).toMatchObject({ grid_w: 12, grid_h: 4, grid_x: 0 })
  })

  it('expand all / collapse all set each group state consistently', async () => {
    const { a } = await setup()
    const g1 = await group(a, 'One')
    const g2 = await group(a, 'Two')
    await a.repo.setGroupCollapsed(g1, true)
    await a.repo.setAllCollapsed(true)
    expect((await a.db.groups.bulkGet([g1, g2])).map((g) => g!.collapsed)).toEqual([true, true])
    await a.repo.setAllCollapsed(false)
    await a.repo.setGroupCollapsed(g2, true)
    await a.sync()
    await a.reload()
    expect((await a.db.groups.bulkGet([g1, g2])).map((g) => g!.collapsed)).toEqual([false, true])
  })
})

describe('tasks', () => {
  it('creates a task with every field and stores it on the server', async () => {
    const { a } = await setup()
    const g = await group(a)
    const l1 = await a.repo.createLabel({ name: 'Essay', color: '#ff8800' })
    const l2 = await a.repo.createLabel({ name: 'Exam', color: '#0088ff' })
    const id = await a.repo.createTask(
      draft(g, {
        title: '  Final paper ',
        description: '<p><strong>Bold</strong> and <a href="https://example.com">link</a></p>',
        priority: 'urgent',
        due_date: '2026-10-27',
        due_time: '15:30',
        label_ids: [l1, l2],
        subtasks: [{ text: 'Outline', completed: true }, { text: 'Draft', completed: false }],
      }),
    )
    await a.sync()
    const [task] = await adminRows<Record<string, unknown>>(pg, 'select * from public.tasks where id = $1', [id])
    expect(task).toMatchObject({ title: 'Final paper', priority: 'urgent', due_time: '15:30:00', completed_at: null, group_id: g, version: 1 })
    expect(String(task!.due_date)).toContain('2026')
    const local = (await a.db.tasks.get(id))!
    expect(local).toMatchObject({ due_date: '2026-10-27', due_time: '15:30:00', version: 1 })
    expect(local.created_at).toBeTruthy()
    const subs = await adminRows<{ text: string; completed: boolean }>(pg, 'select text, completed from public.subtasks where task_id = $1 order by sort_index', [id])
    expect(subs).toEqual([{ text: 'Outline', completed: true }, { text: 'Draft', completed: false }])
    const links = await adminRows(pg, 'select 1 from public.task_labels where task_id = $1 and deleted_at is null', [id])
    expect(links).toHaveLength(2)
  })

  it('keeps a date-only deadline date-only (no time is invented)', async () => {
    const { a } = await setup()
    const g = await group(a)
    const dateOnly = await a.repo.createTask(draft(g, { due_date: '2026-11-01' }))
    const timed = await a.repo.createTask(draft(g, { due_date: '2026-11-01', due_time: '09:05' }))
    await a.sync()
    const b = await createDevice(pg, a.repo.userId)
    await b.sync()
    expect(await b.db.tasks.get(dateOnly)).toMatchObject({ due_date: '2026-11-01', due_time: null })
    expect(await b.db.tasks.get(timed)).toMatchObject({ due_date: '2026-11-01', due_time: '09:05:00' })
    await expect(a.repo.createTask(draft(g, { due_time: '09:00' }))).rejects.toThrow(/needs a due date/)
  })

  it('validates input with clear messages', async () => {
    const { a } = await setup()
    const g = await group(a)
    await expect(a.repo.createTask(draft(g, { title: '  ' }))).rejects.toThrow('Enter a title for the task.')
    await expect(a.repo.createTask(draft(g, { due_date: '2026-02-30' }))).rejects.toThrow('Enter a valid due date.')
    await expect(a.repo.createTask(draft(g, { recurrence: { unit: 'day', interval_count: 1 } }))).rejects.toThrow(/needs a due date/)
    await expect(a.repo.createTask(draft(g, { due_date: '2026-01-01', recurrence: { unit: 'day', interval_count: 0 } }))).rejects.toThrow(/whole number/)
    expect(await a.db.tasks.count()).toBe(0)
    expect((await a.db.outbox.toArray()).filter((e) => e.table === 'tasks')).toHaveLength(0)
  })

  it('edits and deletes a task', async () => {
    const { a } = await setup()
    const g = await group(a)
    const id = await a.repo.createTask(draft(g, { subtasks: [{ text: 'one', completed: false }] }))
    await a.sync()
    await a.repo.updateTask(id, draft(g, { title: 'Edited', priority: 'high', due_date: '2026-12-24' }))
    await a.sync()
    const [row] = await adminRows<Record<string, unknown>>(pg, 'select title, priority, version from public.tasks where id = $1', [id])
    expect(row).toMatchObject({ title: 'Edited', priority: 'high', version: 2 })
    await a.repo.deleteTask(id)
    expect(live(await a.db.tasks.toArray())).toHaveLength(0)
    expect(live(await a.db.subtasks.toArray())).toHaveLength(0)
    await a.sync()
    const rows = await adminRows<{ deleted_at: string | null }>(pg, 'select deleted_at from public.tasks where id = $1', [id])
    expect(rows[0]!.deleted_at).not.toBeNull()
    const subs = await adminRows(pg, 'select 1 from public.subtasks where task_id = $1 and deleted_at is null', [id])
    expect(subs).toHaveLength(0)
  })

  it('completing records the completion time; reopening clears it; the task stays in its group', async () => {
    const { a } = await setup()
    const g = await group(a)
    const id = await a.repo.createTask(draft(g))
    const when = new Date('2026-10-27T14:00:00Z')
    await a.repo.setTaskCompleted(id, true, when)
    expect((await a.db.tasks.get(id))!.completed_at).toBe(when.toISOString())
    await a.sync()
    const [row] = await adminRows<{ completed_at: string; group_id: string; deleted_at: string | null }>(pg, 'select completed_at, group_id, deleted_at from public.tasks where id = $1', [id])
    expect(new Date(row!.completed_at).toISOString()).toBe(when.toISOString())
    expect(row).toMatchObject({ group_id: g, deleted_at: null })
    await a.repo.setTaskCompleted(id, false)
    await a.sync()
    expect((await a.db.tasks.get(id))!.completed_at).toBeNull()
    expect((await adminRows<{ completed_at: string | null }>(pg, 'select completed_at from public.tasks where id = $1', [id]))[0]!.completed_at).toBeNull()
  })

  it('a task cannot change group', async () => {
    const { a } = await setup()
    const g1 = await group(a, 'One')
    const g2 = await group(a, 'Two')
    const id = await a.repo.createTask(draft(g1))
    await a.repo.updateTask(id, draft(g2, { title: 'Still in one' }))
    expect(await a.db.tasks.get(id)).toMatchObject({ group_id: g1, title: 'Still in one' })
  })
})

describe('labels', () => {
  it('supports several labels per task, custom colors, rename, recolor and delete without broken references', async () => {
    const { a } = await setup()
    const g = await group(a)
    const l1 = await a.repo.createLabel({ name: 'Research', color: '#ABCDEF' })
    const l2 = await a.repo.createLabel({ name: 'Podcast', color: '#111111' })
    const id = await a.repo.createTask(draft(g, { label_ids: [l1, l2] }))
    await a.sync()
    await a.repo.updateLabel(l1, { name: 'Lab', color: '#00ff00' })
    await expect(a.repo.createLabel({ name: 'podcast', color: '#000000' })).rejects.toThrow(/already exists/)
    await a.sync()
    const linksOf = async (d: Device) => live(await d.db.task_labels.where('task_id').equals(id).toArray()).map((l) => l.label_id).sort()
    expect(await linksOf(a)).toEqual([l1, l2].sort())
    expect(await a.db.labels.get(l1)).toMatchObject({ name: 'Lab', color: '#00ff00' })

    await a.repo.deleteLabel(l2)
    expect(await linksOf(a)).toEqual([l1])
    await a.sync()
    const serverLinks = await adminRows<{ label_id: string }>(pg, 'select label_id from public.task_labels where task_id = $1 and deleted_at is null', [id])
    expect(serverLinks.map((r) => r.label_id)).toEqual([l1])

    // Removing and re-adding a label on a task round-trips cleanly.
    await a.repo.updateTask(id, draft(g, { label_ids: [] }))
    await a.sync()
    await a.repo.updateTask(id, draft(g, { label_ids: [l1] }))
    await a.sync()
    expect(await a.db.outbox.count()).toBe(0)
    const b = await createDevice(pg, a.repo.userId)
    await b.sync()
    expect(await linksOf(b)).toEqual([l1])
  })
})

describe('subtasks', () => {
  it('adds, edits, reorders and deletes checklist items, preserving order', async () => {
    const { a } = await setup()
    const g = await group(a)
    const id = await a.repo.createTask(draft(g, { subtasks: [{ text: 'A', completed: false }, { text: 'B', completed: false }, { text: 'C', completed: false }] }))
    await a.sync()
    const subs = async (d: Device) => live(await d.db.subtasks.where('task_id').equals(id).toArray()).sort((x, y) => x.sort_index - y.sort_index)
    const [sa, sb, sc] = await subs(a)
    await a.repo.updateTask(id, draft(g, { subtasks: [{ id: sc!.id, text: 'C', completed: false }, { id: sa!.id, text: 'A edited', completed: true }, { text: 'D', completed: false }] }))
    expect((await subs(a)).map((s) => s.text)).toEqual(['C', 'A edited', 'D'])
    await a.sync()
    const b = await createDevice(pg, a.repo.userId)
    await b.sync()
    expect((await subs(b)).map((s) => [s.text, s.completed])).toEqual([['C', false], ['A edited', true], ['D', false]])
    expect((await b.db.subtasks.get(sb!.id))!.deleted_at).not.toBeNull()
  })

  it('completing every checklist item does NOT complete the parent task', async () => {
    const { a } = await setup()
    const g = await group(a)
    const id = await a.repo.createTask(draft(g, { subtasks: [{ text: 'A', completed: false }, { text: 'B', completed: false }] }))
    for (const s of await a.db.subtasks.where('task_id').equals(id).toArray()) await a.repo.setSubtaskCompleted(s.id, true)
    expect((await a.db.subtasks.where('task_id').equals(id).toArray()).every((s) => s.completed)).toBe(true)
    expect((await a.db.tasks.get(id))!.completed_at).toBeNull()
    await a.sync()
    expect((await adminRows<{ completed_at: string | null }>(pg, 'select completed_at from public.tasks where id = $1', [id]))[0]!.completed_at).toBeNull()
  })
})

describe('manual order', () => {
  it('is restored after switching to automatic sorting and back', async () => {
    const { a } = await setup()
    const g = await group(a)
    const c = await a.repo.createTask(draft(g, { title: 'Charlie' }))
    const al = await a.repo.createTask(draft(g, { title: 'Alpha' }))
    const b = await a.repo.createTask(draft(g, { title: 'Bravo' }))
    await a.repo.setGroupSort(g, 'manual', 'asc')
    await a.repo.reorderTasks(g, [b, c, al])
    await a.repo.moveTask(al, -1) // -> Bravo, Alpha, Charlie
    const view = async (d: Device) => {
      const grp = (await d.db.groups.get(g))!
      const tasks = live(await d.db.tasks.where('group_id').equals(g).toArray())
      return sortTasks(tasks, grp.sort_field, grp.sort_dir, { primaryLabel: () => undefined }).map((t) => t.title)
    }
    expect(await view(a)).toEqual(['Bravo', 'Alpha', 'Charlie'])
    const manualIndexes = live(await a.db.tasks.toArray()).map((t) => [t.id, t.manual_index]).sort()

    await a.repo.setGroupSort(g, 'title', 'asc')
    expect(await view(a)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    await a.repo.setGroupSort(g, 'title', 'desc')
    await a.repo.setGroupSort(g, 'priority', 'asc')
    // Automatic sorting never rewrites the manual order.
    expect(live(await a.db.tasks.toArray()).map((t) => [t.id, t.manual_index]).sort()).toEqual(manualIndexes)

    await a.repo.setGroupSort(g, 'manual', 'asc')
    expect(await view(a)).toEqual(['Bravo', 'Alpha', 'Charlie'])
    await a.sync()
    const other = await createDevice(pg, a.repo.userId)
    await other.sync()
    expect(await view(other)).toEqual(['Bravo', 'Alpha', 'Charlie'])
  })

  it('sorting or reordering tasks never reorders groups', async () => {
    const { a } = await setup()
    const g1 = await group(a, 'One')
    const g2 = await group(a, 'Two')
    const t1 = await a.repo.createTask(draft(g2, { title: 'x' }))
    const t2 = await a.repo.createTask(draft(g2, { title: 'y' }))
    const before = (await a.db.groups.bulkGet([g1, g2])).map((g) => g!.sort_index)
    await a.repo.setGroupSort(g2, 'title', 'desc')
    await a.repo.reorderTasks(g2, [t2, t1])
    await a.repo.moveTask(t1, -1)
    expect((await a.db.groups.bulkGet([g1, g2])).map((g) => g!.sort_index)).toEqual(before)
  })
})

describe('settings', () => {
  it('persists theme, custom colors, priority colors and widget order across reloads and devices', async () => {
    const { a } = await setup()
    await a.sync()
    await a.repo.setSetting('theme', { mode: 'dark', preset: 'forest', custom: { light: {}, dark: { accent: '#ff00aa' } } })
    await a.repo.setSetting('priority_colors', { low: '#000001', medium: '#000002', high: '#000003', urgent: '#000004' })
    await a.repo.setSetting('widget_order', ['upcoming', 'today', 'overdue'])
    await a.repo.setSetting('layout_mode', 'free')
    await a.reload()
    const local = resolveSettings(await a.db.user_settings.toArray())
    expect(local.theme).toEqual({ mode: 'dark', preset: 'forest', custom: { light: {}, dark: { accent: '#ff00aa' } } })
    await a.sync()
    const b = await createDevice(pg, a.repo.userId)
    await b.sync()
    const remote = resolveSettings(await b.db.user_settings.toArray())
    expect(remote.theme.custom.dark.accent).toBe('#ff00aa')
    expect(remote.priority_colors.urgent).toBe('#000004')
    expect(remote.widget_order).toEqual(['upcoming', 'today', 'overdue'])
    expect(remote.layout_mode).toBe('free')
    // Changing one setting leaves the others alone.
    await b.repo.setSetting('widget_order', ['overdue', 'today', 'upcoming'])
    await b.sync()
    await a.sync()
    const after = resolveSettings(await a.db.user_settings.toArray())
    expect(after.widget_order).toEqual(['overdue', 'today', 'upcoming'])
    expect(after.theme.preset).toBe('forest')
    expect(after.layout_mode).toBe('free')
  })
})
