/**
 * Fractional ordering. Each item carries a floating-point index; moving one
 * item only rewrites that item's index (the midpoint of its new neighbours),
 * which keeps reorders to a single small mutation and makes concurrent
 * reorders of different items merge cleanly.
 */

const MIN_GAP = 1e-6

export interface Indexed {
  id: string
  index: number
}

export interface IndexUpdate {
  id: string
  index: number
}

export function indexAfter(indexes: readonly number[]): number {
  return indexes.length === 0 ? 1 : Math.max(...indexes) + 1
}

/**
 * Move `id` to position `toPosition` in `ordered` (already sorted). Returns
 * the index updates to persist: normally one; when neighbours are too close
 * (or tied) the whole list is renumbered 1..n.
 */
export function moveToPosition(ordered: readonly Indexed[], id: string, toPosition: number): IndexUpdate[] {
  const from = ordered.findIndex((item) => item.id === id)
  if (from === -1) return []
  const target = Math.max(0, Math.min(ordered.length - 1, toPosition))
  if (target === from) return []
  const next = ordered.filter((item) => item.id !== id)
  next.splice(target, 0, ordered[from]!)
  const before = next[target - 1]
  const after = next[target + 1]
  let index: number
  if (before && after) index = (before.index + after.index) / 2
  else if (before) index = before.index + 1
  else if (after) index = after.index - 1
  else index = 1
  const ok =
    (!before || index - before.index > MIN_GAP) && (!after || after.index - index > MIN_GAP) && Number.isFinite(index)
  if (ok) return [{ id, index }]
  return next
    .map((item, position) => ({ id: item.id, index: position + 1 }))
    .filter((update) => ordered.find((item) => item.id === update.id)!.index !== update.index)
}

/** Updates needed to make `ordered` follow `desiredIds` exactly. */
export function applyOrder(ordered: readonly Indexed[], desiredIds: readonly string[]): IndexUpdate[] {
  const current = ordered.map((item) => item.id)
  if (current.length === desiredIds.length && current.every((id, i) => id === desiredIds[i])) return []
  // A single moved item is the common case (one drag): find it and move it.
  for (const id of desiredIds) {
    const without = current.filter((x) => x !== id)
    const desiredWithout = desiredIds.filter((x) => x !== id)
    if (without.length === desiredWithout.length && without.every((x, i) => x === desiredWithout[i])) {
      return moveToPosition(ordered, id, desiredIds.indexOf(id))
    }
  }
  const byId = new Map(ordered.map((item) => [item.id, item.index]))
  return desiredIds
    .map((id, position) => ({ id, index: position + 1 }))
    .filter((update) => byId.has(update.id) && byId.get(update.id) !== update.index)
}
