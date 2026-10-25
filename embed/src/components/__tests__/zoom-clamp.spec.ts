import { describe, it, expect } from 'vitest'
import { containBox, panExtent, clampPan } from '../zoom-clamp'

describe('containBox (object-fit: contain letterbox)', () => {
  it('16:9 source in a square box fills width, letterboxes height', () => {
    // 400x400 box, 1920x1080 source → fit = 400/1920 → content 400 x 225.
    const box = containBox(400, 400, 1920, 1080)
    expect(box.width).toBeCloseTo(400, 6)
    expect(box.height).toBeCloseTo(225, 6)
  })
  it('9:16 source in a square box fills height, letterboxes width', () => {
    const box = containBox(400, 400, 1080, 1920)
    expect(box.width).toBeCloseTo(225, 6)
    expect(box.height).toBeCloseTo(400, 6)
  })
  it('matching aspect fills the box exactly', () => {
    const box = containBox(1600, 900, 1920, 1080)
    expect(box.width).toBeCloseTo(1600, 6)
    expect(box.height).toBeCloseTo(900, 6)
  })
  it('falls back to the container box when the intrinsic size is unknown', () => {
    expect(containBox(400, 300, 0, 0)).toEqual({ width: 400, height: 300 })
    expect(containBox(400, 300, Number.NaN, 100)).toEqual({ width: 400, height: 300 })
  })
})

describe('panExtent — (scale·contentDim − containerDim)/2, floored at 0', () => {
  it('S=1 pins pan to 0 (no gutter at rest)', () => {
    expect(panExtent(400, 400, 1)).toBe(0)
    // even a letterboxed axis has no room at 1×
    expect(panExtent(400, 225, 1)).toBe(0)
  })
  it('filled axis at S reaches (S·dim − dim)/2 — the full frame edge', () => {
    // content fills container (400) → 2× lets you reach ±200 (frame corner).
    expect(panExtent(400, 400, 2)).toBe(200)
    expect(panExtent(400, 400, 3)).toBe(400)
  })
  it('letterboxed axis uses the CONTENT box, not the container box', () => {
    // 16:9 in a 400 square: content height 225. At 2× the reachable offset is
    // (2*225 - 400)/2 = 25 — pins to the real picture edge, NOT the container
    // box which would (wrongly) allow (2*400-400)/2 = 200 and expose black.
    expect(panExtent(400, 225, 2)).toBe(25)
    expect(panExtent(400, 400, 2)).toBe(200) // (what the old container-ref clamp used)
  })
  it('scaled content still smaller than container → 0 (stay centered, no border)', () => {
    // content 225, at 1.5× → 337.5 < 400 → cannot cover, so no pan room.
    expect(panExtent(400, 225, 1.5)).toBe(0)
  })
  it('defends against non-finite input', () => {
    expect(panExtent(Number.NaN, 400, 2)).toBe(0)
    expect(panExtent(400, Number.POSITIVE_INFINITY, 2)).toBe(0)
  })
})

describe('clampPan', () => {
  it('pins a translate within ±panExtent', () => {
    expect(clampPan(500, 400, 400, 2)).toBe(200)
    expect(clampPan(-500, 400, 400, 2)).toBe(-200)
    expect(clampPan(40, 400, 400, 2)).toBe(40)
  })
  it('never leaves a gutter: at the extent the content edge meets the container edge', () => {
    // At the max offset, scaled-content edge == container edge (0 gap).
    const lim = panExtent(400, 400, 2) // 200
    // content top after transform: cy/2 - S*content/2 + pan = 200 - 400 + 200 = 0.
    const containerCenter = 400 / 2
    const contentTopAtLimit = containerCenter - (2 * 400) / 2 + lim
    expect(contentTopAtLimit).toBe(0) // exactly the container edge — no gutter
  })
  it('forces 0 at 1× (no pan room)', () => {
    expect(clampPan(40, 400, 400, 1)).toBe(0)
  })
  it('defends against non-finite pan', () => {
    expect(clampPan(Number.NaN, 400, 400, 2)).toBe(0)
  })
})
