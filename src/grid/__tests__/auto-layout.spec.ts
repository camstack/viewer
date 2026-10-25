import { describe, it, expect } from 'vitest'
import { computeAutoLayout, computeGridLayout, splitIntoRows, type AutoLayout } from '../auto-layout.js'

const ASPECT = 16 / 9

/**
 * The layout under test answers ONE question: where do the black pixels go?
 *
 * The reported failure was two cameras in portrait with a black band BETWEEN
 * them — the wall computed a 1×2 block and the renderer spread the two lines
 * across the whole viewport, so the leftover height was cut in half and half of
 * it landed in the middle. The fix has two halves and this file pins both:
 *
 *  • the layout publishes the CONTIGUOUS BLOCK it means (`wallW`/`wallH`), so a
 *    renderer has something to centre instead of a wrap container to guess in;
 *  • the candidate set is CANONICAL — no column count wider than the row it
 *    fills — so the chosen split is the tightest one of its area class.
 */
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
  // Tablet with the grid timeline mounted: the band is a SIBLING, so the wall
  // gets a shorter box and must stay just as compact inside it.
  { name: 'iPad landscape + timeline', w: 1180, h: 640 },
  { name: 'desktop', w: 1600, h: 900 },
]

const COUNTS: readonly number[] = [1, 2, 3, 4, 5, 9]

/** Every (cols, rows) pair that packs `n` tiles with no column and no row that
 *  the tiles do not reach — the set the implementation is allowed to choose
 *  from, rebuilt here from the definition rather than from the code. */
function canonicalSplits(n: number): readonly { cols: number; rows: number }[] {
  const out: { cols: number; rows: number }[] = []
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows)
    if (Math.ceil(n / cols) !== rows) continue
    out.push({ cols, rows })
  }
  return out
}

function cellAreaOf(cols: number, rows: number, w: number, h: number): number {
  const cellW = Math.min(w / cols, (h / rows) * ASPECT)
  return cellW * (cellW / ASPECT)
}

describe('computeAutoLayout — the block, and where the black goes', () => {
  it('returns zeros for no tiles or an empty container', () => {
    const zero: AutoLayout = { cols: 0, rows: 0, cellW: 0, cellH: 0, wallW: 0, wallH: 0 }
    expect(computeAutoLayout(0, 400, 400)).toEqual(zero)
    expect(computeAutoLayout(4, 0, 400)).toEqual(zero)
  })

  it('uses a single column/row for one tile', () => {
    const l = computeAutoLayout(1, 400, 400)
    expect(l.cols).toBe(1)
    expect(l.rows).toBe(1)
    expect(l.cellW).toBeCloseTo(400)
    expect(l.cellH).toBeCloseTo(225) // 400 / (16/9)
  })

  it('picks 2×2 for four tiles in a square container (max area)', () => {
    const l = computeAutoLayout(4, 400, 400)
    expect(l.cols).toBe(2)
    expect(l.rows).toBe(2)
    expect(l.cellW).toBeCloseTo(200)
    expect(l.cellH).toBeCloseTo(112.5)
  })

  it('prefers a single column for two tiles in a square container', () => {
    const l = computeAutoLayout(2, 400, 400)
    expect(l.cols).toBe(1)
    expect(l.rows).toBe(2)
  })

  /**
   * THE REPORTED CASE. Two cameras in portrait stack into one column, and the
   * block they form is exactly two cells tall — so the only place the leftover
   * height can go is above and below it. A layout that published no block, or a
   * block taller than its cells, is what let the renderer put black in between.
   */
  it('stacks two portrait cameras into one CONTIGUOUS column', () => {
    const l = computeAutoLayout(2, 390, 780)
    expect(l.cols).toBe(1)
    expect(l.rows).toBe(2)
    expect(l.cellW).toBeCloseTo(390)
    expect(l.wallW).toBeCloseTo(390)
    // Two cells and nothing else: no gap is expressible inside the block.
    expect(l.wallH).toBeCloseTo(l.cellH * 2)
    expect(l.wallH).toBeLessThanOrEqual(780)
    // …and the leftover is a real band at the edges, not a rounding artefact.
    expect(780 - l.wallH).toBeGreaterThan(0)
  })

  it('lays two landscape cameras side by side', () => {
    const l = computeAutoLayout(2, 844, 390)
    expect(l.cols).toBe(2)
    expect(l.rows).toBe(1)
    expect(l.wallW).toBeCloseTo(l.cellW * 2)
    expect(l.wallH).toBeCloseTo(l.cellH)
  })

  /** The split matrix, per viewport × camera count. Recomputing the expected
   *  cols/rows here would just be the implementation twice, so the table states
   *  them and the invariant block below proves they are the area-maximal ones. */
  const EXPECTED: Readonly<Record<string, Readonly<Record<number, readonly [number, number]>>>> = {
    // [cols, rows]
    'iPhone portrait': { 1: [1, 1], 2: [1, 2], 3: [1, 3], 4: [1, 4], 5: [1, 5], 9: [2, 5] },
    'iPhone landscape': { 1: [1, 1], 2: [2, 1], 3: [2, 2], 4: [2, 2], 5: [3, 2], 9: [3, 3] },
    'iPad portrait': { 1: [1, 1], 2: [1, 2], 3: [1, 3], 4: [1, 4], 5: [1, 5], 9: [2, 5] },
    // Two cameras STACK here: the box is 1180×820, so one column gives 729pt
    // cells against 104pt side by side. Tall boxes stack, wide boxes spread —
    // both are the same rule, not a special case.
    'iPad landscape': { 1: [1, 1], 2: [1, 2], 3: [2, 2], 4: [2, 2], 5: [2, 3], 9: [3, 3] },
    'iPad landscape + timeline': { 1: [1, 1], 2: [2, 1], 3: [2, 2], 4: [2, 2], 5: [3, 2], 9: [3, 3] },
    desktop: { 1: [1, 1], 2: [2, 1], 3: [2, 2], 4: [2, 2], 5: [3, 2], 9: [3, 3] },
  }

  for (const vp of VIEWPORTS) {
    for (const n of COUNTS) {
      it(`${vp.name} · ${n} cameras`, () => {
        const l = computeAutoLayout(n, vp.w, vp.h)
        const [cols, rows] = EXPECTED[vp.name]?.[n] ?? [0, 0]
        expect([l.cols, l.rows]).toEqual([cols, rows])

        // 16:9 cells.
        expect(l.cellW / l.cellH).toBeCloseTo(ASPECT)
        // The block is exactly its cells — nothing between them.
        expect(l.wallW).toBeCloseTo(l.cols * l.cellW)
        expect(l.wallH).toBeCloseTo(l.rows * l.cellH)
        // …and it fits, so the leftover is a border the renderer can centre.
        expect(l.wallW).toBeLessThanOrEqual(vp.w + 1e-9)
        expect(l.wallH).toBeLessThanOrEqual(vp.h + 1e-9)
        // Every tile has a slot, and no row/column is emptier than it must be.
        expect(l.cols * l.rows).toBeGreaterThanOrEqual(n)
        expect(l.cols).toBe(Math.ceil(n / l.rows))
        expect(l.rows).toBe(Math.ceil(n / l.cols))

        // AREA-MAXIMAL over the canonical set (the promise the docstring makes).
        const best = Math.max(
          ...canonicalSplits(n).map((c) => cellAreaOf(c.cols, c.rows, vp.w, vp.h)),
        )
        expect(l.cellW * l.cellH).toBeCloseTo(best, 6)
      })
    }
  }

  it('never chooses a column count wider than the row it fills', () => {
    // 5 tiles in 4 columns is 4 + 1: the same cell size as 3 + 2 whenever the
    // height is the binding constraint, with a lone tile and a hole beside it.
    // The old candidate set contained it; the canonical one cannot express it.
    for (const vp of VIEWPORTS) {
      const l = computeAutoLayout(5, vp.w, vp.h)
      expect(l.cols).not.toBe(4)
    }
  })
})

describe('computeGridLayout — a forced column count', () => {
  it("delegates to auto for 'auto' or a non-positive column count", () => {
    expect(computeGridLayout(2, 400, 400, 'auto')).toEqual(computeAutoLayout(2, 400, 400))
    expect(computeGridLayout(4, 400, 400, 0)).toEqual(computeAutoLayout(4, 400, 400))
  })

  it('forces the requested column count', () => {
    const l = computeGridLayout(4, 400, 400, 2)
    expect(l.cols).toBe(2)
    expect(l.rows).toBe(2)
    expect(l.cellW).toBeCloseTo(200)
    expect(l.cellH).toBeCloseTo(112.5)
    expect(l.wallW).toBeCloseTo(400)
    expect(l.wallH).toBeCloseTo(225)
  })

  it('uses one row when columns meet or exceed the tile count', () => {
    const l = computeGridLayout(2, 600, 400, 3)
    expect(l.cols).toBe(3)
    expect(l.rows).toBe(1)
    // The block is what the TILES occupy, not what was asked for: a third
    // column nobody fills would push the two real cells off centre.
    expect(l.wallW).toBeCloseTo(l.cellW * 2)
  })

  it('returns zeros for no tiles or an empty container even with fixed columns', () => {
    const zero: AutoLayout = { cols: 0, rows: 0, cellW: 0, cellH: 0, wallW: 0, wallH: 0 }
    expect(computeGridLayout(0, 400, 400, 3)).toEqual(zero)
    expect(computeGridLayout(4, 0, 400, 3)).toEqual(zero)
  })
})

describe('splitIntoRows', () => {
  it('fills each row before the next and leaves the last one partial', () => {
    expect(splitIntoRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(splitIntoRows([1, 2, 3], 3)).toEqual([[1, 2, 3]])
    expect(splitIntoRows([1, 2], 5)).toEqual([[1, 2]])
  })

  it('degrades to a single row rather than looping forever on a bad column count', () => {
    expect(splitIntoRows([1, 2], 0)).toEqual([[1, 2]])
    expect(splitIntoRows([1, 2], -3)).toEqual([[1, 2]])
  })

  it('has no rows at all for no tiles', () => {
    expect(splitIntoRows([], 3)).toEqual([])
  })
})
