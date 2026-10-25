import { describe, it, expect } from 'vitest'
import { computeGridLayout, splitIntoRows, type GridCellLayout } from '../grid-layout'

/**
 * The embed's copy of the wall layout. The expectations below are the SAME
 * matrix the viewer's `src/grid/__tests__/auto-layout.spec.ts` asserts — the
 * embed is a separate bundle and cannot import that module, so the two files are
 * the mirror, and a change made to one algorithm must fail here until it is made
 * to both. (iOS/web render this wall; Android renders the native one. A layout
 * that only got fixed on one of them is a layout the operator sees broken.)
 */
const ASPECT = 16 / 9

const ZERO: GridCellLayout = { cols: 0, rows: 0, cellW: 0, cellH: 0, wallW: 0, wallH: 0 }

interface Viewport {
  readonly name: string
  readonly w: number
  readonly h: number
}

const VIEWPORTS: readonly Viewport[] = [
  { name: 'iPhone portrait', w: 390, h: 780 },
  { name: 'iPhone landscape', w: 844, h: 390 },
  { name: 'iPad portrait', w: 820, h: 1180 },
  { name: 'iPad landscape', w: 1180, h: 820 },
  { name: 'iPad landscape + timeline', w: 1180, h: 640 },
  { name: 'desktop', w: 1600, h: 900 },
]

const EXPECTED: Readonly<Record<string, Readonly<Record<number, readonly [number, number]>>>> = {
  'iPhone portrait': { 1: [1, 1], 2: [1, 2], 3: [1, 3], 4: [1, 4], 5: [1, 5], 9: [2, 5] },
  'iPhone landscape': { 1: [1, 1], 2: [2, 1], 3: [2, 2], 4: [2, 2], 5: [3, 2], 9: [3, 3] },
  'iPad portrait': { 1: [1, 1], 2: [1, 2], 3: [1, 3], 4: [1, 4], 5: [1, 5], 9: [2, 5] },
  'iPad landscape': { 1: [1, 1], 2: [1, 2], 3: [2, 2], 4: [2, 2], 5: [2, 3], 9: [3, 3] },
  'iPad landscape + timeline': { 1: [1, 1], 2: [2, 1], 3: [2, 2], 4: [2, 2], 5: [3, 2], 9: [3, 3] },
  desktop: { 1: [1, 1], 2: [2, 1], 3: [2, 2], 4: [2, 2], 5: [3, 2], 9: [3, 3] },
}

describe('computeGridLayout', () => {
  it('returns zeros for no tiles or an empty box', () => {
    expect(computeGridLayout(0, 400, 400, 'auto')).toEqual(ZERO)
    expect(computeGridLayout(4, 0, 400, 'auto')).toEqual(ZERO)
  })

  it('auto picks 2x2 for four tiles in a square box', () => {
    const l = computeGridLayout(4, 400, 400, 'auto')
    expect(l.cols).toBe(2)
    expect(l.rows).toBe(2)
    expect(l.cellW).toBeCloseTo(200)
    expect(l.cellH).toBeCloseTo(112.5)
  })

  it('forces the requested column count', () => {
    const l = computeGridLayout(4, 400, 400, 2)
    expect(l.cols).toBe(2)
    expect(l.rows).toBe(2)
    expect(l.wallW).toBeCloseTo(400)
    expect(l.wallH).toBeCloseTo(225)
  })

  it('falls back to auto for a non-positive fixed layout', () => {
    expect(computeGridLayout(4, 400, 400, 0 as unknown as number)).toEqual(
      computeGridLayout(4, 400, 400, 'auto'),
    )
  })

  it('honors cols > n: single row, partially filled', () => {
    const l = computeGridLayout(3, 600, 400, 5)
    expect(l.cols).toBe(5)
    expect(l.rows).toBe(1)
    // The block is what the three tiles occupy — two empty columns must not
    // push them off centre.
    expect(l.wallW).toBeCloseTo(l.cellW * 3)
  })

  /** THE REPORTED CASE: two portrait cameras, one contiguous column, the black
   *  band at the edges instead of between them. */
  it('stacks two portrait cameras into one contiguous column', () => {
    const l = computeGridLayout(2, 390, 780, 'auto')
    expect([l.cols, l.rows]).toEqual([1, 2])
    expect(l.wallH).toBeCloseTo(l.cellH * 2)
    expect(780 - l.wallH).toBeGreaterThan(0)
  })

  for (const vp of VIEWPORTS) {
    for (const n of [1, 2, 3, 4, 5, 9]) {
      it(`${vp.name} · ${n} cameras matches the viewer's matrix`, () => {
        const l = computeGridLayout(n, vp.w, vp.h, 'auto')
        expect([l.cols, l.rows]).toEqual(EXPECTED[vp.name]?.[n])
        expect(l.cellW / l.cellH).toBeCloseTo(ASPECT)
        expect(l.wallW).toBeCloseTo(l.cols * l.cellW)
        expect(l.wallH).toBeCloseTo(l.rows * l.cellH)
        expect(l.wallW).toBeLessThanOrEqual(vp.w + 1e-9)
        expect(l.wallH).toBeLessThanOrEqual(vp.h + 1e-9)
        expect(l.cols).toBe(Math.ceil(n / l.rows))
        expect(l.rows).toBe(Math.ceil(n / l.cols))
      })
    }
  }
})

describe('splitIntoRows', () => {
  it('fills each row before the next and leaves the last one partial', () => {
    expect(splitIntoRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(splitIntoRows([1, 2], 5)).toEqual([[1, 2]])
    expect(splitIntoRows([], 3)).toEqual([])
  })

  it('degrades to a single row rather than looping forever on a bad column count', () => {
    expect(splitIntoRows([1, 2], 0)).toEqual([[1, 2]])
  })
})
