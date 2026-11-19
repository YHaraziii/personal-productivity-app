/**
 * Local persistence (IndexedDB via Dexie). One database per signed-in user.
 *
 * Synced tables mirror the server tables row for row. The `outbox` is the
 * durable queue of local mutations that the server has not confirmed yet; it
 * survives reloads and browser restarts and is only ever emptied by a server
 * confirmation or an explicit user decision.
 */
import Dexie, { type Table } from 'dexie'
import type {
  AnyRow,
  GroupRow,
  LabelRow,
  SeriesRow,
  SettingRow,
  SubtaskRow,
  TableName,
  TaskLabelRow,
  TaskRow,
} from '../lib/types'

export type OutboxOp = 'insert' | 'update' | 'delete'
/**
 * pending  : waiting to be sent
 * inflight : part of the request currently in progress
 * error    : rejected by the server (kept, shown under "Sync issues")
 * conflict : overlaps a newer server change; waits for the user's decision
 */
export type OutboxStatus = 'pending' | 'inflight' | 'error' | 'conflict'

export interface OutboxEntry {
  seq?: number
  mutation_id: string
  table: TableName
  op: OutboxOp
  row_id: string
  /** insert: the full row. update: only the changed columns. delete: {}. */
  payload: Record<string, unknown>
  /** update: the value each changed column had before the local edit. */
  base: Record<string, unknown>
  /** insert only: if the id already exists on the server, silently use the
   *  server's row (used for records every device derives identically). */
  adopt: boolean
  status: OutboxStatus
  attempts: number
  last_error: string | null
  created_at: string
  /** conflict only: the server's current row and the overlapping columns. */
  server_row: Record<string, unknown> | null
  conflict_fields: string[]
}

export interface MetaRow {
  key: string
  value: unknown
}

export class AppDB extends Dexie {
  groups!: Table<GroupRow, string>
  labels!: Table<LabelRow, string>
  recurrence_series!: Table<SeriesRow, string>
  tasks!: Table<TaskRow, string>
  subtasks!: Table<SubtaskRow, string>
  task_labels!: Table<TaskLabelRow, string>
  user_settings!: Table<SettingRow, string>
  outbox!: Table<OutboxEntry, number>
  meta!: Table<MetaRow, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      groups: 'id',
      labels: 'id',
      recurrence_series: 'id, group_id',
      tasks: 'id, group_id, series_id',
      subtasks: 'id, task_id',
      task_labels: 'id, task_id, label_id',
      user_settings: 'id, key',
      outbox: '++seq, mutation_id, [table+row_id], status',
      meta: 'key',
    })
  }

  rows<T extends TableName>(table: T): Table<AnyRow, string> {
    return this.table(table) as Table<AnyRow, string>
  }

  get syncedTables(): Table<AnyRow, string>[] {
    return [
      this.groups,
      this.labels,
      this.recurrence_series,
      this.tasks,
      this.subtasks,
      this.task_labels,
      this.user_settings,
    ] as unknown as Table<AnyRow, string>[]
  }

  get allTables(): Table[] {
    return [...this.syncedTables, this.outbox, this.meta]
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value as T | undefined
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.meta.put({ key, value })
  }
}

export const dbNameFor = (userId: string) => `ppd-${userId}`

export function openUserDb(userId: string): AppDB {
  return new AppDB(dbNameFor(userId))
}
