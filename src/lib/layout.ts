/**
 * Dashboard grid layout (12 columns).
 *
 * Two modes, stored as the `layout_mode` setting:
 *  - auto : cards flow in GROUP ORDER (sort_index). Each card keeps its own
 *           size (grid_w × grid_h); positions are computed by packing.
 *           Dragging a card changes the group order.
 *  - free : cards stay where they were dropped (grid_x / grid_y, with
 *           upward compaction so no gaps open up). Dragging changes only the
 *           position; Move Up / Move Down still change the group order.
 * Card size is independent of both and kept in every mode.
 */
import { LIMITS, type GroupRow } from './types'
import type { LayoutMode } from './settings'

export const GRID_COLS = LIMITS.gridCols
export const COLLAPSED_H = 2

export interface GridItem {
  i: string
  x: number
  y: number
  w: number
  h: number
  minW: number
  maxW: number
  minH: number
  maxH: number
  isResizable: boolean
}

function fits(occupied: boolean[][], x: number, y: number, w: number, h: number): boolean {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) if (occupied[row]?.[col]) return false
  }
  return true
}

function mark(occupied: boolean[][], x: number, y: number, w: number, h: number): void {
  for (let row = y; row < y + h; row++) {
    occupied[row] ??= Array(GRID_COLS).fill(false)
    for (let col = x; col < x + w; col++) occupied[row]![col] = true
  }
}

/** Place cards in order at the first free spot, scanning row by row. */
export function packInOrder(items: Array<{ i: string; w: number; h: number }>): Map<string, { x: number; y: number }> {
  const occupied: boolean[][] = []
  const result = new Map<string, { x: number; y: number }>()
  let minY = 0
  for (const item of items) {
    const w = Math.min(item.w, GRID_COLS)
    let placed = false
    for (let y = minY; !placed; y++) {
      for (let x = 0; x + w <= GRID_COLS; x++) {
        if (fits(occupied, x, y, w, item.h)) {
          mark(occupied, x, y, w, item.h)
          result.set(item.i, { x, y })
          // Keep reading order: a later card never lands above an earlier one.
          minY = y
          placed = true
          break
        }
      }
    }
  }
  return result
}

export function buildLayout(groups: readonly GroupRow[], mode: LayoutMode): GridItem[] {
  const sized = groups.map((g) => ({ g, w: g.grid_w, h: g.collapsed ? COLLAPSED_H : g.grid_h }))
  const packed = packInOrder(sized.map(({ g, w, h }) => ({ i: g.id, w, h })))
  return sized.map(({ g, w, h }) => {
    const auto = packed.get(g.id)!
    const useStored = mode === 'free' && g.grid_x !== null && g.grid_y !== null
    return {
      i: g.id,
      x: useStored ? Math.min(g.grid_x!, GRID_COLS - w) : auto.x,
      y: useStored ? g.grid_y! : auto.y,
      w,
      h,
      minW: LIMITS.gridMinW,
      maxW: LIMITS.gridMaxW,
      minH: g.collapsed ? COLLAPSED_H : LIMITS.gridMinH,
      maxH: g.collapsed ? COLLAPSED_H : LIMITS.gridMaxH,
      isResizable: !g.collapsed,
    }
  })
}

/** Reading order of a layout (top to bottom, then left to right). */
export function orderFromLayout(layout: ReadonlyArray<{ i: string; x: number; y: number }>): string[] {
  return [...layout].sort((a, b) => a.y - b.y || a.x - b.x || (a.i < b.i ? -1 : 1)).map((item) => item.i)
}
