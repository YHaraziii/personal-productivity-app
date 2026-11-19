import { describe, expect, it } from 'vitest'
import { EMPTY_FILTERS, activeWidget, isFilterActive, matchesFilters, widgetCounts, widgetFilter, type FilterState } from '../../src/lib/filters'
import type { SubtaskRow, TaskRow } from '../../src/lib/types'

const now = new Date(2026, 9, 27, 12, 0)
let n = 0
const task = (over: Partial<TaskRow>): TaskRow => ({
  id: `t${++n}`, user_id: 'u', version: 1, created_at: '', updated_at: '', deleted_at: null, group_id: 'g1', title: 'Task', description: '',
  priority: 'medium', due_date: null, due_time: null, completed_at: null, manual_index: 0, series_id: null, occurrence_date: null, ...over,
})

const essay = task({ title: 'Write Essay', description: '<p>Use <strong>MLA</strong> format</p>', priority: 'high', due_date: '2026-10-26', group_id: 'school' })
const groceries = task({ title: 'Groceries', priority: 'low', due_date: '2026-10-27', group_id: 'home' })
const done = task({ title: 'Old essay', priority: 'high', due_date: '2026-10-20', completed_at: '2026-10-20T10:00:00Z', group_id: 'school' })
const later = task({ title: 'Plan trip', due_date: '2026-10-30', group_id: 'home' })
const undated = task({ title: 'Someday', group_id: 'home' })
const all = [essay, groceries, done, later, undated]

const labels: Record<string, string[]> = { [essay.id]: ['L1'], [later.id]: ['L1', 'L2'] }
const subtasks: Record<string, SubtaskRow[]> = { [later.id]: [{ text: 'Book hotel in Lisbon' } as SubtaskRow] }
const ctx = { labelIdsOf: (id: string) => labels[id] ?? [], subtasksOf: (id: string) => subtasks[id] ?? [] }
const run = (f: Partial<FilterState>) => all.filter((t) => matchesFilters(t, { ...EMPTY_FILTERS, ...f }, ctx, now)).map((t) => t.title)

describe('search', () => {
  it('matches titles, description text and checklist items, case-insensitively', () => {
    expect(run({ search: 'essay' })).toEqual(['Write Essay', 'Old essay'])
    expect(run({ search: 'mla' })).toEqual(['Write Essay'])
    expect(run({ search: 'LISBON' })).toEqual(['Plan trip'])
    expect(run({ search: 'strong' })).toEqual([]) // HTML markup is not searched
    expect(run({ search: '   ' })).toHaveLength(5)
  })
})

describe('filters', () => {
  it('each filter on its own', () => {
    expect(run({ priorities: ['high'] })).toEqual(['Write Essay', 'Old essay'])
    expect(run({ priorities: ['low', 'medium'] })).toEqual(['Groceries', 'Plan trip', 'Someday'])
    expect(run({ labelIds: ['L2'] })).toEqual(['Plan trip'])
    expect(run({ labelIds: ['L1'] })).toEqual(['Write Essay', 'Plan trip'])
    expect(run({ groupIds: ['school'] })).toEqual(['Write Essay', 'Old essay'])
    expect(run({ status: 'completed' })).toEqual(['Old essay'])
    expect(run({ status: 'active' })).toHaveLength(4)
    expect(run({ due: 'overdue' })).toEqual(['Write Essay'])
    expect(run({ due: 'today' })).toEqual(['Groceries'])
    expect(run({ due: 'upcoming' })).toEqual(['Plan trip'])
    expect(run({ due: 'none' })).toEqual(['Someday'])
  })

  it('combines filters with AND', () => {
    expect(run({ groupIds: ['school'], priorities: ['high'], status: 'active' })).toEqual(['Write Essay'])
    expect(run({ groupIds: ['home'], labelIds: ['L1'], search: 'trip' })).toEqual(['Plan trip'])
    expect(run({ groupIds: ['home'], priorities: ['high'] })).toEqual([])
  })

  it('reports whether any filter is active, and EMPTY_FILTERS resets everything', () => {
    expect(isFilterActive(EMPTY_FILTERS)).toBe(false)
    expect(isFilterActive({ ...EMPTY_FILTERS, search: 'x' })).toBe(true)
    expect(isFilterActive({ ...EMPTY_FILTERS, due: 'today' })).toBe(true)
  })
})

describe('summary widgets', () => {
  it('count open tasks only', () => {
    expect(widgetCounts(all, now)).toEqual({ today: 1, overdue: 1, upcoming: 1 })
  })

  it('selecting a widget filters to exactly the counted tasks, and works with other filters', () => {
    for (const key of ['today', 'overdue', 'upcoming'] as const) {
      const f = widgetFilter(EMPTY_FILTERS, key)
      expect(activeWidget(f)).toBe(key)
      expect(all.filter((t) => matchesFilters(t, f, ctx, now))).toHaveLength(widgetCounts(all, now)[key])
    }
    const combined = widgetFilter({ ...EMPTY_FILTERS, groupIds: ['home'] }, 'overdue')
    expect(all.filter((t) => matchesFilters(t, combined, ctx, now))).toEqual([])
    // Selecting the same widget again clears it but keeps other filters.
    const cleared = widgetFilter(combined, 'overdue')
    expect(cleared).toEqual({ ...EMPTY_FILTERS, groupIds: ['home'] })
    expect(activeWidget(cleared)).toBeNull()
  })
})
