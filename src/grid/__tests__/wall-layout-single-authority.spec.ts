import { describe, expect, it } from 'vitest'
import { computeGridLayout as viewerLayout, splitIntoRows as viewerRows } from '../auto-layout'
import {
  computeGridLayout as embedLayout,
  splitIntoRows as embedRows,
} from '../../../embed/src/embed/grid-layout'

/**
 * The native wall and the hosted wall must arrange tiles IDENTICALLY.
 *
 * They cannot share a module: the embed is a separate bundle with no access to
 * `src/`, and its own header says so. What it also says is that
 * "`__tests__/grid-layout.spec.ts` holds the same case matrix so the two cannot
 * drift apart silently" — two hand-maintained matrices, which is the drift, not
 * the guard against it. Nothing failed when one of them was extended.
 *
 * A test is not a bundle. Both modules are TypeScript in this repo, so this
 * runs them side by side over the cases an operator actually produces and
 * requires the SAME answer. Adding a case here covers both by construction.
 */
const TILE_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 16]
/** Portrait phone, landscape phone, tablet, the stacked box, a desktop panel. */
const BOXES: readonly (readonly [number, number])[] = [
  [390, 700],
  [844, 390],
  [1024, 768],
  [390, 220],
  [1440, 900],
]

describe('the native wall and the hosted wall agree', () => {
  it('computes the same auto arrangement for every tile count and box', () => {
    for (const n of TILE_COUNTS) {
      for (const [w, h] of BOXES) {
        const a = viewerLayout(n, w, h, 'auto')
        const b = embedLayout(n, w, h, 'auto')
        const where = `n=${n} box=${w}x${h}`
        expect(b.cols, where).toBe(a.cols)
        expect(b.rows, where).toBe(a.rows)
        expect(b.cellW, where).toBeCloseTo(a.cellW, 6)
        expect(b.cellH, where).toBeCloseTo(a.cellH, 6)
        expect(b.wallW, where).toBeCloseTo(a.wallW, 6)
        expect(b.wallH, where).toBeCloseTo(a.wallH, 6)
      }
    }
  })

  it('agrees on a FORCED column count too', () => {
    for (const cols of [1, 2, 3, 4]) {
      for (const n of TILE_COUNTS) {
        const a = viewerLayout(n, 1024, 768, cols)
        const b = embedLayout(n, 1024, 768, cols)
        const where = `n=${n} cols=${cols}`
        expect(b.cols, where).toBe(a.cols)
        expect(b.rows, where).toBe(a.rows)
        expect(b.wallW, where).toBeCloseTo(a.wallW, 6)
        expect(b.wallH, where).toBeCloseTo(a.wallH, 6)
      }
    }
  })

  it('agrees on a degenerate box rather than each inventing a fallback', () => {
    for (const [n, w, h] of [
      [0, 800, 600],
      [4, 0, 600],
      [4, 800, 0],
    ] as const) {
      const a = viewerLayout(n, w, h, 'auto')
      const b = embedLayout(n, w, h, 'auto')
      expect({ ...b }).toEqual({ ...a })
    }
  })

  it('splits tiles into the same rows', () => {
    const tiles = [1, 2, 3, 4, 5, 6, 7]
    for (const cols of [0, 1, 2, 3, 4, 8]) {
      expect(embedRows(tiles, cols)).toEqual(viewerRows(tiles, cols).map((r) => [...r]))
    }
  })
})
