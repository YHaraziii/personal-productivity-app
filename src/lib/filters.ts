/**
 * Dashboard search, filters and summary widgets. All state here is kept in
 * memory only: it resets on every new visit, so a forgotten filter can never
 * hide tasks when the user comes back.
 */
import { dueBucket, type DueBucket } from './dates'
import { htmlToPlainText } from './text'
import type { Priority, SubtaskRow, TaskRow } from './types'

export type DueFilter = 'any' | 'overdue' | 'today' | 'upcoming' | 'none'
export type StatusFilter = 'all' | 'active' | 'completed'
export type WidgetKey = 'today' | 'overdue' | 'upcoming'
export const WIDGET_KEYS: readonly WidgetKey[] = ['today', 'overdue', 'upcoming']

export interface FilterState {
  search: string
  priorities: Priority[]
  labelIds: string[]
  due: DueFilter
  groupIds: string[]
  status: StatusFilter
}

export const EMPTY_FILTERS: FilterState = {
  search: '',
  priorities: [],
  labelIds: [],
  due: 'any',
  groupIds: [],
  status: 'all',
}

export function isFilterActive(f: FilterState): boolean {
  return (
    f.search.trim() !== '' ||
    f.priorities.length > 0 ||
    f.labelIds.length > 0 ||
    f.due !== 'any' ||
    f.groupIds.length > 0 ||
    f.status !== 'all'
  )
}

export interface FilterContext {
  labelIdsOf: (taskId: string) => readonly string[]
  subtasksOf: (taskId: string) => readonly SubtaskRow[]
}

const DUE_MATCH: Record<Exclude<DueFilter, 'any'>, DueBucket[]> = {
  overdue: ['overdue'],
  today: ['today'],
  upcoming: ['upcoming'],
  none: ['none'],
}

/** Search looks at the title, the description text and checklist items. */
export function matchesSearch(task: TaskRow, query: string, ctx: FilterContext): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  if (task.title.toLowerCase().includes(needle)) return true
  if (task.description && htmlToPlainText(task.description).toLowerCase().includes(needle)) return true
  return ctx.subtasksOf(task.id).some((s) => s.text.toLowerCase().includes(needle))
}

/** A task is shown only when it satisfies every active criterion (AND). Within
 *  one multi-select criterion (priorities, labels, groups) any value matches. */
export function matchesFilters(task: TaskRow, f: FilterState, ctx: FilterContext, now: Date): boolean {
  if (f.groupIds.length > 0 && !f.groupIds.includes(task.group_id)) return false
  if (f.status === 'active' && task.completed_at) return false
  if (f.status === 'completed' && !task.completed_at) return false
  if (f.priorities.length > 0 && !f.priorities.includes(task.priority)) return false
  if (f.labelIds.length > 0) {
    const own = ctx.labelIdsOf(task.id)
    if (!f.labelIds.some((id) => own.includes(id))) return false
  }
  if (f.due !== 'any' && !DUE_MATCH[f.due].includes(dueBucket(task, now))) return false
  return matchesSearch(task, f.search, ctx)
}

/** Summary widgets count open (not completed) tasks only. */
export function widgetCounts(tasks: readonly TaskRow[], now: Date): Record<WidgetKey, number> {
  const counts: Record<WidgetKey, number> = { today: 0, overdue: 0, upcoming: 0 }
  for (const task of tasks) {
    if (task.completed_at) continue
    const bucket = dueBucket(task, now)
    if (bucket === 'today' || bucket === 'overdue' || bucket === 'upcoming') counts[bucket]++
  }
  return counts
}

/** Selecting a widget filters the dashboard to exactly the tasks it counts. */
export function widgetFilter(current: FilterState, widget: WidgetKey): FilterState {
  const alreadyActive = current.due === widget && current.status === 'active'
  return alreadyActive
    ? { ...current, due: 'any', status: 'all' }
    : { ...current, due: widget, status: 'active' }
}

export function activeWidget(f: FilterState): WidgetKey | null {
  return f.status === 'active' && (f.due === 'today' || f.due === 'overdue' || f.due === 'upcoming') ? f.due : null
}

export const WIDGET_LABEL: Record<WidgetKey, string> = {
  today: 'Due Today',
  overdue: 'Overdue',
  upcoming: 'Upcoming Deadlines',
}
