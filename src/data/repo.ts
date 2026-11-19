/**
 * All writes go through this module. Every operation runs in one IndexedDB
 * transaction that (1) updates the local rows the UI reads and (2) appends the
 * matching mutation(s) to the durable outbox. Either both happen or neither,
 * so a local change can never exist without its queued sync mutation.
 */
import { valuesEqual } from '../lib/compare'
import { isValidDate, normalizeTime, todayLocal } from '../lib/dates'
import {
  defaultLabelId,
  newId,
  settingId,
  successorTaskId,
  taskLabelId,
  templateSubtaskId,
} from '../lib/ids'
import { applyOrder, indexAfter, moveToPosition, type Indexed } from '../lib/order'
import { nextOccurrenceDate } from '../lib/recurrence'
import { DEFAULT_LABELS, parseSetting, type SettingKey, type SettingsShape } from '../lib/settings'
import {
  HEX_COLOR_RE,
  LIMITS,
  PRIORITIES,
  RECURRENCE_UNITS,
  SORT_FIELDS,
  type AnyRow,
  type GroupRow,
  type Priority,
  type RecurrenceUnit,
  type SeriesRow,
  type SortDir,
  type SortField,
  type TableName,
  type TaskRow,
} from '../lib/types'
import type { AppDB, OutboxEntry } from './db'

/** A user-correctable problem with the submitted data. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export interface GroupInput {
  name: string
  description: string
  color: string
  icon: string
}

export interface SubtaskDraft {
  id?: string
  text: string
  completed: boolean
}

export interface RecurrenceDraft {
  unit: RecurrenceUnit
  interval_count: number
}

export interface TaskDraft {
  group_id: string
  title: string
  description: string
  priority: Priority
  due_date: string | null
  due_time: string | null
  label_ids: string[]
  subtasks: SubtaskDraft[]
  recurrence: RecurrenceDraft | null
}

/** 'this': only the edited occurrence. 'future': this occurrence and the series. */
export type EditScope = 'this' | 'future'
/** 'this': only this occurrence. 'series': this one, other open occurrences, and stop the series. */
export type DeleteScope = 'this' | 'series'

export interface GroupLayoutPatch {
  id: string
  grid_x?: number | null
  grid_y?: number | null
  grid_w?: number
  grid_h?: number
}

type Loose = Record<string, unknown>

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)))
const isLive = <T extends { deleted_at: string | null }>(row: T | undefined): row is T => !!row && !row.deleted_at

export function isSeriesActive(series: SeriesRow | undefined | null): series is SeriesRow {
  return !!series && !series.deleted_at && !series.ended_at
}

const byManual = (a: TaskRow, b: TaskRow) =>
  a.manual_index - b.manual_index ||
  (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) ||
  (a.id < b.id ? -1 : 1)

const byGroupOrder = (a: GroupRow, b: GroupRow) =>
  a.sort_index - b.sort_index ||
  (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) ||
  (a.id < b.id ? -1 : 1)

export class Repo {
  constructor(
    readonly db: AppDB,
    readonly userId: string,
    /** Called after every committed write so the sync engine can start pushing. */
    private readonly onWrite: () => void = () => {},
  ) {}

  // ------------------------------------------------------------------ core

  private async tx<T>(fn: () => Promise<T>): Promise<T> {
    const result = await this.db.transaction('rw', this.db.allTables, fn)
    this.onWrite()
    return result
  }

  private async enqueue(entry: Pick<OutboxEntry, 'table' | 'op' | 'row_id' | 'payload' | 'base' | 'adopt'>) {
    await this.db.outbox.add({
      ...entry,
      mutation_id: newId(),
      status: 'pending',
      attempts: 0,
      last_error: null,
      created_at: new Date().toISOString(),
      server_row: null,
      conflict_fields: [],
    })
  }

  private async insert(table: TableName, row: Loose & { id: string; created_at?: string }, adopt = false) {
    const nowIso = new Date().toISOString()
    const full = {
      ...row,
      user_id: this.userId,
      version: 0,
      created_at: row.created_at ?? nowIso,
      updated_at: nowIso,
      deleted_at: null,
    }
    await this.db.rows(table).put(full as unknown as AnyRow)
    const payload: Loose = { ...full }
    for (const key of ['id', 'user_id', 'version', 'updated_at', 'deleted_at']) delete payload[key]
    await this.enqueue({ table, op: 'insert', row_id: row.id, payload, base: {}, adopt })
  }

  /** Apply a partial update. Returns false when nothing actually changed. */
  private async update(table: TableName, id: string, patch: Loose): Promise<boolean> {
    const current = (await this.db.rows(table).get(id)) as Loose | undefined
    if (!current) throw new Error(`Cannot update missing ${table} row`)
    const changed: Loose = {}
    const base: Loose = {}
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || valuesEqual(key, current[key], value)) continue
      changed[key] = value
      base[key] = current[key] ?? null
    }
    if (Object.keys(changed).length === 0) return false
    await this.db.rows(table).put({ ...current, ...changed, updated_at: new Date().toISOString() } as unknown as AnyRow)

    // Fold into the newest queued mutation for this row when it has not been
    // sent yet: offline edits to one record become a single mutation.
    const entries = await this.db.outbox.where('[table+row_id]').equals([table, id]).sortBy('seq')
    const last = entries[entries.length - 1]
    if (last && last.status !== 'inflight' && last.op === 'insert') {
      last.payload = { ...last.payload, ...changed }
      this.revive(last)
      await this.db.outbox.put(last)
    } else if (last && last.status !== 'inflight' && last.op === 'update') {
      for (const [key, value] of Object.entries(changed)) {
        if (key in last.base && valuesEqual(key, last.base[key], value) && last.status !== 'conflict') {
          // The edit was undone before it was ever sent: nothing to sync.
          delete last.payload[key]
          delete last.base[key]
        } else {
          last.payload[key] = value
          if (!(key in last.base)) last.base[key] = base[key]
        }
      }
      if (Object.keys(last.payload).length === 0) await this.db.outbox.delete(last.seq!)
      else {
        this.revive(last)
        await this.db.outbox.put(last)
      }
    } else {
      await this.enqueue({ table, op: 'update', row_id: id, payload: changed, base, adopt: false })
    }
    return true
  }

  /** A rejected mutation that the user has since edited deserves a fresh attempt. */
  private revive(entry: OutboxEntry) {
    if (entry.status === 'error') {
      entry.status = 'pending'
      entry.attempts = 0
      entry.last_error = null
    }
  }

  private async remove(table: TableName, id: string, deletedAt: string): Promise<void> {
    const current = await this.db.rows(table).get(id)
    if (!isLive(current)) return
    await this.db.rows(table).put({ ...current, deleted_at: deletedAt, updated_at: deletedAt })
    await this.enqueue({ table, op: 'delete', row_id: id, payload: {}, base: {}, adopt: false })
  }

  /** Mirror the server's tombstone cascade locally; the server performs the
   *  real cascade when the parent's delete mutation is applied. */
  private async tombstoneLocally(table: TableName, ids: string[], deletedAt: string): Promise<void> {
    if (ids.length === 0) return
    const rows = (await this.db.rows(table).bulkGet(ids)).filter(isLive)
    await this.db.rows(table).bulkPut(rows.map((row) => ({ ...row, deleted_at: deletedAt, updated_at: deletedAt })))
  }

  private async tombstoneTaskChildren(taskIds: string[], deletedAt: string): Promise<void> {
    if (taskIds.length === 0) return
    const subtasks = await this.db.subtasks.where('task_id').anyOf(taskIds).primaryKeys()
    const links = await this.db.task_labels.where('task_id').anyOf(taskIds).primaryKeys()
    await this.tombstoneLocally('subtasks', subtasks, deletedAt)
    await this.tombstoneLocally('task_labels', links, deletedAt)
  }

  // ---------------------------------------------------------------- groups

  private async liveGroups(): Promise<GroupRow[]> {
    return (await this.db.groups.toArray()).filter(isLive).sort(byGroupOrder)
  }

  private validateGroupInput(input: Partial<GroupInput>): Partial<GroupInput> {
    const out: Partial<GroupInput> = {}
    if (input.name !== undefined) {
      const name = input.name.trim()
      if (!name) throw new ValidationError('Enter a name for the group.')
      if (name.length > LIMITS.groupName) throw new ValidationError(`Group names can be at most ${LIMITS.groupName} characters.`)
      out.name = name
    }
    if (input.description !== undefined) {
      const description = input.description.trim()
      if (description.length > LIMITS.groupDescription) {
        throw new ValidationError(`Descriptions can be at most ${LIMITS.groupDescription} characters.`)
      }
      out.description = description
    }
    if (input.color !== undefined) {
      if (!HEX_COLOR_RE.test(input.color)) throw new ValidationError('Choose a valid color.')
      out.color = input.color.toLowerCase()
    }
    if (input.icon !== undefined) {
      const icon = input.icon.trim()
      if (!icon) throw new ValidationError('Choose an icon or emoji.')
      if (icon.length > LIMITS.icon) throw new ValidationError('The icon must be a single emoji or a few characters.')
      out.icon = icon
    }
    return out
  }

  async createGroup(input: GroupInput): Promise<string> {
    const clean = this.validateGroupInput(input) as GroupInput
    return this.tx(async () => {
      const groups = await this.liveGroups()
      const id = newId()
      await this.insert('groups', {
        id,
        name: clean.name,
        description: clean.description ?? '',
        color: clean.color,
        icon: clean.icon,
        sort_index: indexAfter(groups.map((g) => g.sort_index)),
        collapsed: false,
        grid_x: null,
        grid_y: null,
        grid_w: 4,
        grid_h: 8,
        // New groups sort by due date, earliest first.
        sort_field: 'due',
        sort_dir: 'asc',
      })
      return id
    })
  }

  async updateGroup(id: string, input: Partial<GroupInput>): Promise<void> {
    const clean = this.validateGroupInput(input)
    await this.tx(async () => {
      if (!isLive(await this.db.groups.get(id))) throw new ValidationError('This group no longer exists.')
      await this.update('groups', id, clean)
    })
  }

  async setGroupCollapsed(id: string, collapsed: boolean): Promise<void> {
    await this.tx(() => this.update('groups', id, { collapsed }))
  }

  /** Expand All / Collapse All: sets every group's own persisted state. */
  async setAllCollapsed(collapsed: boolean): Promise<void> {
    await this.tx(async () => {
      for (const group of await this.liveGroups()) {
        if (group.collapsed !== collapsed) await this.update('groups', group.id, { collapsed })
      }
    })
  }

  async setGroupSort(id: string, field: SortField, dir: SortDir): Promise<void> {
    if (!SORT_FIELDS.includes(field) || (dir !== 'asc' && dir !== 'desc')) throw new ValidationError('Unknown sort option.')
    // Only the sort preference changes; manual_index of the tasks is untouched.
    await this.tx(() => this.update('groups', id, { sort_field: field, sort_dir: dir }))
  }

  /** Move a group one step earlier (-1) or later (+1) in the group order. */
  async moveGroup(id: string, delta: -1 | 1): Promise<void> {
    await this.tx(async () => {
      const groups = await this.liveGroups()
      const ordered: Indexed[] = groups.map((g) => ({ id: g.id, index: g.sort_index }))
      const position = ordered.findIndex((g) => g.id === id)
      if (position === -1) return
      for (const u of moveToPosition(ordered, id, position + delta)) {
        await this.update('groups', u.id, { sort_index: u.index })
      }
    })
  }

  /** Persist a new group order (drag and drop). Only sort_index changes. */
  async reorderGroups(orderedIds: string[]): Promise<void> {
    await this.tx(async () => {
      const groups = await this.liveGroups()
      const ordered: Indexed[] = groups.map((g) => ({ id: g.id, index: g.sort_index }))
      const known = new Set(ordered.map((g) => g.id))
      const desired = orderedIds.filter((gid) => known.has(gid))
      if (desired.length !== ordered.length) return
      for (const u of applyOrder(ordered, desired)) await this.update('groups', u.id, { sort_index: u.index })
    })
  }

  /** Persist card positions and/or sizes. Only the provided fields change. */
  async setGroupLayouts(patches: GroupLayoutPatch[]): Promise<void> {
    await this.tx(async () => {
      for (const p of patches) {
        const group = await this.db.groups.get(p.id)
        if (!isLive(group)) continue
        const patch: Loose = {}
        if (p.grid_w !== undefined) patch.grid_w = clamp(p.grid_w, LIMITS.gridMinW, LIMITS.gridMaxW)
        if (p.grid_h !== undefined) patch.grid_h = clamp(p.grid_h, LIMITS.gridMinH, LIMITS.gridMaxH)
        const width = (patch.grid_w as number | undefined) ?? group.grid_w
        if (p.grid_x !== undefined) patch.grid_x = p.grid_x === null ? null : clamp(p.grid_x, 0, LIMITS.gridCols - width)
        if (p.grid_y !== undefined) patch.grid_y = p.grid_y === null ? null : clamp(p.grid_y, 0, 100000)
        await this.update('groups', p.id, patch)
      }
    })
  }

  /** Delete a group and, with it, all of its tasks, checklists and series. */
  async deleteGroup(id: string): Promise<void> {
    await this.tx(async () => {
      const deletedAt = new Date().toISOString()
      const taskIds = await this.db.tasks.where('group_id').equals(id).primaryKeys()
      const seriesIds = await this.db.recurrence_series.where('group_id').equals(id).primaryKeys()
      await this.remove('groups', id, deletedAt)
      await this.tombstoneLocally('tasks', taskIds, deletedAt)
      await this.tombstoneLocally('recurrence_series', seriesIds, deletedAt)
      await this.tombstoneTaskChildren(taskIds, deletedAt)
    })
  }

  // ---------------------------------------------------------------- labels

  private async assertLabelNameFree(name: string, exceptId?: string): Promise<void> {
    const wanted = name.toLowerCase()
    const clash = (await this.db.labels.toArray()).some(
      (l) => !l.deleted_at && l.id !== exceptId && l.name.trim().toLowerCase() === wanted,
    )
    if (clash) throw new ValidationError('A label with this name already exists.')
  }

  private cleanLabelName(raw: string): string {
    const name = raw.trim()
    if (!name) throw new ValidationError('Enter a label name.')
    if (name.length > LIMITS.labelName) throw new ValidationError(`Label names can be at most ${LIMITS.labelName} characters.`)
    return name
  }

  async createLabel(input: { name: string; color: string }): Promise<string> {
    const name = this.cleanLabelName(input.name)
    if (!HEX_COLOR_RE.test(input.color)) throw new ValidationError('Choose a valid color.')
    return this.tx(async () => {
      await this.assertLabelNameFree(name)
      const id = newId()
      await this.insert('labels', { id, name, color: input.color.toLowerCase() })
      return id
    })
  }

  /** Rename / recolor. Tasks reference labels by id, so nothing else changes. */
  async updateLabel(id: string, input: { name?: string; color?: string }): Promise<void> {
    const patch: Loose = {}
    if (input.name !== undefined) patch.name = this.cleanLabelName(input.name)
    if (input.color !== undefined) {
      if (!HEX_COLOR_RE.test(input.color)) throw new ValidationError('Choose a valid color.')
      patch.color = input.color.toLowerCase()
    }
    await this.tx(async () => {
      if (!isLive(await this.db.labels.get(id))) throw new ValidationError('This label no longer exists.')
      if (patch.name !== undefined) await this.assertLabelNameFree(patch.name as string, id)
      await this.update('labels', id, patch)
    })
  }

  /** Delete a label and detach it from every task (no broken references). */
  async deleteLabel(id: string): Promise<void> {
    await this.tx(async () => {
      const deletedAt = new Date().toISOString()
      const links = await this.db.task_labels.where('label_id').equals(id).primaryKeys()
      await this.remove('labels', id, deletedAt)
      await this.tombstoneLocally('task_labels', links, deletedAt)
    })
  }

  // ----------------------------------------------------------------- tasks

  private async normalizeDraft(draft: TaskDraft): Promise<TaskDraft> {
    const title = draft.title.trim()
    if (!title) throw new ValidationError('Enter a title for the task.')
    if (title.length > LIMITS.taskTitle) throw new ValidationError(`Titles can be at most ${LIMITS.taskTitle} characters.`)
    if (draft.description.length > LIMITS.description) throw new ValidationError('The description is too long.')
    if (!PRIORITIES.includes(draft.priority)) throw new ValidationError('Choose a priority.')
    const dueDate = draft.due_date || null
    if (dueDate !== null && !isValidDate(dueDate)) throw new ValidationError('Enter a valid due date.')
    let dueTime: string | null = null
    if (draft.due_time) {
      dueTime = normalizeTime(draft.due_time)
      if (!dueTime) throw new ValidationError('Enter a valid due time.')
      if (!dueDate) throw new ValidationError('A due time needs a due date.')
    }
    let recurrence: RecurrenceDraft | null = null
    if (draft.recurrence) {
      const { unit, interval_count } = draft.recurrence
      if (!RECURRENCE_UNITS.includes(unit)) throw new ValidationError('Choose how often the task repeats.')
      if (!Number.isInteger(interval_count) || interval_count < 1 || interval_count > LIMITS.intervalMax) {
        throw new ValidationError(`The repeat interval must be a whole number from 1 to ${LIMITS.intervalMax}.`)
      }
      if (!dueDate) throw new ValidationError('A repeating task needs a due date for its first occurrence.')
      recurrence = { unit, interval_count }
    }
    const subtasks: SubtaskDraft[] = []
    for (const s of draft.subtasks) {
      const text = s.text.trim()
      if (!text) continue
      if (text.length > LIMITS.subtaskText) throw new ValidationError(`Checklist items can be at most ${LIMITS.subtaskText} characters.`)
      subtasks.push({ id: s.id, text, completed: !!s.completed })
    }
    const liveLabels = new Set((await this.db.labels.toArray()).filter((l) => !l.deleted_at).map((l) => l.id))
    const labelIds = [...new Set(draft.label_ids)].filter((id) => liveLabels.has(id))
    return {
      group_id: draft.group_id,
      title,
      description: draft.description,
      priority: draft.priority,
      due_date: dueDate,
      due_time: dueTime,
      label_ids: labelIds,
      subtasks,
      recurrence,
    }
  }

  private seriesTemplate(d: TaskDraft): Loose {
    return {
      title: d.title,
      description: d.description,
      priority: d.priority,
      due_time: d.due_time,
      label_ids: d.label_ids,
      subtasks: d.subtasks.map((s) => s.text),
    }
  }

  private async createSeries(groupId: string, d: TaskDraft): Promise<string> {
    const id = newId()
    await this.insert('recurrence_series', {
      id,
      group_id: groupId,
      unit: d.recurrence!.unit,
      interval_count: d.recurrence!.interval_count,
      anchor_date: d.due_date!,
      ...this.seriesTemplate(d),
      ended_at: null,
    })
    return id
  }

  async createTask(draft: TaskDraft): Promise<string> {
    return this.tx(async () => {
      const d = await this.normalizeDraft(draft)
      if (!isLive(await this.db.groups.get(d.group_id))) throw new ValidationError('This group no longer exists.')
      const siblings = (await this.db.tasks.where('group_id').equals(d.group_id).toArray()).filter(isLive)
      const id = newId()
      const seriesId = d.recurrence ? await this.createSeries(d.group_id, d) : null
      await this.insert('tasks', {
        id,
        group_id: d.group_id,
        title: d.title,
        description: d.description,
        priority: d.priority,
        due_date: d.due_date,
        due_time: d.due_time,
        completed_at: null,
        manual_index: indexAfter(siblings.map((t) => t.manual_index)),
        series_id: seriesId,
        occurrence_date: seriesId ? d.due_date : null,
      })
      await this.syncSubtasks(id, d.subtasks)
      await this.syncLabels(id, d.label_ids)
      return id
    })
  }

  /**
   * Edit a task.
   *
   * For a task in an active recurrence series, `scope` decides how far the
   * edit reaches:
   *  - 'this'   only this occurrence changes. The series rule and template are
   *             untouched, so later occurrences are unaffected.
   *  - 'future' this occurrence, the series template and rule, and any other
   *             open occurrence scheduled after this one. Completed occurrences
   *             are never rewritten: they are separate rows that keep their own
   *             title, dates and completion time.
   */
  async updateTask(taskId: string, draft: TaskDraft, scope: EditScope = 'this'): Promise<void> {
    await this.tx(async () => {
      const task = await this.db.tasks.get(taskId)
      if (!isLive(task)) throw new ValidationError('This task no longer exists.')
      const d = await this.normalizeDraft({ ...draft, group_id: task.group_id })
      const series = task.series_id ? await this.db.recurrence_series.get(task.series_id) : undefined
      const patch: Loose = {
        title: d.title,
        description: d.description,
        priority: d.priority,
        due_date: d.due_date,
        due_time: d.due_time,
      }
      if (!isSeriesActive(series)) {
        if (d.recurrence) {
          patch.series_id = await this.createSeries(task.group_id, d)
          patch.occurrence_date = d.due_date
        }
      } else if (scope === 'future') {
        if (d.recurrence) {
          const ruleChanged =
            d.recurrence.unit !== series.unit ||
            d.recurrence.interval_count !== series.interval_count ||
            d.due_date !== task.due_date
          const seriesPatch: Loose = { ...this.seriesTemplate(d) }
          if (ruleChanged) {
            // Re-anchor the schedule on this occurrence. When neither the rule
            // nor the date changed the original anchor is kept, so a monthly
            // "31st" series is not silently turned into a "28th" one.
            seriesPatch.unit = d.recurrence.unit
            seriesPatch.interval_count = d.recurrence.interval_count
            seriesPatch.anchor_date = d.due_date
            patch.occurrence_date = d.due_date
          }
          await this.update('recurrence_series', series.id, seriesPatch)
        } else {
          // Recurrence removed: the series stops; this task stays as history.
          await this.update('recurrence_series', series.id, { ended_at: new Date().toISOString() })
        }
        const later = (await this.db.tasks.where('series_id').equals(series.id).toArray()).filter(
          (t) => isLive(t) && !t.completed_at && t.id !== task.id && (t.occurrence_date ?? '') > (task.occurrence_date ?? ''),
        )
        for (const other of later) {
          await this.update('tasks', other.id, {
            title: d.title,
            description: d.description,
            priority: d.priority,
            due_time: other.due_date ? d.due_time : null,
          })
          await this.syncLabels(other.id, d.label_ids)
        }
      }
      await this.update('tasks', taskId, patch)
      await this.syncSubtasks(taskId, d.subtasks)
      await this.syncLabels(taskId, d.label_ids)
    })
  }

  private async syncSubtasks(taskId: string, drafts: SubtaskDraft[]): Promise<void> {
    const existing = (await this.db.subtasks.where('task_id').equals(taskId).toArray()).filter(isLive)
    const byId = new Map(existing.map((s) => [s.id, s]))
    const kept = new Set<string>()
    for (const [i, s] of drafts.entries()) {
      if (s.id && byId.has(s.id) && !kept.has(s.id)) {
        kept.add(s.id)
        await this.update('subtasks', s.id, { text: s.text, completed: s.completed, sort_index: i + 1 })
      } else {
        await this.insert('subtasks', { id: newId(), task_id: taskId, text: s.text, completed: s.completed, sort_index: i + 1 })
      }
    }
    const deletedAt = new Date().toISOString()
    for (const s of existing) if (!kept.has(s.id)) await this.remove('subtasks', s.id, deletedAt)
  }

  private async syncLabels(taskId: string, labelIds: string[], adopt = false): Promise<void> {
    const links = await this.db.task_labels.where('task_id').equals(taskId).toArray()
    const byLabel = new Map(links.map((l) => [l.label_id, l]))
    for (const labelId of labelIds) {
      const link = byLabel.get(labelId)
      if (!link) {
        await this.insert('task_labels', { id: taskLabelId(taskId, labelId), task_id: taskId, label_id: labelId }, adopt)
      } else if (link.deleted_at) {
        await this.update('task_labels', link.id, { deleted_at: null })
      }
    }
    const deletedAt = new Date().toISOString()
    for (const link of links) {
      if (!link.deleted_at && !labelIds.includes(link.label_id)) await this.remove('task_labels', link.id, deletedAt)
    }
  }

  /**
   * Create the occurrence that follows `task` in its series, unless it exists.
   *
   * The successor's id is derived from the predecessor's id, so this is
   * idempotent locally (the existence check), across retries (the server
   * ignores a second insert of the same id) and across devices (both derive
   * the same id; the later one adopts the server's row).
   */
  private async ensureSuccessor(task: TaskRow, series: SeriesRow, now: Date): Promise<void> {
    if (!task.occurrence_date) return
    const id = successorTaskId(task.id)
    if (await this.db.tasks.get(id)) return // exists, or was deliberately deleted
    const nextDate = nextOccurrenceDate(series, task.occurrence_date, todayLocal(now))
    await this.insert(
      'tasks',
      {
        id,
        group_id: task.group_id,
        title: series.title,
        description: series.description,
        priority: series.priority,
        due_date: nextDate,
        due_time: series.due_time,
        completed_at: null,
        manual_index: task.manual_index,
        series_id: series.id,
        occurrence_date: nextDate,
        created_at: now.toISOString(),
      },
      true,
    )
    for (const [i, text] of series.subtasks.entries()) {
      await this.insert(
        'subtasks',
        { id: templateSubtaskId(id, i), task_id: id, text, completed: false, sort_index: i + 1, created_at: now.toISOString() },
        true,
      )
    }
    const liveLabels = new Set((await this.db.labels.toArray()).filter((l) => !l.deleted_at).map((l) => l.id))
    await this.syncLabels(id, series.label_ids.filter((labelId) => liveLabels.has(labelId)), true)
  }

  /**
   * Complete or reopen a task.
   *
   * Completing an occurrence of an active series records its completion time
   * (the occurrence row is the completion history) and makes sure the next
   * occurrence exists. Reopening only clears the completion time: the next
   * occurrence that was already created stays, and completing again does not
   * create another one, so the schedule cannot be advanced twice.
   */
  async setTaskCompleted(taskId: string, completed: boolean, now: Date = new Date()): Promise<void> {
    await this.tx(async () => {
      const task = await this.db.tasks.get(taskId)
      if (!isLive(task)) throw new ValidationError('This task no longer exists.')
      if (!!task.completed_at === completed) return
      await this.update('tasks', taskId, { completed_at: completed ? now.toISOString() : null })
      if (completed && task.series_id) {
        const series = await this.db.recurrence_series.get(task.series_id)
        if (isSeriesActive(series)) await this.ensureSuccessor(task, series, now)
      }
    })
  }

  /**
   * Delete a task.
   *  - 'this'   deletes only this task. If it was the open occurrence of an
   *             active series, the occurrence is skipped: the next one is
   *             created so the series continues.
   *  - 'series' stops the series and deletes this occurrence and every other
   *             open occurrence. Completed occurrences are kept as history.
   */
  async deleteTask(taskId: string, scope: DeleteScope = 'this', now: Date = new Date()): Promise<void> {
    await this.tx(async () => {
      const task = await this.db.tasks.get(taskId)
      if (!isLive(task)) return
      const deletedAt = now.toISOString()
      const series = task.series_id ? await this.db.recurrence_series.get(task.series_id) : undefined
      const targets = [task.id]
      if (series && !series.deleted_at && scope === 'series') {
        if (!series.ended_at) await this.update('recurrence_series', series.id, { ended_at: deletedAt })
        const open = (await this.db.tasks.where('series_id').equals(series.id).toArray()).filter(
          (t) => isLive(t) && !t.completed_at && t.id !== task.id,
        )
        targets.push(...open.map((t) => t.id))
      } else if (isSeriesActive(series) && !task.completed_at) {
        await this.ensureSuccessor(task, series, now)
      }
      for (const id of targets) await this.remove('tasks', id, deletedAt)
      await this.tombstoneTaskChildren(targets, deletedAt)
    })
  }

  async setSubtaskCompleted(subtaskId: string, completed: boolean): Promise<void> {
    // Deliberately does not touch the parent task: checking every item never
    // completes the task automatically.
    await this.tx(async () => {
      if (!isLive(await this.db.subtasks.get(subtaskId))) return
      await this.update('subtasks', subtaskId, { completed })
    })
  }

  private async manualOrder(groupId: string): Promise<Indexed[]> {
    return (await this.db.tasks.where('group_id').equals(groupId).toArray())
      .filter(isLive)
      .sort(byManual)
      .map((t) => ({ id: t.id, index: t.manual_index }))
  }

  /** Move a task one step up (-1) or down (+1) in the group's manual order. */
  async moveTask(taskId: string, delta: -1 | 1): Promise<void> {
    await this.tx(async () => {
      const task = await this.db.tasks.get(taskId)
      if (!isLive(task)) return
      const ordered = await this.manualOrder(task.group_id)
      const position = ordered.findIndex((t) => t.id === taskId)
      for (const u of moveToPosition(ordered, taskId, position + delta)) {
        await this.update('tasks', u.id, { manual_index: u.index })
      }
    })
  }

  /** Persist a manual order produced by drag and drop. `visibleIds` may be a
   *  filtered subset: hidden tasks keep their relative positions. */
  async reorderTasks(groupId: string, visibleIds: string[]): Promise<void> {
    await this.tx(async () => {
      const ordered = await this.manualOrder(groupId)
      const visible = new Set(visibleIds)
      const queue = visibleIds.filter((id) => ordered.some((t) => t.id === id))
      if (queue.length === 0) return
      let next = 0
      const desired = ordered.map((t) => (visible.has(t.id) ? queue[next++]! : t.id))
      for (const u of applyOrder(ordered, desired)) await this.update('tasks', u.id, { manual_index: u.index })
    })
  }

  // -------------------------------------------------------------- settings

  async setSetting<K extends SettingKey>(key: K, value: SettingsShape[K], adopt = false): Promise<void> {
    const clean = parseSetting(key, value)
    if (clean === undefined) throw new ValidationError('That setting value is not valid.')
    await this.tx(async () => {
      const id = settingId(this.userId, key)
      const existing = await this.db.user_settings.get(id)
      if (existing) await this.update('user_settings', id, { value: clean, deleted_at: null })
      else await this.insert('user_settings', { id, key, value: clean }, adopt)
    })
  }

  /**
   * Create the default labels once per account. Ids are deterministic, so a
   * second device doing the same thing creates nothing new, and the
   * `labels_seeded` flag stops the defaults from coming back after the user
   * deletes them. The dashboard itself (groups, tasks) always starts empty.
   */
  async seedDefaultLabels(): Promise<void> {
    await this.tx(async () => {
      const flagId = settingId(this.userId, 'labels_seeded')
      if (await this.db.user_settings.get(flagId)) return
      for (const label of DEFAULT_LABELS) {
        const id = defaultLabelId(this.userId, label.name)
        if (!(await this.db.labels.get(id))) await this.insert('labels', { id, ...label }, true)
      }
      await this.insert('user_settings', { id: flagId, key: 'labels_seeded', value: true }, true)
    })
  }
}
