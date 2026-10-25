import { describe, it, expect } from 'vitest'
import {
  clampZoom,
  panLimit,
  clampPan,
  zoomBy,
  containBox,
  panExtent,
  clampPanContent,
  resolvePanActivation,
  PAN_MIN_DISTANCE,
  MIN_ZOOM,
  MAX_ZOOM,
} from '../zoom-math.js'

describe('clampZoom', () => {
  it('clamps into [MIN_ZOOM, MAX_ZOOM]', () => {
    expect(clampZoom(0.2)).toBe(MIN_ZOOM)
    expect(clampZoom(2)).toBe(2)
    expect(clampZoom(99)).toBe(MAX_ZOOM)
  })
  it('defends against non-finite input', () => {
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM)
  })
})

describe('panLimit', () => {
  it('is 0 at 1× (no pan room)', () => {
    expect(panLimit(300, 1)).toBe(0)
  })
  it('grows with scale: size*(scale-1)/2', () => {
    expect(panLimit(300, 2)).toBe(150)
    expect(panLimit(300, 3)).toBe(300)
  })
  it('is 0 for a degenerate size', () => {
    expect(panLimit(0, 3)).toBe(0)
    expect(panLimit(-10, 3)).toBe(0)
  })
})

describe('clampPan', () => {
  it('pins pan within ±panLimit', () => {
    expect(clampPan(500, 300, 2)).toBe(150)
    expect(clampPan(-500, 300, 2)).toBe(-150)
    expect(clampPan(40, 300, 2)).toBe(40)
  })
  it('forces 0 at 1× (no room)', () => {
    expect(clampPan(40, 300, 1)).toBe(0)
  })
})

describe('zoomBy', () => {
  it('multiplies and clamps', () => {
    expect(zoomBy(1, 1.1)).toBeCloseTo(1.1, 10)
    expect(zoomBy(1, 0.5)).toBe(MIN_ZOOM)
    expect(zoomBy(3.8, 1.2)).toBe(MAX_ZOOM)
  })
})

describe('containBox (contentFit: contain letterbox)', () => {
  it('16:9 content in a square box fills width, letterboxes height', () => {
    const box = containBox(400, 400, 16 / 9)
    expect(box.width).toBeCloseTo(400, 6)
    expect(box.height).toBeCloseTo(225, 6)
  })
  it('9:16 content in a square box fills height, letterboxes width', () => {
    const box = containBox(400, 400, 9 / 16)
    expect(box.width).toBeCloseTo(225, 6)
    expect(box.height).toBeCloseTo(400, 6)
  })
  it('falls back to the container box when the aspect is unknown', () => {
    expect(containBox(400, 300, 0)).toEqual({ width: 400, height: 300 })
    expect(containBox(400, 300, Number.NaN)).toEqual({ width: 400, height: 300 })
  })
})

describe('panExtent — content-box aware (matches embed zoom-clamp)', () => {
  it('S=1 pins pan to 0 on every axis', () => {
    expect(panExtent(400, 400, 1)).toBe(0)
    expect(panExtent(400, 225, 1)).toBe(0)
  })
  it('filled axis reaches the frame edge: (S·dim − dim)/2', () => {
    expect(panExtent(400, 400, 2)).toBe(200)
  })
  it('letterboxed axis uses the CONTENT box, not the container box', () => {
    // 16:9 content (height 225) in a 400 square, 2× → (2*225 − 400)/2 = 25,
    // NOT the container-ref (2*400 − 400)/2 = 200 which would expose black.
    expect(panExtent(400, 225, 2)).toBe(25)
  })
  it('scaled content still smaller than container → 0 (stay centered)', () => {
    expect(panExtent(400, 225, 1.5)).toBe(0)
  })
  it('clamps scale into range before computing', () => {
    // scale 99 → MAX_ZOOM (4): (4*400 − 400)/2 = 600.
    expect(panExtent(400, 400, 99)).toBe(600)
  })
})

describe('clampPanContent', () => {
  it('pins within ±panExtent using the content box', () => {
    expect(clampPanContent(500, 400, 225, 2)).toBe(25)
    expect(clampPanContent(-500, 400, 225, 2)).toBe(-25)
    expect(clampPanContent(10, 400, 400, 2)).toBe(10)
  })
  it('never leaves a gutter: at the extent the content edge meets the box edge', () => {
    const lim = panExtent(400, 225, 3) // (3*225 − 400)/2 = 137.5
    const contentTopAtLimit = 400 / 2 - (3 * 225) / 2 + lim
    expect(contentTopAtLimit).toBe(0)
  })
  it('defends against non-finite pan', () => {
    expect(clampPanContent(Number.NaN, 400, 400, 2)).toBe(0)
  })
})

describe('resolvePanActivation', () => {
  it('FAILS at 1× so the host scroll view gets the touch', () => {
    expect(resolvePanActivation({ scale: MIN_ZOOM, dx: 40, dy: 40 })).toBe('fail')
    expect(resolvePanActivation({ scale: 0.5, dx: 40, dy: 40 })).toBe('fail')
  })
  it('waits below PAN_MIN_DISTANCE when zoomed, then activates', () => {
    const below = PAN_MIN_DISTANCE / 2
    expect(resolvePanActivation({ scale: 2, dx: below, dy: 0 })).toBe('wait')
    expect(resolvePanActivation({ scale: 2, dx: PAN_MIN_DISTANCE, dy: 0 })).toBe('activate')
    // Diagonal travel counts as travel — the threshold is a distance, not a per-axis box.
    expect(resolvePanActivation({ scale: 2, dx: PAN_MIN_DISTANCE, dy: PAN_MIN_DISTANCE })).toBe('activate')
  })
  it('fails at 1× BEFORE any travel is measured', () => {
    // Even zero travel is a failure: the decision must not depend on the
    // finger moving first, or the scroll view would wait for nothing.
    expect(resolvePanActivation({ scale: 1, dx: 0, dy: 0 })).toBe('fail')
  })
  it('defends against non-finite input', () => {
    expect(resolvePanActivation({ scale: Number.NaN, dx: 5, dy: 5 })).toBe('fail')
    expect(resolvePanActivation({ scale: 2, dx: Number.NaN, dy: 5 })).toBe('wait')
  })
})
