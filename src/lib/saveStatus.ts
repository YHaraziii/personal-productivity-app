/**
 * The save indicator. "Saved" is only ever reported when the outbox is empty,
 * i.e. the server has confirmed every local change.
 */
export type SavePhase = 'idle' | 'syncing' | 'error'

export interface SaveStatusInput {
  online: boolean
  phase: SavePhase
  /** Outbox entries waiting to be sent (includes entries being sent now). */
  pending: number
  /** Outbox entries the server rejected. */
  failed: number
  /** Outbox entries held back by an unresolved conflict. */
  conflicts: number
  /** Last network / server error for the whole request, if any. */
  lastError: string | null
}

export type SaveStatusKind = 'saved' | 'saving' | 'offline' | 'pending' | 'failed' | 'conflict'

export interface SaveStatus {
  kind: SaveStatusKind
  label: string
  detail: string
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function deriveSaveStatus(s: SaveStatusInput): SaveStatus {
  const unsynced = s.pending + s.failed + s.conflicts
  if (!s.online) {
    return unsynced > 0
      ? {
          kind: 'offline',
          label: 'Offline · pending sync',
          detail: `${plural(unsynced, 'change')} saved on this device only. They will sync when you are back online.`,
        }
      : { kind: 'offline', label: 'Offline', detail: 'You are offline. Changes will be saved on this device and synced later.' }
  }
  if (s.failed > 0 || (s.phase === 'error' && unsynced > 0)) {
    return {
      kind: 'failed',
      label: 'Sync failed',
      detail:
        (s.lastError ? `${s.lastError} ` : '') +
        `${plural(unsynced, 'change')} are kept on this device and have not been lost.`,
    }
  }
  if (s.pending > 0) {
    return s.phase === 'syncing'
      ? { kind: 'saving', label: 'Saving…', detail: `Sending ${plural(s.pending, 'change')} to the server.` }
      : { kind: 'pending', label: 'Pending sync', detail: `${plural(s.pending, 'change')} waiting to be sent.` }
  }
  if (s.conflicts > 0) {
    return {
      kind: 'conflict',
      label: 'Needs review',
      detail: `${plural(s.conflicts, 'conflict')} must be resolved before those changes can be saved.`,
    }
  }
  if (s.phase === 'error') {
    return { kind: 'failed', label: 'Sync failed', detail: s.lastError ?? 'Could not reach the server.' }
  }
  return { kind: 'saved', label: 'Saved', detail: 'All changes are saved on the server.' }
}
