import { describe, it, expect } from 'vitest'
import { clampPan, streamPanExtent } from '../stream-zoom-clamp.js'

/**
 * The video renders `object-fit: contain`, so it does NOT fill its wrapper.
 * The old clamp used the ELEMENT box (`w*(s-1)/2`), which lets a drag run into
 * the black bars on one axis and stop short of the picture on the other — the
 * operator's "at full zoom the sides are locked" (2026-07-30).
 */
describe('streamPanExtent — contain-aware pan bounds', () => {
  it('is zero at 1x (nothing to pan)', () => {
    expect(streamPanExtent(400, 300, 16 / 9, 1).x).toBe(0)
    expect(streamPanExtent(400, 300, 16 / 9, 1).y).toBe(0)
  })

  it('LETTERBOX (container taller than the video): vertical extent is SMALLER than the box formula', () => {
    // 400x400 box, 16:9 content → rendered 400x225, bars top/bottom.
    const { y } = streamPanExtent(400, 400, 16 / 9, 2)
    const boxFormula = (400 * (2 - 1)) / 2
    expect(y).toBeLessThan(boxFormula)
    // Exactly (2*225 - 400)/2 = 25.
    expect(y).toBeCloseTo(25, 5)
  })

  it('PILLARBOX (container wider than the video): horizontal extent is SMALLER than the box formula', () => {
    // 800x300 box, 16:9 content → rendered 533.33x300, bars left/right.
    const { x } = streamPanExtent(800, 300, 16 / 9, 2)
    expect(x).toBeLessThan((800 * (2 - 1)) / 2)
    expect(x).toBeCloseTo((2 * (300 * (16 / 9)) - 800) / 2, 5)
  })

  it('the axis that FILLS the box matches the box formula exactly', () => {
    // 400x400 with 16:9 → width fills (400), so x is the plain box extent.
    expect(streamPanExtent(400, 400, 16 / 9, 3).x).toBeCloseTo((400 * (3 - 1)) / 2, 5)
  })

  it('degrades to the element box when the aspect is unknown', () => {
    const { x, y } = streamPanExtent(400, 300, 0, 2)
    expect(x).toBeCloseTo((400 * (2 - 1)) / 2, 5)
    expect(y).toBeCloseTo((300 * (2 - 1)) / 2, 5)
  })
})

/**
 * The wrapper's FIT is not always `contain`, and assuming it cost the operator
 * two rounds of "I still cannot navigate the whole stream when zoomed in".
 *
 * Their own log line, portrait with the stream panel pinch-grown to its max:
 *
 *   viewportW=430 viewportH=466 contentAspect=1.78 scale=2.82
 *   panExtentX=391 panExtentY=108
 *
 * Those are the CONTAIN numbers — content 430x242 letterboxed in a 430x466
 * box. But in that layout the wrapper is `videoCoverStyle`, chosen precisely so
 * "the video fills a pinch-grown box with no internal black bars": the rendered
 * content is 828x466, cropped at the sides. Clamping against the contain box
 * therefore stops the pan at roughly a QUARTER of the reachable picture
 * vertically.
 *
 * In fill / wide the wrapper IS absolute-fill and the video does contain, which
 * is why landscape behaved correctly and portrait did not — exactly as reported.
 */
describe('fit-aware pan extents', () => {
  const W = 430
  const H = 466
  const ASPECT = 16 / 9
  const SCALE = 2.82

  it('reproduces the operator log under `contain`', () => {
    const { x, y } = streamPanExtent(W, H, ASPECT, SCALE, 'contain')
    expect(Math.round(x)).toBe(391)
    expect(Math.round(y)).toBe(108)
  })

  it('gives the reachable extents under `cover` — the real portrait geometry', () => {
    const { x, y } = streamPanExtent(W, H, ASPECT, SCALE, 'cover')
    expect(Math.round(x)).toBe(953)
    expect(Math.round(y)).toBe(424)
  })

  it('cover is never TIGHTER than contain — it can only unlock travel', () => {
    for (const s of [1, 1.5, 2, 3, 4]) {
      const c = streamPanExtent(W, H, ASPECT, s, 'contain')
      const o = streamPanExtent(W, H, ASPECT, s, 'cover')
      expect(o.x).toBeGreaterThanOrEqual(c.x)
      expect(o.y).toBeGreaterThanOrEqual(c.y)
    }
  })

  it('at scale 1 nothing pans, whatever the fit — no drift on an unzoomed view', () => {
    expect(streamPanExtent(W, H, ASPECT, 1, 'contain')).toEqual({ x: 0, y: 0 })
    const o = streamPanExtent(W, H, ASPECT, 1, 'cover')
    // Cover already overflows the box at scale 1: that overflow IS reachable.
    expect(o.x).toBeGreaterThan(0)
    expect(o.y).toBe(0)
  })

  it('defaults to contain, so an un-migrated caller is unchanged', () => {
    expect(streamPanExtent(W, H, ASPECT, SCALE)).toEqual(
      streamPanExtent(W, H, ASPECT, SCALE, 'contain'),
    )
  })
})

/**
 * The pinch clamps against the viewport FROZEN at its start (so the box that
 * grows under the fingers cannot move the limits mid-gesture), which means a
 * pinch-OUT ends with a pan committed against a box that no longer exists: the
 * operator's log read `panExtentX: 131, tx: 198` and the picture sat 67pt past
 * its own edge, black on the left. `clampPan` is the settle step: the
 * committed pan re-limited against the viewport as it IS.
 */
describe('clampPan — settle a committed pan against the live viewport', () => {
  it('pulls a pan that overshoots the live extent back onto the edge', () => {
    // 430x292 cover box, 16:9 → cover width 519.1; at 1.33x the extent is ~130.
    const { x, y } = clampPan({ tx: 198, ty: -39, w: 430, h: 292, aspect: 16 / 9, scale: 1.33, fit: 'cover' })
    const lim = streamPanExtent(430, 292, 16 / 9, 1.33, 'cover')
    expect(x).toBeCloseTo(lim.x, 5)
    expect(Math.abs(y)).toBeLessThanOrEqual(lim.y)
    expect(y).toBeCloseTo(-39, 5)
  })

  it('leaves a pan inside the extent untouched', () => {
    const { x, y } = clampPan({ tx: 50, ty: -10, w: 430, h: 466, aspect: 16 / 9, scale: 3, fit: 'cover' })
    expect(x).toBe(50)
    expect(y).toBe(-10)
  })

  it('recentres at 1x, where nothing can be panned', () => {
    const { x, y } = clampPan({ tx: 170, ty: 3, w: 430, h: 244, aspect: 16 / 9, scale: 1, fit: 'cover' })
    expect(x).toBe(0)
    expect(y).toBe(0)
  })
})
