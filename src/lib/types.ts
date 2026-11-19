/** Shared row types. Field names mirror the PostgreSQL columns exactly. */

export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'urgent']
export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}
export const PRIORITY_RANK: Record<Priority, number> = { low: 0, medium: 1, high: 2, urgent: 3 }

export type SortField = 'manual' | 'title' | 'due' | 'label' | 'priority'
export const SORT_FIELDS: readonly SortField[] = ['manual', 'title', 'due', 'label', 'priority']
export type SortDir = 'asc' | 'desc'
export type RecurrenceUnit = 'day' | 'week' | 'month'
export const RECURRENCE_UNITS: readonly RecurrenceUnit[] = ['day', 'week', 'month']

export type TableName =
  | 'groups'
  | 'labels'
  | 'recurrence_series'
  | 'tasks'
  | 'subtasks'
  | 'task_labels'
  | 'user_settings'

/** Parents before children: the order inserts must be applied in. */
export const TABLES: readonly TableName[] = [
  'groups',
  'labels',
  'recurrence_series',
  'tasks',
  'subtasks',
  'task_labels',
  'user_settings',
]

export interface BaseRow {
  id: string
  user_id: string
  /** Last server version this device has seen. 0 = never confirmed by the server. */
  version: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface GroupRow extends BaseRow {
  name: string
  description: string
  color: string
  icon: string
  sort_index: number
  collapsed: boolean
  grid_x: number | null
  grid_y: number | null
  grid_w: number
  grid_h: number
  sort_field: SortField
  sort_dir: SortDir
}

export interface LabelRow extends BaseRow {
  name: string
  color: string
}

export interface SeriesRow extends BaseRow {
  group_id: string
  unit: RecurrenceUnit
  interval_count: number
  anchor_date: string
  title: string
  description: string
  priority: Priority
  due_time: string | null
  label_ids: string[]
  subtasks: string[]
  ended_at: string | null
}

export interface TaskRow extends BaseRow {
  group_id: string
  title: string
  description: string
  priority: Priority
  due_date: string | null
  due_time: string | null
  completed_at: string | null
  manual_index: number
  series_id: string | null
  occurrence_date: string | null
}

export interface SubtaskRow extends BaseRow {
  task_id: string
  text: string
  completed: boolean
  sort_index: number
}

export interface TaskLabelRow extends BaseRow {
  task_id: string
  label_id: string
}

export interface SettingRow extends BaseRow {
  key: string
  value: unknown
}

export interface RowByTable {
  groups: GroupRow
  labels: LabelRow
  recurrence_series: SeriesRow
  tasks: TaskRow
  subtasks: SubtaskRow
  task_labels: TaskLabelRow
  user_settings: SettingRow
}

export type AnyRow = RowByTable[TableName]

export interface RecurrenceRule {
  unit: RecurrenceUnit
  interval_count: number
  anchor_date: string
}

/** Limits enforced both in the UI and by database CHECK constraints. */
export const LIMITS = {
  groupName: 120,
  groupDescription: 2000,
  labelName: 60,
  taskTitle: 300,
  description: 50000,
  subtaskText: 500,
  icon: 16,
  gridCols: 12,
  gridMinW: 3,
  gridMaxW: 12,
  gridMinH: 4,
  gridMaxH: 30,
  intervalMax: 365,
} as const

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
