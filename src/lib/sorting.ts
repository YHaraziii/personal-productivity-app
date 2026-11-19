/**
 * Task ordering inside a group.
 *
 * Rules (documented in README "Sorting"):
 *  - manual   : by manual_index. Automatic sorting never changes manual_index,
 *               so switching back to manual restores the saved manual order.
 *  - due      : earliest first (asc) or latest first (desc). Tasks WITHOUT a
 *               due date always come after dated tasks, in both directions.
 *               On the same day, timed tasks come before date-only tasks
 *               (a date-only deadline lasts until the end of the day).
 *  - title    : case-insensitive, natural number order.
 *  - label    : by the task's alphabetically first label name; unlabelled
 *               tasks always come last, in both directions.
 *  - priority : asc = Low -> Urgent, desc = Urgent -> Low.
 *
 * Ties are always broken the same way, regardless of direction:
 *   due date/time -> title -> creation time -> id
 * which makes the order fully deterministic between refreshes.
 */
import { PRIORITY_RANK, type SortDir, type SortField, type TaskRow } from './types'

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export interface SortContext {
  /** Lower-cased, alphabetically first label name per task id (absent = no labels). */
  primaryLabel: (taskId: string) => string | undefined
}

type Cmp = (a: TaskRow, b: TaskRow) => number

const dueKey = (t: TaskRow) => (t.due_date ? `${t.due_date}T${t.due_time ?? '24:00:00'}` : null)

/** Compare by deadline; `sign` flips dated tasks only, undated always last. */
function compareDue(a: TaskRow, b: TaskRow, sign: number): number {
  const ka = dueKey(a)
  const kb = dueKey(b)
  if (ka === null && kb === null) return 0
  if (ka === null) return 1
  if (kb === null) return -1
  return ka < kb ? -sign : ka > kb ? sign : 0
}

const compareTitle: Cmp = (a, b) => collator.compare(a.title, b.title)
const compareCreated: Cmp = (a, b) =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
const compareId: Cmp = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

const tieBreak: Cmp = (a, b) =>
  compareDue(a, b, 1) || compareTitle(a, b) || compareCreated(a, b) || compareId(a, b)

export function compareTasks(field: SortField, dir: SortDir, ctx: SortContext): Cmp {
  const sign = dir === 'desc' ? -1 : 1
  switch (field) {
    case 'manual':
      return (a, b) => a.manual_index - b.manual_index || compareCreated(a, b) || compareId(a, b)
    case 'due':
      return (a, b) => compareDue(a, b, sign) || tieBreak(a, b)
    case 'title':
      return (a, b) => sign * compareTitle(a, b) || tieBreak(a, b)
    case 'priority':
      return (a, b) => sign * (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || tieBreak(a, b)
    case 'label':
      return (a, b) => {
        const la = ctx.primaryLabel(a.id)
        const lb = ctx.primaryLabel(b.id)
        if (la === undefined && lb === undefined) return tieBreak(a, b)
        if (la === undefined) return 1
        if (lb === undefined) return -1
        return sign * collator.compare(la, lb) || tieBreak(a, b)
      }
  }
}

export function sortTasks(tasks: readonly TaskRow[], field: SortField, dir: SortDir, ctx: SortContext): TaskRow[] {
  return [...tasks].sort(compareTasks(field, dir, ctx))
}

export const SORT_FIELD_LABEL: Record<SortField, string> = {
  manual: 'Manual order',
  due: 'Due date',
  title: 'Title',
  label: 'Label',
  priority: 'Priority',
}
