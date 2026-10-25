/**
 * `computeTilePlacements` — the wall as ONE flat list of positioned cells.
 *
 * The page used to render the wall as nested rows (`splitIntoRows`, each row a
 * flex line). The geometry was right and the RECONCILIATION was not: a tile's
 * parent is its row, and the row a camera lands in changes when the column
 * count does. Adding a fourth camera to a 3-wide wall moves camera #3 from row
 * 1 to row 2 — and React cannot move a child between parents, it unmounts it
 * there and mounts it here. For a `GridTilePlayer` that is a torn-down WebRTC
 * peer: the camera nobody touched goes black and renegotiates.
 *
 * Flat + absolute keeps every tile a sibling of the same parent for ever, so
 * the only thing a device-set change can do to a tile that stays is move its
 * `left`/`top`. This function is the geometry that makes that possible, and it
 * must reproduce the old layout EXACTLY — including the centred partial row.
 */
import { describe, expect, it } from 'vitest'
import { computeGridLayout, computeTilePlacements, splitIntoRows } from '../grid-layout'

describe('computeTilePlacements', () => {
  it('lays a full grid out row by row, left to right', () => {
    const grid = { cols: 2, rows: 2, cellW: 100, cellH: 50, wallW: 200, wallH: 100 }
    expect(computeTilePlacements([1, 2, 3, 4], grid)).toEqual([
      { deviceId: 1, x: 0, y: 0, w: 100, h: 50 },
      { deviceId: 2, x: 100, y: 0, w: 100, h: 50 },
      { deviceId: 3, x: 0, y: 50, w: 100, h: 50 },
      { deviceId: 4, x: 100, y: 50, w: 100, h: 50 },
    ])
  })

  it('centres a partial last row inside the block, as the flex row did', () => {
    const grid = { cols: 2, rows: 2, cellW: 100, cellH: 50, wallW: 200, wallH: 100 }
    const placements = computeTilePlacements([1, 2, 3], grid)
    expect(placements[2]).toEqual({ deviceId: 3, x: 50, y: 50, w: 100, h: 50 })
  })

  it('keeps a tile at the same index in the same ORDER as the device list', () => {
    const grid = computeGridLayout(5, 1000, 600, 'auto')
    const placements = computeTilePlacements([9, 8, 7, 6, 5], grid)
    expect(placements.map((p) => p.deviceId)).toEqual([9, 8, 7, 6, 5])
  })

  it('never places a tile outside the block it reports', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 12]) {
      const devices = Array.from({ length: n }, (_, i) => i + 1)
      const grid = computeGridLayout(n, 1194, 700, 'auto')
      for (const p of computeTilePlacements(devices, grid)) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-9)
        expect(p.y).toBeGreaterThanOrEqual(-1e-9)
        expect(p.x + p.w).toBeLessThanOrEqual(grid.wallW + 1e-9)
        expect(p.y + p.h).toBeLessThanOrEqual(grid.wallH + 1e-9)
      }
    }
  })

  it('agrees with `splitIntoRows` on which camera is on which row', () => {
    // The rows helper stays: the placement is derived from it, not from a
    // second, quietly different, idea of the wall.
    for (const n of [1, 3, 5, 7, 10]) {
      const devices = Array.from({ length: n }, (_, i) => i + 1)
      const grid = computeGridLayout(n, 1194, 700, 'auto')
      const rows = splitIntoRows(devices, grid.cols)
      const placements = computeTilePlacements(devices, grid)
      for (const p of placements) {
        const rowIndex = rows.findIndex((r) => r.includes(p.deviceId))
        expect(p.y).toBeCloseTo(rowIndex * grid.cellH, 9)
      }
    }
  })

  it('is empty for an empty wall', () => {
    expect(computeTilePlacements([], computeGridLayout(0, 100, 100, 'auto'))).toEqual([])
  })
})
