/** Column-aware value comparison used by conflict detection. */
import { normalizeTime } from './dates'
import { deepEqual } from './text'

const TIMESTAMP_FIELDS = new Set(['completed_at', 'deleted_at', 'ended_at', 'created_at', 'updated_at'])

/**
 * Compare two values of a column the way the database would: instants by the
 * moment they denote (the server and the browser format them differently),
 * times of day normalised to HH:MM:SS, everything else structurally.
 */
export function valuesEqual(field: string, a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null
  if (TIMESTAMP_FIELDS.has(field) && typeof a === 'string' && typeof b === 'string') {
    const ma = Date.parse(a)
    const mb = Date.parse(b)
    return Number.isNaN(ma) || Number.isNaN(mb) ? a === b : ma === mb
  }
  if (field === 'due_time' && typeof a === 'string' && typeof b === 'string') {
    return (normalizeTime(a) ?? a) === (normalizeTime(b) ?? b)
  }
  return deepEqual(a, b)
}
