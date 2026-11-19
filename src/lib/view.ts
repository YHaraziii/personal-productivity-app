/** Read model: turns raw local rows into the indexed structures the UI needs. */
import type { OutboxEntry } from '../data/db'
import { resolveSettings, type SettingsShape } from './settings'
import type { GroupRow, LabelRow, SeriesRow, SettingRow, SubtaskRow, TaskLabelRow, TaskRow } from './types'

export interface RawData {
  groups: GroupRow[]
  labels: LabelRow[]
  series: SeriesRow[]
  tasks: TaskRow[]
  subtasks: SubtaskRow[]
  taskLabels: TaskLabelRow[]
  settings: SettingRow[]
  outbox: OutboxEntry[]
}

export interface AppData {
  raw: RawData
  /** Live groups in group order. */
  groups: GroupRow[]
  groupsById: Map<string, GroupRow>
  /** Live tasks of live groups. */
  tasks: TaskRow[]
  tasksById: Map<string, TaskRow>
  tasksByGroup: Map<string, TaskRow[]>
  subtasksByTask: Map<string, SubtaskRow[]>
  /** Live labels, alphabetical. */
  labels: LabelRow[]
  labelsById: Map<string, LabelRow>
  labelIdsByTask: Map<string, string[]>
  seriesById: Map<string, SeriesRow>
  settings: SettingsShape
  /** Ids of groups / tasks with changes the server has not confirmed yet. */
  unsyncedGroupIds: Set<string>
  unsyncedTaskIds: Set<string>
  outbox: OutboxEntry[]
  conflicts: OutboxEntry[]
  failures: OutboxEntry[]
}

const EMPTY: readonly never[] = []

export function buildAppData(raw: RawData): AppData {
  const groups = raw.groups
    .filter((g) => !g.deleted_at)
    .sort(
      (a, b) =>
        a.sort_index - b.sort_index ||
        (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) ||
        (a.id < b.id ? -1 : 1),
    )
  const groupsById = new Map(groups.map((g) => [g.id, g]))
  const tasks = raw.tasks.filter((t) => !t.deleted_at && groupsById.has(t.group_id))
  const tasksById = new Map(tasks.map((t) => [t.id, t]))
  const tasksByGroup = new Map<string, TaskRow[]>()
  for (const task of tasks) {
    const list = tasksByGroup.get(task.group_id)
    if (list) list.push(task)
    else tasksByGroup.set(task.group_id, [task])
  }
  const subtasksByTask = new Map<string, SubtaskRow[]>()
  for (const subtask of raw.subtasks) {
    if (subtask.deleted_at || !tasksById.has(subtask.task_id)) continue
    const list = subtasksByTask.get(subtask.task_id)
    if (list) list.push(subtask)
    else subtasksByTask.set(subtask.task_id, [subtask])
  }
  for (const list of subtasksByTask.values()) {
    list.sort((a, b) => a.sort_index - b.sort_index || (a.created_at < b.created_at ? -1 : 1))
  }
  const labels = raw.labels.filter((l) => !l.deleted_at).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  const labelsById = new Map(labels.map((l) => [l.id, l]))
  const labelIdsByTask = new Map<string, string[]>()
  for (const link of raw.taskLabels) {
    if (link.deleted_at || !labelsById.has(link.label_id) || !tasksById.has(link.task_id)) continue
    const list = labelIdsByTask.get(link.task_id)
    if (list) list.push(link.label_id)
    else labelIdsByTask.set(link.task_id, [link.label_id])
  }
  const seriesById = new Map(raw.series.filter((s) => !s.deleted_at).map((s) => [s.id, s]))

  const unsyncedGroupIds = new Set<string>()
  const unsyncedTaskIds = new Set<string>()
  const subtaskOwner = new Map(raw.subtasks.map((s) => [s.id, s.task_id]))
  const linkOwner = new Map(raw.taskLabels.map((l) => [l.id, l.task_id]))
  for (const entry of raw.outbox) {
    if (entry.table === 'groups') unsyncedGroupIds.add(entry.row_id)
    else if (entry.table === 'tasks') unsyncedTaskIds.add(entry.row_id)
    else if (entry.table === 'subtasks') {
      const owner = subtaskOwner.get(entry.row_id)
      if (owner) unsyncedTaskIds.add(owner)
    } else if (entry.table === 'task_labels') {
      const owner = linkOwner.get(entry.row_id)
      if (owner) unsyncedTaskIds.add(owner)
    }
  }

  return {
    raw,
    groups,
    groupsById,
    tasks,
    tasksById,
    tasksByGroup,
    subtasksByTask,
    labels,
    labelsById,
    labelIdsByTask,
    seriesById,
    settings: resolveSettings(raw.settings),
    unsyncedGroupIds,
    unsyncedTaskIds,
    outbox: raw.outbox,
    conflicts: raw.outbox.filter((e) => e.status === 'conflict'),
    failures: raw.outbox.filter((e) => e.status === 'error'),
  }
}

export const subtasksOf = (data: AppData, taskId: string): readonly SubtaskRow[] => data.subtasksByTask.get(taskId) ?? EMPTY
export const labelIdsOf = (data: AppData, taskId: string): readonly string[] => data.labelIdsByTask.get(taskId) ?? EMPTY

/** Lower-cased alphabetically first label name of a task (for label sorting). */
export function primaryLabelOf(data: AppData, taskId: string): string | undefined {
  const ids = data.labelIdsByTask.get(taskId)
  if (!ids || ids.length === 0) return undefined
  let best: string | undefined
  for (const id of ids) {
    const name = data.labelsById.get(id)?.name.toLowerCase()
    if (name !== undefined && (best === undefined || name < best)) best = name
  }
  return best
}
