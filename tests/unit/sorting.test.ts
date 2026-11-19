import { describe, expect, it } from 'vitest'
import { sortTasks } from '../../src/lib/sorting'
import type { Priority, SortDir, SortField, TaskRow } from '../../src/lib/types'

let n = 0
function t(title: string, opts: { due?: string; time?: string; priority?: Priority; manual?: number; created?: string } = {}): TaskRow {
  n++
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    user_id: 'u',
    version: 1,
    created_at: opts.created ?? `2026-01-01T00:00:${String(n).padStart(2, '0')}Z`,
    updated_at: '',
    deleted_at: null,
    group_id: 'g',
    title,
    description: '',
    priority: opts.priority ?? 'medium',
    due_date: opts.due ?? null,
    due_time: opts.time ?? null,
    completed_at: null,
    manual_index: opts.manual ?? n,
    series_id: null,
    occurrence_date: null,
  }
}

const labels: Record<string, string> = {}
const ctx = { primaryLabel: (id: string) => labels[id] }
const titles = (tasks: TaskRow[], field: SortField, dir: SortDir) => sortTasks(tasks, field, dir, ctx).map((x) => x.title)

describe('sorting', () => {
  const a = t('apple', { due: '2026-10-28', priority: 'low', manual: 3 })
  const b = t('Banana', { due: '2026-10-27', time: '09:00', priority: 'urgent', manual: 1 })
  const c = t('cherry', { priority: 'high', manual: 2 })
  const d = t('date', { due: '2026-10-27', priority: 'medium', manual: 4 })
  const all = [a, b, c, d]
  labels[a.id] = 'school'
  labels[c.id] = 'home'

  it('by title, both directions, case-insensitive', () => {
    expect(titles(all, 'title', 'asc')).toEqual(['apple', 'Banana', 'cherry', 'date'])
    expect(titles(all, 'title', 'desc')).toEqual(['date', 'cherry', 'Banana', 'apple'])
  })

  it('by due date, both directions; undated last in both; timed before date-only on the same day', () => {
    expect(titles(all, 'due', 'asc')).toEqual(['Banana', 'date', 'apple', 'cherry'])
    expect(titles(all, 'due', 'desc')).toEqual(['apple', 'date', 'Banana', 'cherry'])
  })

  it('by priority, both directions', () => {
    expect(titles(all, 'priority', 'asc')).toEqual(['apple', 'date', 'cherry', 'Banana'])
    expect(titles(all, 'priority', 'desc')).toEqual(['Banana', 'cherry', 'date', 'apple'])
  })

  it('by label, both directions; unlabelled last in both', () => {
    expect(titles(all, 'label', 'asc')).toEqual(['cherry', 'apple', 'Banana', 'date'])
    expect(titles(all, 'label', 'desc')).toEqual(['apple', 'cherry', 'Banana', 'date'])
  })

  it('manual order uses manual_index only', () => {
    expect(titles(all, 'manual', 'asc')).toEqual(['Banana', 'cherry', 'apple', 'date'])
  })

  it('breaks ties deterministically regardless of input order', () => {
    const x = t('Same', { due: '2026-01-01', created: '2026-01-01T00:00:00Z' })
    const y = t('Same', { due: '2026-01-01', created: '2026-01-01T00:00:00Z' })
    const z = t('Same', { due: '2026-01-01', created: '2025-12-31T00:00:00Z' })
    const expected = sortTasks([x, y, z], 'priority', 'asc', ctx).map((r) => r.id)
    expect(expected[0]).toBe(z.id) // earlier creation first
    for (const order of [[x, y, z], [z, y, x], [y, z, x]]) {
      expect(sortTasks(order, 'priority', 'asc', ctx).map((r) => r.id)).toEqual(expected)
      expect(sortTasks(order, 'priority', 'desc', ctx).map((r) => r.id)).toEqual(expected)
    }
  })

  it('does not mutate the input', () => {
    const input = [...all]
    sortTasks(input, 'title', 'desc', ctx)
    expect(input).toEqual(all)
  })
})
