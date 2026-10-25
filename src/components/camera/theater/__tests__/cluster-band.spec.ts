/**
 * The card's band.
 *
 * The regression: inside the landscape drawer the card was 60% of the BODY, so
 * it ended ~99pt short of a 317pt drawer's edge and left a black column in
 * which only the thin activity strips rendered. Portrait must be untouched.
 */
import { describe, it, expect } from 'vitest'
import { resolveClusterBand } from '../cluster-band.js'

/** The real reserves: SPACING.md + TICK_LABEL_WIDTH + SPACING.sm = 50 left,
 *  LANES_RESERVE_PX = 66 right (the lanes got room — `timeline-lanes-layout.ts`). */
const LEFT = 50
const RIGHT = 66

describe('resolveClusterBand — compact (the landscape drawer)', () => {
  // 932pt window → drawerWidth 317; the content the scroller measures.
  const scrollWidth = 317

  it('fills the band, so the card reaches the activity strips', () => {
    const b = resolveClusterBand({
      scrollWidth,
      leftReserve: LEFT,
      rightReserve: RIGHT,
      preferredWidth: Math.round(scrollWidth * 0.6),
      compact: true,
    })
    expect(b.left).toBe(LEFT)
    expect(b.width).toBe(scrollWidth - LEFT - RIGHT)
    // The gap the operator saw: card right edge → content edge, was 99pt.
    expect(scrollWidth - (b.left + b.width)).toBe(RIGHT)
  })

  it('the preference cannot shrink a compact card back into the gap', () => {
    const tiny = resolveClusterBand({
      scrollWidth,
      leftReserve: LEFT,
      rightReserve: RIGHT,
      preferredWidth: 40,
      compact: true,
    })
    expect(tiny.width).toBe(scrollWidth - LEFT - RIGHT)
  })
})

describe('resolveClusterBand — roomy (portrait, unchanged)', () => {
  const scrollWidth = 390

  it('centres the preferred width in the band, exactly as before', () => {
    const preferredWidth = Math.round(scrollWidth * 0.6) // 234
    const b = resolveClusterBand({
      scrollWidth,
      leftReserve: LEFT,
      rightReserve: RIGHT,
      preferredWidth,
      compact: false,
    })
    const band = scrollWidth - LEFT - RIGHT // 274
    expect(b.width).toBe(preferredWidth)
    expect(b.left).toBe(LEFT + (band - preferredWidth) / 2)
  })

  it('never overflows the band even if the preference asks for more', () => {
    const b = resolveClusterBand({
      scrollWidth,
      leftReserve: LEFT,
      rightReserve: RIGHT,
      preferredWidth: 10_000,
      compact: false,
    })
    expect(b.width).toBe(scrollWidth - LEFT - RIGHT)
    expect(b.left).toBe(LEFT)
  })
})

describe('resolveClusterBand — degenerate input', () => {
  it('an unmeasured scroller yields a zero-width card at the left reserve', () => {
    const b = resolveClusterBand({
      scrollWidth: 0,
      leftReserve: LEFT,
      rightReserve: RIGHT,
      preferredWidth: 200,
      compact: false,
    })
    expect(b).toEqual({ left: LEFT, width: 0 })
  })

  it('reserves wider than the container never produce a negative width', () => {
    for (const compact of [true, false]) {
      const b = resolveClusterBand({
        scrollWidth: 40,
        leftReserve: LEFT,
        rightReserve: RIGHT,
        preferredWidth: 100,
        compact,
      })
      expect(b.width).toBe(0)
    }
  })
})
