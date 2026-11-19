import type { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import type { TaskDraft } from '../../src/data/repo'
import { successorTaskId } from '../../src/lib/ids'
import type { TaskRow } from '../../src/lib/types'
import { createDevice, live, type Device } from '../helpers/client'
import { adminRows, createTestDatabase, createUser } from '../helpers/pg'

let pg: PGlite
beforeAll(async () => {
  pg = await createTestDatabase()
})

const draft = (group_id: string, over: Partial<TaskDraft> = {}): TaskDraft => ({
  group_id,
  title: 'Water plants',
  description: '',
  priority: 'medium',
  due_date: '2026-03-02',
  due_time: null,
  label_ids: [],
  subtasks: [],
  recurrence: { unit: 'week', interval_count: 1 },
  ...over,
})

async function setup() {
  const user = await createUser(pg)
  const a = await createDevice(pg, user)
  const g = await a.repo.createGroup({ name: 'Home', description: '', color: '#3366ff', icon: '🏠' })
  return { user, a, g }
}

const at = (date: string) => new Date(`${date}T12:00:00`)
const occurrences = async (d: Device): Promise<TaskRow[]> =>
  live(await d.db.tasks.toArray()).sort((x, y) => (x.occurrence_date! < y.occurrence_date! ? -1 : 1))
const serverOccurrences = (user: string) =>
  adminRows<{ id: string; due_date: string; completed_at: string | null }>(
    pg,
    `select id, to_char(due_date, 'YYYY-MM-DD') as due_date, completed_at from public.tasks where user_id = $1 and deleted_at is null order by due_date`,
    [user],
  )

describe('completing a recurring task', () => {
  it.each([
    ['daily', { unit: 'day', interval_count: 1 }, '2026-03-02', '2026-03-03'],
    ['weekly', { unit: 'week', interval_count: 1 }, '2026-03-02', '2026-03-09'],
    ['monthly', { unit: 'month', interval_count: 1 }, '2026-03-02', '2026-04-02'],
    ['every two weeks', { unit: 'week', interval_count: 2 }, '2026-03-02', '2026-03-16'],
    ['every three days', { unit: 'day', interval_count: 3 }, '2026-03-02', '2026-03-05'],
  ] as const)('%s: marks the occurrence complete and creates exactly one next occurrence', async (_n, recurrence, due, next) => {
    const { user, a, g } = await setup()
    const id = await a.repo.createTask(draft(g, { due_date: due, recurrence: { ...recurrence }, due_time: '08:00', subtasks: [{ text: 'Fill can', completed: true }] }))
    await a.repo.setTaskCompleted(id, true, at(due))
    const [first, second] = await occurrences(a)
    expect(first).toMatchObject({ id, due_date: due })
    expect(first!.completed_at).not.toBeNull() // history preserved on the occurrence itself
    expect(second).toMatchObject({ id: successorTaskId(id), due_date: next, occurrence_date: next, due_time: '08:00:00', completed_at: null, series_id: first!.series_id, title: 'Water plants' })
    // The next occurrence starts with a fresh checklist from the series template.
    const subs = live(await a.db.subtasks.where('task_id').equals(second!.id).toArray())
    expect(subs.map((s) => [s.text, s.completed])).toEqual([['Fill can', false]])
    await a.sync()
    expect((await serverOccurrences(user)).map((t) => t.due_date)).toEqual([due, next])
    expect(await a.db.outbox.count()).toBe(0)
  })

  it('does not create duplicates when completion is repeated, reopened, or retried', async () => {
    const { user, a, g } = await setup()
    const id = await a.repo.createTask(draft(g))
    await a.repo.setTaskCompleted(id, true, at('2026-03-02'))
    await a.repo.setTaskCompleted(id, true, at('2026-03-02')) // repeated call
    await a.repo.setTaskCompleted(id, false) // reopen
    expect((await a.db.tasks.get(id))!.completed_at).toBeNull()
    expect(await occurrences(a)).toHaveLength(2) // the next occurrence stays
    await a.repo.setTaskCompleted(id, true, at('2026-03-20')) // complete again, much later
    const all = await occurrences(a)
    expect(all.map((t) => t.due_date)).toEqual(['2026-03-02', '2026-03-09']) // schedule not advanced twice

    // The first push reaches the server but its response is lost; the retry must not duplicate.
    a.remote.dropResponses = 1
    await a.sync()
    expect(await a.db.outbox.count()).toBeGreaterThan(0)
    await a.sync()
    await a.sync()
    expect(await a.db.outbox.count()).toBe(0)
    expect((await serverOccurrences(user)).map((t) => t.due_date)).toEqual(['2026-03-02', '2026-03-09'])
    const series = await adminRows(pg, 'select 1 from public.recurrence_series where user_id = $1', [user])
    expect(series).toHaveLength(1)
  })

  it('two devices completing the same occurrence offline still yield one next occurrence', async () => {
    const { user, a, g } = await setup()
    const id = await a.repo.createTask(draft(g, { recurrence: { unit: 'day', interval_count: 1 } }))
    await a.sync()
    const b = await createDevice(pg, user)
    await b.sync()
    await a.repo.setTaskCompleted(id, true, at('2026-03-02'))
    await b.repo.setTaskCompleted(id, true, at('2026-03-06')) // later, would compute a different date
    await a.sync()
    await b.sync()
    const server = await serverOccurrences(user)
    expect(server.map((t) => t.due_date)).toEqual(['2026-03-02', '2026-03-03'])
    // Device B adopted the server's next occurrence instead of keeping its own.
    expect((await b.db.tasks.get(successorTaskId(id)))!.due_date).toBe('2026-03-03')
    expect((await b.db.outbox.toArray()).filter((e) => e.status === 'error')).toHaveLength(0)
  })

  it('skips missed occurrences instead of creating a backlog', async () => {
    const { a, g } = await setup()
    const id = await a.repo.createTask(draft(g, { due_date: '2026-03-02', recurrence: { unit: 'day', interval_count: 1 } }))
    await a.repo.setTaskCompleted(id, true, at('2026-03-20')) // 18 days late
    const all = await occurrences(a)
    expect(all).toHaveLength(2)
    expect(all[1]!.due_date).toBe('2026-03-21') // the next FUTURE date, one occurrence only

    const weekly = await a.repo.createTask(draft(g, { title: 'Weekly', due_date: '2026-03-02', recurrence: { unit: 'week', interval_count: 2 } }))
    await a.repo.setTaskCompleted(weekly, true, at('2026-04-01'))
    expect((await a.db.tasks.get(successorTaskId(weekly)))!.due_date).toBe('2026-04-13') // stays on the two-week grid
  })

  it('completing early schedules the occurrence after the one completed', async () => {
    const { a, g } = await setup()
    const id = await a.repo.createTask(draft(g, { due_date: '2026-03-10', recurrence: { unit: 'week', interval_count: 1 } }))
    await a.repo.setTaskCompleted(id, true, at('2026-03-04'))
    expect((await a.db.tasks.get(successorTaskId(id)))!.due_date).toBe('2026-03-17')
  })

  it('monthly on the 31st uses the last day of shorter months and keeps the 31st afterwards', async () => {
    const { a, g } = await setup()
    let id = await a.repo.createTask(draft(g, { due_date: '2026-01-31', recurrence: { unit: 'month', interval_count: 1 } }))
    const dates: string[] = []
    for (let i = 0; i < 5; i++) {
      const current = (await a.db.tasks.get(id))!
      dates.push(current.due_date!)
      await a.repo.setTaskCompleted(id, true, at(current.due_date!))
      id = successorTaskId(id)
    }
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
    // Leap year: February has 29 days.
    const leap = await a.repo.createTask(draft(g, { due_date: '2028-01-31', recurrence: { unit: 'month', interval_count: 1 } }))
    await a.repo.setTaskCompleted(leap, true, at('2028-01-31'))
    expect((await a.db.tasks.get(successorTaskId(leap)))!.due_date).toBe('2028-02-29')
  })
})

describe('editing a recurring task', () => {
  it('"this occurrence only" does not change the series or later occurrences', async () => {
    const { a, g } = await setup()
    const id = await a.repo.createTask(draft(g))
    const seriesBefore = (await a.db.recurrence_series.toArray())[0]!
    await a.repo.updateTask(id, draft(g, { title: 'Water plants (use rain water)', due_date: '2026-03-04', priority: 'high' }), 'this')
    const task = (await a.db.tasks.get(id))!
    expect(task).toMatchObject({ title: 'Water plants (use rain water)', due_date: '2026-03-04', occurrence_date: '2026-03-02' })
    const seriesAfter = (await a.db.recurrence_series.get(seriesBefore.id))!
    expect(seriesAfter).toMatchObject({ title: 'Water plants', priority: 'medium', anchor_date: '2026-03-02' })
    await a.repo.setTaskCompleted(id, true, at('2026-03-04'))
    // The next occurrence follows the original rule and template, not the one-off edit.
    expect(await a.db.tasks.get(successorTaskId(id))).toMatchObject({ title: 'Water plants', priority: 'medium', due_date: '2026-03-09' })
  })

  it('"this and future" changes the template and rule, and never rewrites completed history', async () => {
    const { user, a, g } = await setup()
    const first = await a.repo.createTask(draft(g))
    await a.repo.setTaskCompleted(first, true, at('2026-03-02'))
    const second = successorTaskId(first)
    await a.sync()
    const historyBefore = (await a.db.tasks.get(first))!
    await a.repo.updateTask(second, draft(g, { title: 'Water plants + feed', due_date: '2026-03-10', recurrence: { unit: 'day', interval_count: 10 } }), 'future')
    expect(await a.db.tasks.get(second)).toMatchObject({ title: 'Water plants + feed', due_date: '2026-03-10', occurrence_date: '2026-03-10' })
    // The completed occurrence is untouched.
    const historyAfter = (await a.db.tasks.get(first))!
    expect(historyAfter).toMatchObject({ title: 'Water plants', due_date: '2026-03-02', completed_at: historyBefore.completed_at })
    await a.repo.setTaskCompleted(second, true, at('2026-03-10'))
    expect(await a.db.tasks.get(successorTaskId(second))).toMatchObject({ title: 'Water plants + feed', due_date: '2026-03-20' })
    await a.sync()
    expect((await serverOccurrences(user)).map((t) => t.due_date)).toEqual(['2026-03-02', '2026-03-10', '2026-03-20'])
  })

  it('editing only the title for "this and future" keeps a monthly 31st anchor', async () => {
    const { a, g } = await setup()
    const jan = await a.repo.createTask(draft(g, { due_date: '2026-01-31', recurrence: { unit: 'month', interval_count: 1 } }))
    await a.repo.setTaskCompleted(jan, true, at('2026-01-31'))
    const feb = successorTaskId(jan)
    await a.repo.updateTask(feb, draft(g, { title: 'Renamed', due_date: '2026-02-28', recurrence: { unit: 'month', interval_count: 1 } }), 'future')
    await a.repo.setTaskCompleted(feb, true, at('2026-02-28'))
    expect(await a.db.tasks.get(successorTaskId(feb))).toMatchObject({ title: 'Renamed', due_date: '2026-03-31' })
  })

  it('removing the recurrence stops the series; turning a plain task into a recurring one starts one', async () => {
    const { a, g } = await setup()
    const id = await a.repo.createTask(draft(g))
    await a.repo.updateTask(id, draft(g, { recurrence: null }), 'future')
    await a.repo.setTaskCompleted(id, true, at('2026-03-02'))
    expect(await occurrences(a)).toHaveLength(1)

    const plain = await a.repo.createTask(draft(g, { title: 'Plain', recurrence: null, due_date: '2026-05-01' }))
    await a.repo.updateTask(plain, draft(g, { title: 'Plain', due_date: '2026-05-01', recurrence: { unit: 'day', interval_count: 2 } }))
    await a.repo.setTaskCompleted(plain, true, at('2026-05-01'))
    expect((await a.db.tasks.get(successorTaskId(plain)))!.due_date).toBe('2026-05-03')
  })
})

describe('deleting a recurring task', () => {
  it('"this occurrence" skips it and the series continues', async () => {
    const { user, a, g } = await setup()
    const id = await a.repo.createTask(draft(g))
    await a.repo.deleteTask(id, 'this', at('2026-03-02'))
    const all = await occurrences(a)
    expect(all.map((t) => t.due_date)).toEqual(['2026-03-09'])
    await a.sync()
    expect((await serverOccurrences(user)).map((t) => t.due_date)).toEqual(['2026-03-09'])
  })

  it('"whole series" stops the series, removes open occurrences and keeps completed history', async () => {
    const { user, a, g } = await setup()
    const first = await a.repo.createTask(draft(g))
    await a.repo.setTaskCompleted(first, true, at('2026-03-02'))
    const second = successorTaskId(first)
    await a.repo.deleteTask(second, 'series', at('2026-03-05'))
    const remaining = await occurrences(a)
    expect(remaining.map((t) => t.id)).toEqual([first])
    expect(remaining[0]!.completed_at).not.toBeNull()
    expect((await a.db.recurrence_series.toArray())[0]!.ended_at).not.toBeNull()
    // Re-completing the kept occurrence does not restart the series.
    await a.repo.setTaskCompleted(first, false)
    await a.repo.setTaskCompleted(first, true, at('2026-03-06'))
    expect(await occurrences(a)).toHaveLength(1)
    await a.sync()
    expect(await serverOccurrences(user)).toHaveLength(1)
  })
})
