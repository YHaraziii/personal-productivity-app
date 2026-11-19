import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useSyncExternalStore } from 'react'
import type { AppDB } from '../data/db'
import { deriveSaveStatus, type SaveStatus } from '../lib/saveStatus'
import { buildAppData, type AppData, type RawData } from '../lib/view'
import type { EngineState, SyncEngine } from '../sync/engine'

async function loadAll(db: AppDB): Promise<RawData> {
  const [groups, labels, series, tasks, subtasks, taskLabels, settings, outbox] = await Promise.all([
    db.groups.toArray(),
    db.labels.toArray(),
    db.recurrence_series.toArray(),
    db.tasks.toArray(),
    db.subtasks.toArray(),
    db.task_labels.toArray(),
    db.user_settings.toArray(),
    db.outbox.orderBy('seq').toArray(),
  ])
  return { groups, labels, series, tasks, subtasks, taskLabels, settings, outbox }
}

/** Live view of the local database; re-renders whenever any table changes. */
export function useAppData(db: AppDB): AppData | undefined {
  const raw = useLiveQuery(() => loadAll(db), [db])
  return useMemo(() => (raw ? buildAppData(raw) : undefined), [raw])
}

export function useEngineState(engine: SyncEngine): EngineState {
  return useSyncExternalStore(engine.subscribe, engine.getState, engine.getState)
}

export function useSaveStatus(engine: SyncEngine, data: AppData | undefined): SaveStatus {
  const state = useEngineState(engine)
  return useMemo(() => {
    const outbox = data?.outbox ?? []
    return deriveSaveStatus({
      online: state.online,
      phase: state.phase,
      lastError: state.lastError,
      pending: outbox.filter((e) => e.status === 'pending' || e.status === 'inflight').length,
      failed: outbox.filter((e) => e.status === 'error').length,
      conflicts: outbox.filter((e) => e.status === 'conflict').length,
    })
  }, [state, data?.outbox])
}
