/**
 * CSV export (RFC 4180): comma separated, CRLF line endings, every field
 * quoted, embedded quotes doubled, UTF-8 with a byte-order mark so spreadsheet
 * applications detect the encoding.
 *
 * Formula-injection protection: a cell whose text starts with = + - @ (or a
 * tab / carriage return) could be executed as a formula by a spreadsheet.
 * Such cells are prefixed with an apostrophe, which spreadsheets treat as
 * "this is text". The apostrophe is part of the exported text: CSV is a
 * human-readable report, JSON is the full-fidelity backup.
 */
import { describeRule } from './recurrence'
import { htmlToPlainText } from './text'
import { PRIORITY_LABEL, type GroupRow, type LabelRow, type SeriesRow, type SubtaskRow, type TaskRow } from './types'

const FORMULA_TRIGGER = /^[\s]*[=+\-@]|^[\t\r]/

export function neutralizeFormula(value: string): string {
  return FORMULA_TRIGGER.test(value) ? `'${value}` : value
}

export function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : neutralizeFormula(String(value))
  return `"${text.replace(/"/g, '""')}"`
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export const CSV_HEADERS = [
  'Task ID',
  'Title',
  'Group',
  'Description',
  'Status',
  'Due Date',
  'Due Time',
  'Priority',
  'Labels',
  'Created At',
  'Completed At',
  'Recurrence',
  'Recurrence Series ID',
  'Subtasks',
  'Subtasks Completed',
  'Subtasks Total',
] as const

export interface CsvSource {
  groups: readonly GroupRow[]
  tasks: readonly TaskRow[]
  subtasks: readonly SubtaskRow[]
  labels: readonly LabelRow[]
  taskLabels: ReadonlyArray<{ task_id: string; label_id: string }>
  series: readonly SeriesRow[]
}

/**
 * One row per task, for ALL tasks in ALL groups (search and filters are never
 * applied). Representation of data CSV cannot hold natively:
 *  - Description: plain text; formatting and link targets are dropped.
 *  - Labels: names joined with "; ".
 *  - Subtasks: one per line inside the cell, "[x] done item" / "[ ] open item".
 *  - Recurrence: plain-language rule, e.g. "Every 2 weeks on Tuesday".
 */
export function buildTasksCsv(src: CsvSource): string {
  const groupById = new Map(src.groups.map((g) => [g.id, g]))
  const labelById = new Map(src.labels.map((l) => [l.id, l]))
  const seriesById = new Map(src.series.map((s) => [s.id, s]))
  const labelsByTask = new Map<string, string[]>()
  for (const link of src.taskLabels) {
    const label = labelById.get(link.label_id)
    if (!label) continue
    const list = labelsByTask.get(link.task_id) ?? []
    list.push(label.name)
    labelsByTask.set(link.task_id, list)
  }
  const subtasksByTask = new Map<string, SubtaskRow[]>()
  for (const subtask of src.subtasks) {
    const list = subtasksByTask.get(subtask.task_id) ?? []
    list.push(subtask)
    subtasksByTask.set(subtask.task_id, list)
  }
  const groupOrder = new Map([...src.groups].sort((a, b) => a.sort_index - b.sort_index).map((g, i) => [g.id, i]))
  const tasks = [...src.tasks].sort(
    (a, b) =>
      (groupOrder.get(a.group_id) ?? 0) - (groupOrder.get(b.group_id) ?? 0) ||
      a.manual_index - b.manual_index ||
      (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) ||
      (a.id < b.id ? -1 : 1),
  )
  const rows: Array<Array<string | number>> = [[...CSV_HEADERS]]
  for (const task of tasks) {
    const subtasks = (subtasksByTask.get(task.id) ?? []).sort((a, b) => a.sort_index - b.sort_index)
    const series = task.series_id ? seriesById.get(task.series_id) : undefined
    const recurrence = series ? describeRule(series) + (series.ended_at ? ' (ended)' : '') : ''
    rows.push([
      task.id,
      task.title,
      groupById.get(task.group_id)?.name ?? '',
      htmlToPlainText(task.description),
      task.completed_at ? 'Completed' : 'Active',
      task.due_date ?? '',
      task.due_time ? task.due_time.slice(0, 5) : '',
      PRIORITY_LABEL[task.priority],
      (labelsByTask.get(task.id) ?? []).sort((a, b) => a.localeCompare(b)).join('; '),
      task.created_at,
      task.completed_at ?? '',
      recurrence,
      task.series_id ?? '',
      subtasks.map((s) => `${s.completed ? '[x]' : '[ ]'} ${s.text}`).join('\n'),
      subtasks.filter((s) => s.completed).length,
      subtasks.length,
    ])
  }
  return toCsv(rows)
}
