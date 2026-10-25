/**
 * The poster's fit.
 *
 * The regression: `StreamPoster` hard-coded `contentFit="cover"`. In `fill` its
 * box is the WHOLE WINDOW (932×430 ≈ 2.17:1) while the snapshot is 16:9, so the
 * still was blown up to full bleed — then the video started, letterboxed itself
 * inside the same box, and the picture visibly jumped.
 */
import { describe, it, expect } from 'vitest'
import { resolvePosterFit, STREAM_ASPECT } from '../poster-fit.js'

describe('resolvePosterFit', () => {
  it('a full-window landscape box CONTAINS — this is the reported jump', () => {
    expect(resolvePosterFit(932, 430)).toBe('contain')
    expect(resolvePosterFit(844, 390)).toBe('contain')
  })

  it('a 16:9 box covers — the portrait stack and the grid tile are unchanged', () => {
    expect(resolvePosterFit(390, 390 / STREAM_ASPECT)).toBe('cover')
    expect(resolvePosterFit(1920, 1080)).toBe('cover')
  })

  it('rounding to whole points does not flip a 16:9 box to contain', () => {
    // 390/219 = 1.781 vs 1.777 — a hairline letterbox where there is nothing
    // to letterbox would be a visible seam, not a fix.
    expect(resolvePosterFit(390, 219)).toBe('cover')
    expect(resolvePosterFit(431, 242)).toBe('cover')
  })

  it('a portrait-shaped box contains', () => {
    expect(resolvePosterFit(430, 932)).toBe('contain')
  })

  it('the wide rail column, which is sized 16:9, covers', () => {
    expect(resolvePosterFit(814, 458)).toBe('cover')
  })

  it('an unmeasured box keeps the historical cover, never a letterboxed flash', () => {
    for (const [w, h] of [
      [0, 0],
      [0, 430],
      [932, 0],
      [Number.NaN, 430],
      [-1, 430],
    ] as const) {
      expect(resolvePosterFit(w, h)).toBe('cover')
    }
  })
})
