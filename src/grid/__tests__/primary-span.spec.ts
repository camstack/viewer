/**
 * `resolvePrimaryWallSpan` — the primary's share of a workspace wall.
 *
 * The claim that matters is not "the primary is bigger". It is that the wall it
 * asks for is a COMPLETE rectangle: every track covered exactly once, no hole
 * beside the big cell and no cell placed on top of another. So these specs do
 * not assert span numbers and stop — they replay the page's own placement rule
 * (`packSpans`, `embed/src/embed/grid-layout.ts`: first free block in reading
 * order) and check the resulting occupancy grid, for N = 2..9 at four aspect
 * ratios. A span that tiles under one box shape and holes under another is
 * exactly the defect this function is written to make impossible.
 */
import { describe, expect, it } from 'vitest'

import {
  computeAutoLayout,
  resolvePrimaryWallSpan,
  MIN_SECONDARY_AREA_FRACTION,
  type PrimaryWallSpan,
} from '../auto-layout.js'

/** Boxes the wall is actually drawn in. The first is the tablet column this
 *  feature exists for; the others are the shapes a rotation, a Split View and a
 *  wide browser window produce, because a rule that only holds at 16:9 is not a
 *  rule. */
const BOXES: readonly { readonly name: string; readonly w: number; readonly h: number }[] = [
  { name: 'tablet column 16:9', w: 1000, h: 562 },
  { name: 'tablet column, tall', w: 1000, h: 900 },
  { name: 'wide web window', w: 1600, h: 500 },
  { name: 'narrow portrait column', w: 600, h: 1000 },
]

const COUNTS = [2, 3, 4, 5, 6, 7, 8, 9] as const

/**
 * Replay the page's packing and return the occupancy of every track, or the
 * fault that made the wall invalid.
 *
 * `overlap` can only come from a placement bug; `hole` is the one this function
 * guards against — an unfilled track the page cannot centre away because a
 * spanned cell straddles the rows around it.
 */
type WallFault = 'overlap' | 'hole' | null

function packFault(n: number, plan: PrimaryWallSpan): WallFault {
  const { span, cols, rows } = plan
  // No span at all is the shipped wall, and its last row is allowed to be
  // partial: with no spanned cell straddling it the page centres it
  // (`computeTilePlacements`), which is a border and not a hole. Exactness is
  // demanded of the SPANNED walls, which are the ones this function invents.
  if (span <= 1) return null
  const taken = new Set<string>()
  const free = (row: number, col: number, cw: number, ch: number): boolean => {
    for (let r = row; r < row + ch; r++) {
      for (let c = col; c < col + cw; c++) if (taken.has(`${r}:${c}`)) return false
    }
    return true
  }
  // The primary first, then the others at 1×1 — the device order the host sends.
  for (let i = 0; i < n; i++) {
    const size = i === 0 ? span : 1
    let placed = false
    for (let row = 0; row <= rows + size && !placed; row++) {
      for (let col = 0; col + size <= cols; col++) {
        if (!free(row, col, size, size)) continue
        for (let r = row; r < row + size; r++) {
          for (let c = col; c < col + size; c++) {
            if (taken.has(`${r}:${c}`)) return 'overlap'
            taken.add(`${r}:${c}`)
          }
        }
        if (row + size > rows) return 'hole'
        placed = true
        break
      }
    }
    if (!placed) return 'hole'
  }
  return taken.size === cols * rows ? null : 'hole'
}

describe('every wall it asks for is a complete rectangle', () => {
  for (const box of BOXES) {
    for (const n of COUNTS) {
      it(`${n} cameras in the ${box.name} tile exactly`, () => {
        const plan = resolvePrimaryWallSpan(n, box.w, box.h)
        expect(packFault(n, plan)).toBeNull()
      })
    }
  }
})

describe('the span never makes the wall worse', () => {
  for (const box of BOXES) {
    for (const n of COUNTS) {
      it(`${n} cameras in the ${box.name}: primary grows, the others keep their floor`, () => {
        const plan = resolvePrimaryWallSpan(n, box.w, box.h)
        if (plan.span === 1) return
        const uniform = computeAutoLayout(n, box.w, box.h)
        const uniformArea = uniform.cellW * uniform.cellH
        const trackW = Math.min(box.w / plan.cols, ((box.h / plan.rows) * 16) / 9)
        const trackArea = (trackW * trackW) / (16 / 9)
        // Bigger than the cell it replaced — a span that buys nothing is churn.
        expect(trackArea * plan.span * plan.span).toBeGreaterThan(uniformArea)
        // …and the cameras it took the space from are still watchable.
        expect(trackArea).toBeGreaterThanOrEqual(uniformArea * MIN_SECONDARY_AREA_FRACTION)
      })
    }
  }
})

describe('the wall it plans fits the box it was measured in', () => {
  for (const box of BOXES) {
    for (const n of COUNTS) {
      it(`${n} cameras in the ${box.name} stay inside it`, () => {
        const plan = resolvePrimaryWallSpan(n, box.w, box.h)
        const trackW = Math.min(box.w / plan.cols, ((box.h / plan.rows) * 16) / 9)
        expect(plan.cols * trackW).toBeLessThanOrEqual(box.w + 1e-9)
        expect((plan.rows * trackW) / (16 / 9)).toBeLessThanOrEqual(box.h + 1e-9)
      })
    }
  }
})

describe('two cameras are equals', () => {
  /**
   * The one count where "the primary gets most of the space" is refused on
   * purpose. A 2×2 primary beside one other camera cannot tile a two-track wall
   * — and the arrangement it would take (the primary on top, one camera under
   * it at a quarter of the width) is not what anyone means by adding a second
   * camera to a view.
   */
  for (const box of BOXES) {
    it(`side by side in the ${box.name}`, () => {
      expect(resolvePrimaryWallSpan(2, box.w, box.h).span).toBe(1)
    })
  }
})

describe('the box it has not measured yet', () => {
  it('an unmeasured wall asks for nothing', () => {
    expect(resolvePrimaryWallSpan(4, 0, 0)).toEqual({ span: 1, cols: 0, rows: 0 })
  })

  it('a single camera is not a wall', () => {
    const plan = resolvePrimaryWallSpan(1, 1000, 562)
    expect(plan.span).toBe(1)
  })
})

describe('the standing example: three cameras on a tablet', () => {
  it('the primary takes two tracks each way and the other two stack beside it', () => {
    // A 16:9 box of three tracks by two: the primary occupies the left 2×2 and
    // the two others sit one above the other in the third column. That is the
    // biggest primary this box admits — and the arrangement the operator
    // described as "la maggior parte dello spazio".
    const plan = resolvePrimaryWallSpan(3, 1000, 562)
    expect(plan).toEqual({ span: 2, cols: 3, rows: 2 })
  })

  it('a taller column stacks it instead — the same span, a different wall', () => {
    // The same three cameras in a column that is not 16:9 tile the other way
    // round: 2×2 on top of a full row of two. The rule is the tiling, never a
    // hard-coded arrangement.
    expect(resolvePrimaryWallSpan(3, 1000, 900)).toEqual({ span: 2, cols: 2, rows: 3 })
  })
})

describe('a non-16:9 wall', () => {
  /** The aspect is an argument, and it changes which counts tile — so it must
   *  reach the arithmetic rather than being defaulted twice. */
  it('a 4:3 wall still tiles exactly', () => {
    for (const n of COUNTS) {
      const plan = resolvePrimaryWallSpan(n, 1000, 562, 4 / 3)
      expect(packFault(n, plan)).toBeNull()
    }
  })
})
