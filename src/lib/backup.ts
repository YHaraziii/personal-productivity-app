/**
 * JSON backup: build, validate, and prepare for import.
 *
 * Format (version 1) is documented in docs/BACKUP_FORMAT.md. A backup holds
 * everything needed to rebuild the application state and nothing about
 * authentication: no user id, e-mail, password, token or key is ever written.
 *
 * An imported file is NEVER trusted, even if this application produced it:
 * every field is type-checked, bounded and cross-referenced here before any
 * request is made, rich text is re-sanitized, and the database repeats the
 * structural checks inside one transaction (see import_backup in the SQL
 * migrations).
 */
import { isValidDate, normalizeTime } from './dates'
import { settingId, taskLabelId } from './ids'
import { sanitizeHtml } from './sanitize'
import { SETTING_KEYS, isSettingKey, parseSetting, type SettingKey } from './settings'
import {
  HEX_COLOR_RE,
  LIMITS,
  PRIORITIES,
  RECURRENCE_UNITS,
  SORT_FIELDS,
  UUID_RE,
  type GroupRow,
  type LabelRow,
  type SeriesRow,
  type SettingRow,
  type SubtaskRow,
  type TaskLabelRow,
  type TaskRow,
} from './types'

export const BACKUP_FORMAT = 'ppd-backup'
export const BACKUP_VERSION = 1
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024

export type BackupGroup = Pick<
  GroupRow,
  | 'id'
  | 'name'
  | 'description'
  | 'color'
  | 'icon'
  | 'sort_index'
  | 'collapsed'
  | 'grid_x'
  | 'grid_y'
  | 'grid_w'
  | 'grid_h'
  | 'sort_field'
  | 'sort_dir'
  | 'created_at'
>
export type BackupLabel = Pick<LabelRow, 'id' | 'name' | 'color' | 'created_at'>
export type BackupSeries = Pick<
  SeriesRow,
  | 'id'
  | 'group_id'
  | 'unit'
  | 'interval_count'
  | 'anchor_date'
  | 'title'
  | 'description'
  | 'priority'
  | 'due_time'
  | 'label_ids'
  | 'subtasks'
  | 'ended_at'
  | 'created_at'
>
export type BackupTask = Pick<
  TaskRow,
  | 'id'
  | 'group_id'
  | 'title'
  | 'description'
  | 'priority'
  | 'due_date'
  | 'due_time'
  | 'completed_at'
  | 'manual_index'
  | 'series_id'
  | 'occurrence_date'
  | 'created_at'
>
export type BackupSubtask = Pick<SubtaskRow, 'id' | 'task_id' | 'text' | 'completed' | 'sort_index' | 'created_at'>
export interface BackupTaskLabel {
  task_id: string
  label_id: string
}

export interface BackupData {
  groups: BackupGroup[]
  labels: BackupLabel[]
  recurrence_series: BackupSeries[]
  tasks: BackupTask[]
  subtasks: BackupSubtask[]
  task_labels: BackupTaskLabel[]
  settings: Partial<Record<SettingKey, unknown>>
}

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exported_at: string
  app_version: string
  data: BackupData
}

export interface BackupSource {
  groups: readonly GroupRow[]
  labels: readonly LabelRow[]
  series: readonly SeriesRow[]
  tasks: readonly TaskRow[]
  subtasks: readonly SubtaskRow[]
  taskLabels: readonly TaskLabelRow[]
  settings: readonly SettingRow[]
}

const live = <T extends { deleted_at: string | null }>(rows: readonly T[]) => rows.filter((r) => !r.deleted_at)

/** Build a backup from local rows. Deleted records are not exported. */
export function buildBackup(src: BackupSource, now: Date = new Date(), appVersion = '1.0.0'): Backup {
  const groups = live(src.groups)
  const groupIds = new Set(groups.map((g) => g.id))
  const labels = live(src.labels)
  const labelIds = new Set(labels.map((l) => l.id))
  const series = live(src.series).filter((s) => groupIds.has(s.group_id))
  const seriesIds = new Set(series.map((s) => s.id))
  const tasks = live(src.tasks).filter((t) => groupIds.has(t.group_id))
  const taskIds = new Set(tasks.map((t) => t.id))
  const settings: Partial<Record<SettingKey, unknown>> = {}
  for (const row of live(src.settings)) {
    if (isSettingKey(row.key) && row.value != null) settings[row.key] = row.value
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: now.toISOString(),
    app_version: appVersion,
    data: {
      groups: groups
        .sort((a, b) => a.sort_index - b.sort_index)
        .map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description,
          color: g.color,
          icon: g.icon,
          sort_index: g.sort_index,
          collapsed: g.collapsed,
          grid_x: g.grid_x,
          grid_y: g.grid_y,
          grid_w: g.grid_w,
          grid_h: g.grid_h,
          sort_field: g.sort_field,
          sort_dir: g.sort_dir,
          created_at: g.created_at,
        })),
      labels: labels.map((l) => ({ id: l.id, name: l.name, color: l.color, created_at: l.created_at })),
      recurrence_series: series.map((s) => ({
        id: s.id,
        group_id: s.group_id,
        unit: s.unit,
        interval_count: s.interval_count,
        anchor_date: s.anchor_date,
        title: s.title,
        description: s.description,
        priority: s.priority,
        due_time: s.due_time,
        label_ids: s.label_ids.filter((id) => labelIds.has(id)),
        subtasks: [...s.subtasks],
        ended_at: s.ended_at,
        created_at: s.created_at,
      })),
      tasks: tasks.map((t) => {
        const linked = t.series_id !== null && seriesIds.has(t.series_id)
        return {
          id: t.id,
          group_id: t.group_id,
          title: t.title,
          description: t.description,
          priority: t.priority,
          due_date: t.due_date,
          due_time: t.due_time,
          completed_at: t.completed_at,
          manual_index: t.manual_index,
          series_id: linked ? t.series_id : null,
          occurrence_date: linked ? t.occurrence_date : null,
          created_at: t.created_at,
        }
      }),
      subtasks: live(src.subtasks)
        .filter((s) => taskIds.has(s.task_id))
        .map((s) => ({
          id: s.id,
          task_id: s.task_id,
          text: s.text,
          completed: s.completed,
          sort_index: s.sort_index,
          created_at: s.created_at,
        })),
      task_labels: live(src.taskLabels)
        .filter((tl) => taskIds.has(tl.task_id) && labelIds.has(tl.label_id))
        .map((tl) => ({ task_id: tl.task_id, label_id: tl.label_id })),
      settings,
    },
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { ok: true; backup: Backup; warnings: string[] }
  | { ok: false; errors: string[] }

const MAX_ERRORS = 12

class Collector {
  errors: string[] = []
  total = 0
  add(message: string) {
    this.total++
    if (this.errors.length < MAX_ERRORS) this.errors.push(message)
  }
  result(): string[] {
    return this.total > this.errors.length
      ? [...this.errors, `…and ${this.total - this.errors.length} more problem(s).`]
      : this.errors
  }
}

type Rec = Record<string, unknown>
const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isTimestamp = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v))

class Reader {
  constructor(
    private rec: Rec,
    private path: string,
    private out: Collector,
  ) {}
  private fail(field: string, message: string): undefined {
    this.out.add(`${this.path}.${field}: ${message}`)
    return undefined
  }
  uuid(field: string): string {
    const v = this.rec[field]
    return isUuid(v) ? v.toLowerCase() : (this.fail(field, 'must be a valid id'), '')
  }
  optionalUuid(field: string): string | null {
    const v = this.rec[field]
    if (v == null) return null
    return isUuid(v) ? v.toLowerCase() : (this.fail(field, 'must be a valid id or empty'), null)
  }
  text(field: string, max: number, opts: { required?: boolean; fallback?: string } = {}): string {
    const v = this.rec[field]
    if (v == null && !opts.required) return opts.fallback ?? ''
    if (typeof v !== 'string') return (this.fail(field, 'must be text'), '')
    const value = opts.required ? v.trim() : v
    if (opts.required && value.length === 0) return (this.fail(field, 'is required'), '')
    if (value.length > max) return (this.fail(field, `must be at most ${max} characters`), '')
    return value
  }
  oneOf<T extends string>(field: string, allowed: readonly T[], fallback?: T): T {
    const v = this.rec[field]
    if (v == null && fallback !== undefined) return fallback
    if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T
    this.fail(field, `must be one of: ${allowed.join(', ')}`)
    return allowed[0]!
  }
  color(field: string, fallback: string): string {
    const v = this.rec[field]
    if (v == null) return fallback
    return typeof v === 'string' && HEX_COLOR_RE.test(v) ? v : (this.fail(field, 'must be a color like #1a2b3c'), fallback)
  }
  number(field: string, fallback: number): number {
    const v = this.rec[field]
    if (v == null) return fallback
    return isFiniteNumber(v) && Math.abs(v) < 1e12 ? v : (this.fail(field, 'must be a number'), fallback)
  }
  int(field: string, min: number, max: number, fallback: number): number {
    const v = this.rec[field]
    if (v == null) return fallback
    return Number.isInteger(v) && (v as number) >= min && (v as number) <= max
      ? (v as number)
      : (this.fail(field, `must be a whole number from ${min} to ${max}`), fallback)
  }
  optionalInt(field: string, min: number, max: number): number | null {
    const v = this.rec[field]
    if (v == null) return null
    return Number.isInteger(v) && (v as number) >= min && (v as number) <= max
      ? (v as number)
      : (this.fail(field, `must be a whole number from ${min} to ${max} or empty`), null)
  }
  bool(field: string, fallback: boolean): boolean {
    const v = this.rec[field]
    if (v == null) return fallback
    return typeof v === 'boolean' ? v : (this.fail(field, 'must be true or false'), fallback)
  }
  date(field: string, required: boolean): string | null {
    const v = this.rec[field]
    if (v == null && !required) return null
    return isValidDate(v) ? v : (this.fail(field, 'must be a date like 2026-10-27'), null)
  }
  time(field: string): string | null {
    const v = this.rec[field]
    if (v == null) return null
    const t = normalizeTime(v)
    return t ?? (this.fail(field, 'must be a time like 14:30'), null)
  }
  timestamp(field: string, fallback: string | null): string | null {
    const v = this.rec[field]
    if (v == null) return fallback
    return isTimestamp(v) ? new Date(Date.parse(v)).toISOString() : (this.fail(field, 'must be a date-time'), fallback)
  }
}

function section(data: Rec, name: string, out: Collector): Rec[] {
  const value = data[name]
  if (value == null) return []
  if (!Array.isArray(value)) {
    out.add(`data.${name}: must be a list`)
    return []
  }
  const records: Rec[] = []
  value.forEach((item, i) => {
    if (isRecord(item)) records.push(item)
    else out.add(`data.${name}[${i}]: must be a record`)
  })
  return records
}

function checkDuplicates(ids: string[], name: string, out: Collector): void {
  const seen = new Set<string>()
  const reported = new Set<string>()
  for (const id of ids) {
    if (!id) continue
    if (seen.has(id) && !reported.has(id)) {
      out.add(`data.${name}: duplicate id ${id}`)
      reported.add(id)
    }
    seen.add(id)
  }
}

/** Hook for future format versions: migrate an older backup up to the current one. */
function migrate(raw: Rec, version: number): Rec {
  // Version 1 is the first format. Future versions add `if (version < 2) …` here.
  void version
  return raw
}

export function parseBackupText(text: string): ValidationResult {
  if (text.length > MAX_BACKUP_BYTES) {
    return { ok: false, errors: ['This file is too large to be a dashboard backup (limit 25 MB).'] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    return { ok: false, errors: ['This file is not valid JSON. Choose a backup exported from this dashboard.'] }
  }
  return validateBackup(parsed)
}

export function validateBackup(input: unknown): ValidationResult {
  if (!isRecord(input) || input.format !== BACKUP_FORMAT) {
    return { ok: false, errors: ['This file is not a Personal Productivity Dashboard backup.'] }
  }
  const version = input.version
  if (!Number.isInteger(version) || (version as number) < 1) {
    return { ok: false, errors: ['The backup has no valid format version.'] }
  }
  if ((version as number) > BACKUP_VERSION) {
    return {
      ok: false,
      errors: [
        `This backup uses format version ${version}, but this app only understands version ${BACKUP_VERSION}. Update the app, then import again.`,
      ],
    }
  }
  const raw = migrate(input, version as number)
  if (!isRecord(raw.data)) return { ok: false, errors: ['The backup has no data section.'] }
  const data = raw.data
  const out = new Collector()
  const warnings: string[] = []
  const nowIso = new Date().toISOString()
  let sanitizedCount = 0
  const cleanHtml = (html: string): string => {
    const clean = sanitizeHtml(html)
    if (clean !== html && html.trim() !== '') sanitizedCount++
    return clean
  }

  const groups: BackupGroup[] = section(data, 'groups', out).map((rec, i) => {
    const r = new Reader(rec, `groups[${i}]`, out)
    return {
      id: r.uuid('id'),
      name: r.text('name', LIMITS.groupName, { required: true }),
      description: r.text('description', LIMITS.groupDescription),
      color: r.color('color', '#6366f1'),
      icon: r.text('icon', LIMITS.icon, { fallback: '📁' }) || '📁',
      sort_index: r.number('sort_index', i + 1),
      collapsed: r.bool('collapsed', false),
      grid_x: r.optionalInt('grid_x', 0, LIMITS.gridCols - 1),
      grid_y: r.optionalInt('grid_y', 0, 100000),
      grid_w: r.int('grid_w', LIMITS.gridMinW, LIMITS.gridMaxW, 4),
      grid_h: r.int('grid_h', LIMITS.gridMinH, LIMITS.gridMaxH, 8),
      sort_field: r.oneOf('sort_field', SORT_FIELDS, 'due'),
      sort_dir: r.oneOf('sort_dir', ['asc', 'desc'] as const, 'asc'),
      created_at: r.timestamp('created_at', nowIso)!,
    }
  })
  const labels: BackupLabel[] = section(data, 'labels', out).map((rec, i) => {
    const r = new Reader(rec, `labels[${i}]`, out)
    return {
      id: r.uuid('id'),
      name: r.text('name', LIMITS.labelName, { required: true }),
      color: r.color('color', '#64748b'),
      created_at: r.timestamp('created_at', nowIso)!,
    }
  })
  const groupIds = new Set(groups.map((g) => g.id))
  const labelIds = new Set(labels.map((l) => l.id))

  const series: BackupSeries[] = section(data, 'recurrence_series', out).map((rec, i) => {
    const path = `recurrence_series[${i}]`
    const r = new Reader(rec, path, out)
    const rawLabelIds = rec.label_ids
    const rawSubtasks = rec.subtasks
    let labelRefs: string[] = []
    if (rawLabelIds != null) {
      if (Array.isArray(rawLabelIds) && rawLabelIds.every(isUuid)) {
        // Template labels that no longer exist are dropped rather than rejected.
        labelRefs = rawLabelIds.map((id) => id.toLowerCase()).filter((id) => labelIds.has(id))
      } else out.add(`${path}.label_ids: must be a list of ids`)
    }
    let subtaskTexts: string[] = []
    if (rawSubtasks != null) {
      if (
        Array.isArray(rawSubtasks) &&
        rawSubtasks.length <= 200 &&
        rawSubtasks.every((s) => typeof s === 'string' && s.trim().length > 0 && s.length <= LIMITS.subtaskText)
      ) {
        subtaskTexts = rawSubtasks as string[]
      } else out.add(`${path}.subtasks: must be a list of non-empty texts`)
    }
    const groupId = r.uuid('group_id')
    if (groupId && !groupIds.has(groupId)) out.add(`${path}.group_id: refers to a group that is not in the backup`)
    return {
      id: r.uuid('id'),
      group_id: groupId,
      unit: r.oneOf('unit', RECURRENCE_UNITS),
      interval_count: r.int('interval_count', 1, LIMITS.intervalMax, 1),
      anchor_date: r.date('anchor_date', true) ?? '',
      title: r.text('title', LIMITS.taskTitle, { required: true }),
      description: cleanHtml(r.text('description', LIMITS.description)),
      priority: r.oneOf('priority', PRIORITIES, 'medium'),
      due_time: r.time('due_time'),
      label_ids: labelRefs,
      subtasks: subtaskTexts,
      ended_at: r.timestamp('ended_at', null),
      created_at: r.timestamp('created_at', nowIso)!,
    }
  })
  const seriesById = new Map(series.map((s) => [s.id, s]))

  const tasks: BackupTask[] = section(data, 'tasks', out).map((rec, i) => {
    const path = `tasks[${i}]`
    const r = new Reader(rec, path, out)
    const groupId = r.uuid('group_id')
    if (groupId && !groupIds.has(groupId)) out.add(`${path}.group_id: refers to a group that is not in the backup`)
    const seriesId = r.optionalUuid('series_id')
    const occurrenceDate = r.date('occurrence_date', false)
    const dueDate = r.date('due_date', false)
    const dueTime = r.time('due_time')
    if (dueTime && !dueDate) out.add(`${path}.due_time: a due time needs a due date`)
    if (seriesId) {
      const owner = seriesById.get(seriesId)
      if (!owner) out.add(`${path}.series_id: refers to a recurrence series that is not in the backup`)
      else if (owner.group_id !== groupId) out.add(`${path}.series_id: the series belongs to a different group`)
      if (!occurrenceDate) out.add(`${path}.occurrence_date: is required for a recurring task`)
    } else if (occurrenceDate) {
      out.add(`${path}.occurrence_date: is only allowed for a recurring task`)
    }
    return {
      id: r.uuid('id'),
      group_id: groupId,
      title: r.text('title', LIMITS.taskTitle, { required: true }),
      description: cleanHtml(r.text('description', LIMITS.description)),
      priority: r.oneOf('priority', PRIORITIES, 'medium'),
      due_date: dueDate,
      due_time: dueTime,
      completed_at: r.timestamp('completed_at', null),
      manual_index: r.number('manual_index', i + 1),
      series_id: seriesId,
      occurrence_date: seriesId ? occurrenceDate : null,
      created_at: r.timestamp('created_at', nowIso)!,
    }
  })
  const taskIds = new Set(tasks.map((t) => t.id))

  const subtasks: BackupSubtask[] = section(data, 'subtasks', out).map((rec, i) => {
    const path = `subtasks[${i}]`
    const r = new Reader(rec, path, out)
    const taskId = r.uuid('task_id')
    if (taskId && !taskIds.has(taskId)) out.add(`${path}.task_id: refers to a task that is not in the backup`)
    return {
      id: r.uuid('id'),
      task_id: taskId,
      text: r.text('text', LIMITS.subtaskText, { required: true }),
      completed: r.bool('completed', false),
      sort_index: r.number('sort_index', i + 1),
      created_at: r.timestamp('created_at', nowIso)!,
    }
  })

  const pairSeen = new Set<string>()
  const taskLabels: BackupTaskLabel[] = []
  section(data, 'task_labels', out).forEach((rec, i) => {
    const path = `task_labels[${i}]`
    const r = new Reader(rec, path, out)
    const taskId = r.uuid('task_id')
    const labelId = r.uuid('label_id')
    if (taskId && !taskIds.has(taskId)) out.add(`${path}.task_id: refers to a task that is not in the backup`)
    if (labelId && !labelIds.has(labelId)) out.add(`${path}.label_id: refers to a label that is not in the backup`)
    const pair = `${taskId}:${labelId}`
    if (pairSeen.has(pair)) return // the same label twice on one task: harmless, keep one
    pairSeen.add(pair)
    taskLabels.push({ task_id: taskId, label_id: labelId })
  })

  checkDuplicates(groups.map((g) => g.id), 'groups', out)
  checkDuplicates(labels.map((l) => l.id), 'labels', out)
  checkDuplicates(series.map((s) => s.id), 'recurrence_series', out)
  checkDuplicates(tasks.map((t) => t.id), 'tasks', out)
  checkDuplicates(subtasks.map((s) => s.id), 'subtasks', out)

  const settings: Partial<Record<SettingKey, unknown>> = {}
  if (data.settings != null) {
    if (!isRecord(data.settings)) out.add('data.settings: must be a record')
    else {
      for (const [key, value] of Object.entries(data.settings)) {
        if (!isSettingKey(key)) {
          warnings.push(`Unknown setting "${key.slice(0, 40)}" was ignored.`)
          continue
        }
        const parsed = parseSetting(key, value)
        if (parsed === undefined) warnings.push(`Setting "${key}" had an invalid value and was ignored.`)
        else settings[key] = parsed
      }
    }
  }

  if (out.total > 0) return { ok: false, errors: out.result() }
  if (sanitizedCount > 0) {
    warnings.push(`${sanitizedCount} description(s) contained formatting that is not allowed; it was removed.`)
  }
  return {
    ok: true,
    warnings,
    backup: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exported_at: isTimestamp(raw.exported_at) ? raw.exported_at : nowIso,
      app_version: typeof raw.app_version === 'string' ? raw.app_version.slice(0, 40) : '',
      data: { groups, labels, recurrence_series: series, tasks, subtasks, task_labels: taskLabels, settings },
    },
  }
}

// ---------------------------------------------------------------------------
// Import preparation
// ---------------------------------------------------------------------------

export type ImportMode = 'replace' | 'merge'

export interface ImportPayload {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  data: {
    groups: BackupGroup[]
    labels: BackupLabel[]
    recurrence_series: BackupSeries[]
    tasks: BackupTask[]
    subtasks: BackupSubtask[]
    task_labels: Array<{ id: string; task_id: string; label_id: string }>
    user_settings: Array<{ id: string; key: string; value: unknown }>
  }
}

export interface PreparedImport {
  payload: ImportPayload
  notes: string[]
}

/**
 * Turn a validated backup into the request sent to the database.
 *
 * Merge rule for labels: a label in the backup whose name matches an existing
 * label (ignoring case) is treated as that existing label, so merging a backup
 * never produces two labels with the same name.
 */
export function prepareImport(
  backup: Backup,
  opts: { userId: string; mode: ImportMode; existingLabels: ReadonlyArray<Pick<LabelRow, 'id' | 'name'>> },
): PreparedImport {
  const notes: string[] = []
  const labelMap = new Map<string, string>()
  if (opts.mode === 'merge') {
    const existingByName = new Map(opts.existingLabels.map((l) => [l.name.trim().toLowerCase(), l.id]))
    for (const label of backup.data.labels) {
      const match = existingByName.get(label.name.trim().toLowerCase())
      if (match && match !== label.id) labelMap.set(label.id, match)
    }
    if (labelMap.size > 0) {
      notes.push(`${labelMap.size} label(s) matched labels you already have by name and were merged into them.`)
    }
  }
  const mapLabel = (id: string) => labelMap.get(id) ?? id
  const pairs = new Set<string>()
  const taskLabels: ImportPayload['data']['task_labels'] = []
  for (const link of backup.data.task_labels) {
    const labelId = mapLabel(link.label_id)
    const pair = `${link.task_id}:${labelId}`
    if (pairs.has(pair)) continue
    pairs.add(pair)
    taskLabels.push({ id: taskLabelId(link.task_id, labelId), task_id: link.task_id, label_id: labelId })
  }
  const settings = { ...backup.data.settings, labels_seeded: true }
  return {
    notes,
    payload: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      data: {
        groups: backup.data.groups,
        labels: backup.data.labels.filter((l) => !labelMap.has(l.id)),
        recurrence_series: backup.data.recurrence_series.map((s) => ({
          ...s,
          label_ids: [...new Set(s.label_ids.map(mapLabel))],
        })),
        tasks: backup.data.tasks,
        subtasks: backup.data.subtasks,
        task_labels: taskLabels,
        user_settings: SETTING_KEYS.filter((key) => settings[key] !== undefined).map((key) => ({
          id: settingId(opts.userId, key),
          key,
          value: settings[key],
        })),
      },
    },
  }
}

export interface ImportTableSummary {
  added: number
  updated: number
  restored: number
  skipped: number
  removed: number
}
export interface ImportSummary {
  mode: ImportMode
  tables: Record<string, Partial<ImportTableSummary>>
}

const TABLE_LABEL: Array<[string, string]> = [
  ['groups', 'Groups'],
  ['tasks', 'Tasks'],
  ['subtasks', 'Checklist items'],
  ['labels', 'Labels'],
  ['task_labels', 'Label assignments'],
  ['recurrence_series', 'Recurring series'],
  ['user_settings', 'Settings'],
]

/** Plain-language explanation of what an import did. */
export function describeImportSummary(summary: ImportSummary): string[] {
  const lines: string[] = []
  for (const [table, label] of TABLE_LABEL) {
    const s = summary.tables[table]
    if (!s) continue
    const parts: string[] = []
    if (s.added) parts.push(`${s.added} added`)
    if (s.updated) parts.push(`${s.updated} overwritten from the backup`)
    if (s.restored) parts.push(`${s.restored} previously deleted and restored`)
    if (s.skipped) parts.push(`${s.skipped} already existed and kept as they are`)
    if (s.removed) parts.push(`${s.removed} removed (not in the backup)`)
    lines.push(`${label}: ${parts.length > 0 ? parts.join(', ') : 'no changes'}`)
  }
  return lines
}
