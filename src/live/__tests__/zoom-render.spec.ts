import { describe, expect, it } from 'vitest'
import { foldGrowth, growBoxHeight } from '../zoom-render.js'
import { coverBox } from '../stream-zoom-clamp.js'

/**
 * The picture box may GROW with the zoom (`pinchExpandsHeight`), but the
 * player under it — a WKWebView on iOS — must never change frame under a
 * gesture: a frame change is a WebKit re-layout per frame, a transform is
 * composited. So the wrapper stays at its REST size (the 16:9 box at 1x) and
 * the growth is folded into the zoom transform: what the operator sees must
 * be exactly the cover box of the grown height, scaled by the pinch, centred
 * on the box — which is what a wrapper that really grew would have drawn.
 */
const WIDTH = 430
const REST = (WIDTH * 9) / 16 // 241.875
const ASPECT = 16 / 9

/** Where the rendered wrapper's edges land: centre-scaled, then translated. */
function renderedRect(t: { scale: number; tx: number; ty: number }) {
  const w = WIDTH * t.scale
  const h = REST * t.scale
  const cx = WIDTH / 2 + t.tx
  const cy = REST / 2 + t.ty
  return { left: cx - w / 2, top: cy - h / 2, width: w, height: h }
}

describe('foldGrowth', () => {
  it('is the plain zoom transform while the box is at rest', () => {
    expect(foldGrowth({ scale: 2.5, tx: 12, ty: -7, boxHeight: REST, restHeight: REST })).toEqual({
      scale: 2.5,
      tx: 12,
      ty: -7,
    })
  })

  it('draws EXACTLY the cover box of the grown height, scaled by the pinch, centred on the grown box', () => {
    for (const boxHeight of [300, 400, 466]) {
      for (const scale of [1, 1.7, 2.5, 4]) {
        const pan = { tx: 20, ty: -15 }
        const rect = renderedRect({ ...foldGrowth({ scale, ...pan, boxHeight, restHeight: REST }), })
        const cover = coverBox(WIDTH, boxHeight, ASPECT)
        expect(rect.width).toBeCloseTo(cover.width * scale, 6)
        expect(rect.height).toBeCloseTo(cover.height * scale, 6)
        // Centred on the BOX (height boxHeight, top at 0), plus the pan.
        expect(rect.left + rect.width / 2).toBeCloseTo(WIDTH / 2 + pan.tx, 6)
        expect(rect.top + rect.height / 2).toBeCloseTo(boxHeight / 2 + pan.ty, 6)
      }
    }
  })

  it('survives a degenerate rest height without poisoning the transform', () => {
    const t = foldGrowth({ scale: 2, tx: 0, ty: 0, boxHeight: 300, restHeight: 0 })
    expect(Number.isFinite(t.scale)).toBe(true)
    expect(Number.isFinite(t.ty)).toBe(true)
  })
})

describe('growBoxHeight', () => {
  const rule = { rest: REST, max: 466, growScale: 2.5 }

  it('is the rest height at 1x and the maximum from the grow scale up', () => {
    expect(growBoxHeight(1, rule)).toBeCloseTo(REST, 6)
    expect(growBoxHeight(2.5, rule)).toBeCloseTo(466, 6)
    expect(growBoxHeight(4, rule)).toBeCloseTo(466, 6)
  })

  it('grows monotonically between the two and never below rest', () => {
    let last = -1
    for (let s = 0.5; s <= 4; s += 0.1) {
      const h = growBoxHeight(s, rule)
      expect(h).toBeGreaterThanOrEqual(REST - 1e-9)
      expect(h).toBeGreaterThanOrEqual(last)
      last = h
    }
  })
})
