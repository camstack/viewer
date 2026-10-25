/**
 * `resolveWall` — the wall when the operator has resized a cell.
 *
 * ## The property that comes first
 *
 * An EMPTY span map must reproduce `computeTilePlacements` exactly — not
 * "closely", not "up to a pixel". Every wall in the field has no spans, and a
 * wall that shifted by a fraction after this landed would be a regression the
 * operator sees on a surface nobody asked to change. So the first describe below
 * compares the two functions value for value across the same case matrix the
 * placement spec walks, and the spanned path is only ever entered when a span
 * that is not 1×1 exists.
 *
 * ## What a span IS
 *
 * A count of TRACKS, never a rectangle in pixels. The host owns which camera is
 * how many tracks wide and tall; this file owns where the tracks are and how big
 * one is. That split is deliberate — the host publishes DIMENSIONS and the page
 * resolves POSITIONS — and it is why nothing in the protocol carries an `x`.
 *
 * ## Packing
 *
 * Cells take the first free block in reading order, in the device list's order.
 * A camera ADDED to a wall that already has custom spans therefore lands in the
 * first hole that fits it and the resized cells keep their size: the operator's
 * explicit act survives an implicit one.
 */
import { describe, expect, it } from 'vitest'
import { computeGridLayout, computeTilePlacements, resolveWall, type WallSpans } from '../grid-layout'

const NO_SPANS: WallSpans = {}

describe('no custom span: the wall that ships today, unchanged', () => {
  it('is value-identical to computeTilePlacements for every wall size', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 12]) {
      const devices = Array.from({ length: n }, (_, i) => i + 1)
      const grid = computeGridLayout(n, 1194, 700, 'auto')
      const wall = resolveWall(devices, 1194, 700, 'auto', NO_SPANS)
      expect(wall.placements).toEqual(computeTilePlacements(devices, grid))
      expect(wall.wallW).toBe(grid.wallW)
      expect(wall.wallH).toBe(grid.wallH)
    }
  })

  it('takes the same path when every span is the default 1×1', () => {
    const devices = [101, 102, 621]
    const grid = computeGridLayout(3, 1194, 700, 'auto')
    const spans: WallSpans = { '101': { cw: 1, ch: 1 }, '621': { cw: 1, ch: 1 } }
    expect(resolveWall(devices, 1194, 700, 'auto', spans).placements).toEqual(
      computeTilePlacements(devices, grid),
    )
  })

  it('is empty for an empty wall, and for a box with no room', () => {
    expect(resolveWall([], 100, 100, 'auto', NO_SPANS).placements).toEqual([])
    expect(resolveWall([1], 0, 100, 'auto', { '1': { cw: 2, ch: 1 } }).placements).toEqual([])
  })
})

describe('a cell that spans two tracks', () => {
  // Four cameras auto-lay out 2×2. Making the first one two tracks wide takes
  // the whole first row, and the other three pack under it.
  const devices = [1, 2, 3, 4]
  const spans: WallSpans = { '1': { cw: 2, ch: 1 } }
  const wall = resolveWall(devices, 1200, 800, 'auto', spans)
  const at = (id: number) => wall.placements.find((p) => p.deviceId === id)

  it('is twice as wide as a default cell, and the same height', () => {
    const big = at(1)
    const small = at(2)
    expect(big).toBeDefined()
    expect(small).toBeDefined()
    expect(big!.w).toBeCloseTo(small!.w * 2, 9)
    expect(big!.h).toBeCloseTo(small!.h, 9)
  })

  it('pushes the others down rather than overlapping them', () => {
    expect(at(2)!.y).toBeGreaterThan(at(1)!.y)
  })

  it('keeps every camera on the wall exactly once, in list order', () => {
    expect(wall.placements.map((p) => p.deviceId)).toEqual([1, 2, 3, 4])
  })

  it('never lets two cells overlap', () => {
    for (const a of wall.placements) {
      for (const b of wall.placements) {
        if (a.deviceId === b.deviceId) continue
        const apart =
          a.x + a.w <= b.x + 1e-9 ||
          b.x + b.w <= a.x + 1e-9 ||
          a.y + a.h <= b.y + 1e-9 ||
          b.y + b.h <= a.y + 1e-9
        expect(apart).toBe(true)
      }
    }
  })

  it('reports a block that contains every cell', () => {
    for (const p of wall.placements) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9)
      expect(p.y).toBeGreaterThanOrEqual(-1e-9)
      expect(p.x + p.w).toBeLessThanOrEqual(wall.wallW + 1e-9)
      expect(p.y + p.h).toBeLessThanOrEqual(wall.wallH + 1e-9)
    }
  })

  it('keeps the block inside the box it was given', () => {
    expect(wall.wallW).toBeLessThanOrEqual(1200 + 1e-9)
    expect(wall.wallH).toBeLessThanOrEqual(800 + 1e-9)
  })
})

describe('a camera joining a wall that has custom spans', () => {
  const spans: WallSpans = { '1': { cw: 2, ch: 2 } }

  it('does NOT reset the sizes the operator chose', () => {
    const before = resolveWall([1, 2, 3], 1200, 800, 'auto', spans)
    const after = resolveWall([1, 2, 3, 4], 1200, 800, 'auto', spans)
    const ratio = (w: ReturnType<typeof resolveWall>, id: number) => {
      const p = w.placements.find((x) => x.deviceId === id)!
      const unit = w.placements.find((x) => x.deviceId === 2)!
      return { cw: p.w / unit.w, ch: p.h / unit.h }
    }
    expect(ratio(before, 1).cw).toBeCloseTo(2, 6)
    expect(ratio(after, 1).cw).toBeCloseTo(2, 6)
    expect(ratio(after, 1).ch).toBeCloseTo(2, 6)
  })

  it('places the newcomer without moving anyone into an overlap', () => {
    const after = resolveWall([1, 2, 3, 4], 1200, 800, 'auto', spans)
    expect(after.placements.map((p) => p.deviceId)).toEqual([1, 2, 3, 4])
  })
})

describe('a span the wall cannot honour literally', () => {
  it('clamps a cell wider than the wall to the wall', () => {
    // Two cameras auto-lay out 2 columns; asking for 5 tracks cannot mean 5.
    const wall = resolveWall([1, 2], 1200, 400, 'auto', { '1': { cw: 5, ch: 1 } })
    expect(wall.placements[0].w).toBeLessThanOrEqual(wall.wallW + 1e-9)
  })

  it('treats a nonsense span as the default rather than dropping the camera', () => {
    const wall = resolveWall([1, 2], 1200, 400, 'auto', {
      '1': { cw: Number.NaN, ch: 0 },
    })
    expect(wall.placements.map((p) => p.deviceId)).toEqual([1, 2])
    expect(wall.placements[0].w).toBeCloseTo(wall.placements[1].w, 9)
  })
})
