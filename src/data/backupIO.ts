/** Export (JSON, CSV) and import, on top of the local database and sync engine. */
import {
  buildBackup,
  prepareImport,
  type Backup,
  type BackupSource,
  type ImportMode,
  type ImportSummary,
} from '../lib/backup'
import { buildTasksCsv } from '../lib/csv'
import { RemoteError, type Remote, type SyncEngine } from '../sync/engine'
import type { AppDB } from './db'

export async function readSource(db: AppDB): Promise<BackupSource> {
  const [groups, labels, series, tasks, subtasks, taskLabels, settings] = await Promise.all([
    db.groups.toArray(),
    db.labels.toArray(),
    db.recurrence_series.toArray(),
    db.tasks.toArray(),
    db.subtasks.toArray(),
    db.task_labels.toArray(),
    db.user_settings.toArray(),
  ])
  return { groups, labels, series, tasks, subtasks, taskLabels, settings }
}

/** Full-fidelity JSON backup of the current state on this device. */
export async function exportBackup(db: AppDB, now: Date = new Date()): Promise<Backup> {
  return buildBackup(await readSource(db), now)
}

/** Every task in every group, regardless of any search or filter. */
export async function exportCsv(db: AppDB): Promise<string> {
  const src = await readSource(db)
  const live = <T extends { deleted_at: string | null }>(rows: readonly T[]) => rows.filter((r) => !r.deleted_at)
  const groups = live(src.groups)
  const groupIds = new Set(groups.map((g) => g.id))
  const tasks = live(src.tasks).filter((t) => groupIds.has(t.group_id))
  return buildTasksCsv({
    groups,
    tasks,
    subtasks: live(src.subtasks),
    labels: live(src.labels),
    taskLabels: live(src.taskLabels),
    series: live(src.series),
  })
}

/** The import could not start; nothing was changed anywhere. */
export class ImportBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportBlockedError'
  }
}

export interface ImportContext {
  db: AppDB
  engine: SyncEngine
  remote: Remote
  userId: string
}

export interface ImportOutcome {
  summary: ImportSummary
  notes: string[]
}

/**
 * Import a validated backup.
 *
 * The import is applied by the database in one transaction, so it needs a
 * connection, and it only starts when this device has nothing unsynced:
 * otherwise queued edits would be applied on top of (or lost under) the
 * imported data in a way the user did not ask for.
 */
export async function importBackup(ctx: ImportContext, backup: Backup, mode: ImportMode): Promise<ImportOutcome> {
  await ctx.engine.syncNow()
  const state = ctx.engine.getState()
  if (!state.online) {
    throw new ImportBlockedError(
      'Importing needs an internet connection, because the import is applied on the server in a single all-or-nothing step. Nothing was changed. Try again when you are back online.',
    )
  }
  const unsynced = await ctx.db.outbox.count()
  if (unsynced > 0 || state.phase === 'error') {
    throw new ImportBlockedError(
      unsynced > 0
        ? `This device has ${unsynced} change(s) that are not saved on the server yet (pending, failed, or waiting for a conflict decision). Resolve them first, then import. Nothing was changed.`
        : 'The server could not be reached, so the import was not started. Nothing was changed.',
    )
  }
  const existingLabels = (await ctx.db.labels.toArray()).filter((l) => !l.deleted_at)
  const prepared = prepareImport(backup, { userId: ctx.userId, mode, existingLabels })
  let summary: ImportSummary
  try {
    summary = await ctx.remote.importBackup(prepared.payload, mode)
  } catch (error) {
    if (error instanceof RemoteError && error.kind === 'network') {
      throw new ImportBlockedError('The connection was lost before the import was confirmed. Check your data, then try again if needed.')
    }
    throw error
  }
  // Re-read everything: a full pull also removes local rows a Replace retired.
  await ctx.engine.requestFullPull()
  await ctx.engine.syncNow()
  return { summary, notes: prepared.notes }
}
