import { describe, expect, it } from 'vitest'
import { buildLayout, orderFromLayout, packInOrder } from '../../src/lib/layout'
import { applyOrder, indexAfter, moveToPosition } from '../../src/lib/order'
import type { GroupRow } from '../../src/lib/types'

describe('fractional ordering', () => {
  const list = [
    { id: 'a', index: 1 },
    { id: 'b', index: 2 },
    { id: 'c', index: 3 },
  ]
  it('moves one item with a single update', () => {
    expect(moveToPosition(list, 'c', 0)).toEqual([{ id: 'c', index: 0 }])
    expect(moveToPosition(list, 'a', 1)).toEqual([{ id: 'a', index: 2.5 }])
    expect(moveToPosition(list, 'a', 0)).toEqual([])
    expect(indexAfter([1, 5, 3])).toBe(6)
    expect(indexAfter([])).toBe(1)
  })
  it('renumbers when neighbours are tied', () => {
    const tied = [
      { id: 'a', index: 1 },
      { id: 'b', index: 1 },
      { id: 'c', index: 1 },
    ]
    const updates = moveToPosition(tied, 'c', 1)
    const result = new Map(tied.map((x) => [x.id, x.index]))
    for (const u of updates) result.set(u.id, u.index)
    expect([...result.entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id)).toEqual(['a', 'c', 'b'])
  })
  it('applies an arbitrary new order', () => {
    const updates = applyOrder(list, ['c', 'a', 'b'])
    const result = new Map(list.map((x) => [x.id, x.index]))
    for (const u of updates) result.set(u.id, u.index)
    expect([...result.entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id)).toEqual(['c', 'a', 'b'])
    expect(applyOrder(list, ['a', 'b', 'c'])).toEqual([])
  })
})

function group(id: string, over: Partial<GroupRow> = {}): GroupRow {
  return {
    id, user_id: 'u', version: 1, created_at: '', updated_at: '', deleted_at: null, name: id, description: '', color: '#000000', icon: 'x',
    sort_index: 0, collapsed: false, grid_x: null, grid_y: null, grid_w: 4, grid_h: 8, sort_field: 'due', sort_dir: 'asc', ...over,
  }
}

describe('dashboard layout', () => {
  it('packs cards in group order and keeps each card size', () => {
    const packed = packInOrder([
      { i: 'a', w: 6, h: 8 },
      { i: 'b', w: 6, h: 4 },
      { i: 'c', w: 12, h: 4 },
    ])
    expect(packed.get('a')).toEqual({ x: 0, y: 0 })
    expect(packed.get('b')).toEqual({ x: 6, y: 0 })
    expect(packed.get('c')).toEqual({ x: 0, y: 8 })
  })
  it('uses stored positions only in free mode; collapsed cards are short and not resizable', () => {
    const groups = [group('a', { grid_x: 6, grid_y: 3 }), group('b', { collapsed: true, grid_h: 12 })]
    const auto = buildLayout(groups, 'auto')
    expect(auto[0]).toMatchObject({ x: 0, y: 0, w: 4, h: 8 })
    const free = buildLayout(groups, 'free')
    expect(free[0]).toMatchObject({ x: 6, y: 3 })
    expect(free[1]).toMatchObject({ h: 2, isResizable: false })
    expect(free[1]!.minW).toBeGreaterThanOrEqual(3)
  })
  it('derives reading order from positions', () => {
    expect(orderFromLayout([{ i: 'a', x: 6, y: 0 }, { i: 'b', x: 0, y: 0 }, { i: 'c', x: 0, y: 5 }])).toEqual(['b', 'a', 'c'])
  })
})
