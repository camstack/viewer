import { describe, expect, it } from 'vitest'
import { cardEdgePx, reelRowHeightPx, thumbEdgeForCardPx, thumbEdgePx } from '../events-config'
import {
  REEL_FIT_MIN_WIDTH_PX,
  REEL_MAX_EDGE_PX,
  reelCardGeometry,
} from '../../../../shared/events/events-reel-geometry'

const GAP = 8
const PAD = 10

function geometry(width: number, height: number, rows = 1, preset = cardEdgePx('medium')) {
  return reelCardGeometry({
    viewportWidth: width,
    viewportHeight: height,
    rows,
    presetEdge: preset,
    gap: GAP,
    padX: PAD,
  })
}

/** Where the column after the last WHOLE one starts — at or past the right
 *  edge means no partial card shows. */
function nextColumnStart(width: number, edge: number): number {
  const columns = Math.round((width - PAD - GAP + GAP) / (edge + GAP))
  return PAD + columns * (edge + GAP)
}

describe('reelCardGeometry — mobile keeps the preset', () => {
  it.each([320, 390, 430, REEL_FIT_MIN_WIDTH_PX - 1])('width %i → the preset edge', (w) => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const g = geometry(w, 800, 1, cardEdgePx(size))
      expect(g.edge).toBe(cardEdgePx(size))
      expect(g.cardHeight).toBe(cardEdgePx(size))
    }
  })

  it('an unmeasured box (0 × 0) is the preset', () => {
    expect(geometry(0, 0).edge).toBe(cardEdgePx('medium'))
  })
})

describe('reelCardGeometry — desktop fills the width', () => {
  it.each([1280, 1512, 1920])('width %i: whole columns end at the edge, no sliver', (w) => {
    const g = geometry(w, 300)
    const start = nextColumnStart(w, g.edge)
    expect(start).toBeGreaterThanOrEqual(w - 0.5)
    expect(start).toBeLessThanOrEqual(w + 1)
  })

  it.each([1280, 1512, 1920])('width %i in a tall box grows past the preset, bounded', (w) => {
    const g = geometry(w, 800)
    expect(g.edge).toBeGreaterThan(cardEdgePx('medium'))
    expect(g.edge).toBeLessThanOrEqual(REEL_MAX_EDGE_PX)
  })

  it('the card fits the box height for every stacked row (when the preset itself does)', () => {
    const preset = cardEdgePx('medium')
    for (const rows of [1, 2, 3]) {
      for (const height of [300, 500, 800]) {
        // A box too short for even the preset is the host's sizing error, and
        // the reel keeps the preset there exactly as it always has.
        if (rows * preset + (rows - 1) * GAP + 8 > height) continue
        const g = geometry(1512, height, rows)
        const used = rows * g.cardHeight + (rows - 1) * GAP + 8
        expect(used).toBeLessThanOrEqual(height)
      }
    }
  })

  it('inside the band a host reserved for the preset, it never outgrows the band', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const band = reelRowHeightPx(size)
      for (const w of [1280, 1512, 1920]) {
        const g = geometry(w, band, 1, cardEdgePx(size))
        expect(g.edge).toBeLessThanOrEqual(cardEdgePx(size))
        expect(g.cardHeight + 8).toBeLessThanOrEqual(band)
        const start = nextColumnStart(w, g.edge)
        expect(start).toBeGreaterThanOrEqual(w - 0.5)
      }
    }
  })
})

describe('thumbEdgeForCardPx', () => {
  it('agrees with the preset rule for a preset edge', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      for (const dpr of [1, 2, 3]) {
        expect(thumbEdgeForCardPx(cardEdgePx(size), dpr)).toBe(thumbEdgePx(size, dpr))
      }
    }
  })

  it('asks for a computed edge, clamped to the plane', () => {
    expect(thumbEdgeForCardPx(242.33, 1)).toBe(242)
    expect(thumbEdgeForCardPx(242.33, 2)).toBe(320)
  })
})
