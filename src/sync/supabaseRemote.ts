/** The production Remote: three PostgreSQL functions called through Supabase. */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ImportMode, ImportPayload, ImportSummary } from '../lib/backup'
import { RemoteError, type PullResult, type PushMutation, type PushResult, type Remote } from './engine'

interface RpcError {
  message?: string
  code?: string
  status?: number
}

function toRemoteError(error: RpcError, status?: number): RemoteError {
  const message = error.message ?? 'Request failed'
  const httpStatus = status ?? error.status
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    error.code === 'PGRST301' ||
    error.code === '28000' ||
    /jwt|not authenticated/i.test(message)
  ) {
    return new RemoteError('auth', message)
  }
  if (!httpStatus || httpStatus === 0 || /failed to fetch|networkerror|load failed|fetch failed/i.test(message)) {
    return new RemoteError('network', message)
  }
  return new RemoteError('server', message)
}

export class SupabaseRemote implements Remote {
  constructor(private readonly client: SupabaseClient) {}

  private async call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    let response: { data: unknown; error: RpcError | null; status?: number }
    try {
      response = await this.client.rpc(fn, args)
    } catch (error) {
      throw new RemoteError('network', error instanceof Error ? error.message : 'Network error')
    }
    if (response.error) throw toRemoteError(response.error, response.status)
    return response.data as T
  }

  push(mutations: PushMutation[]): Promise<PushResult[]> {
    return this.call<PushResult[]>('sync_push', { mutations })
  }

  pull(since: string | null): Promise<PullResult> {
    return this.call<PullResult>('sync_pull', { since })
  }

  /** Runs inside a single database transaction: it fully succeeds or changes nothing. */
  async importBackup(payload: ImportPayload, mode: ImportMode): Promise<ImportSummary> {
    return this.call<ImportSummary>('import_backup', { payload, mode })
  }
}
