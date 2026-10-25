import { describe, it, expect } from 'vitest'
import {
  BASE_FONT_PX,
  DEFAULT_OVERLAY_SIZE,
  MAX_SCALE,
  OVERLAY_SIZE_MIN_SCALE,
  OVERLAY_SIZES,
  overlayScale,
  parseOverlaySize,
  scaleStyle,
  videoRectIn,
} from '../overlay-size.js'

describe('overlay size level', () => {
  it('defaults to medium', () => {
    expect(DEFAULT_OVERLAY_SIZE).toBe('medium')
    expect(parseOverlaySize(undefined)).toBe('medium')
    expect(parseOverlaySize('huge')).toBe('medium')
    expect(parseOverlaySize(3)).toBe('medium')
  })

  it('keeps every valid level', () => {
    for (const s of OVERLAY_SIZES) expect(parseOverlaySize(s)).toBe(s)
  })
})

describe('videoRectIn — where the picture is', () => {
  it('is the whole box for cover (the crop is the picture)', () => {
    expect(videoRectIn({ width: 390, height: 219 }, 'cover')).toEqual({
      x: 0,
      y: 0,
      width: 390,
      height: 219,
    })
  })

  it('pillarboxes a 16:9 picture in a wide landscape window', () => {
    // 932x430 phone landscape: 2.17:1 box, 16:9 picture — bars left and right.
    const r = videoRectIn({ width: 932, height: 430 }, 'contain')
    expect(r.height).toBe(430)
    expect(r.width).toBeCloseTo(430 * (16 / 9), 5)
    expect(r.x).toBeCloseTo((932 - r.width) / 2, 5)
    expect(r.y).toBe(0)
  })

  it('letterboxes a 16:9 picture in a tall box', () => {
    const r = videoRectIn({ width: 390, height: 800 }, 'contain')
    expect(r.width).toBe(390)
    expect(r.height).toBeCloseTo(390 / (16 / 9), 5)
    expect(r.y).toBeCloseTo((800 - r.height) / 2, 5)
    expect(r.x).toBe(0)
  })

  it('follows the stream aspect when it is not 16:9', () => {
    const r = videoRectIn({ width: 400, height: 400 }, 'contain', 4 / 3)
    expect(r.width).toBe(400)
    expect(r.height).toBeCloseTo(300, 5)
    expect(r.y).toBeCloseTo(50, 5)
  })

  it('is the whole box before layout lands', () => {
    expect(videoRectIn({ width: 0, height: 0 }, 'contain')).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(videoRectIn({ width: 300, height: 200 }, 'contain', 0)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    })
  })
})

describe('overlayScale — a share of the PICTURE width', () => {
  // 2026-10-16: every size moved one step down (operator: overlays still too
  // large) — medium on a phone-portrait picture is what small used to be.
  it('is ~0.64 for medium on a phone-portrait picture', () => {
    expect(overlayScale(390, 'medium')).toBeCloseTo((390 * 0.018) / BASE_FONT_PX, 5)
    expect(overlayScale(390, 'medium')).toBeGreaterThan(0.6)
    expect(overlayScale(390, 'medium')).toBeLessThan(0.7)
  })

  it('orders small < medium < large on the same picture', () => {
    expect(overlayScale(600, 'small')).toBeLessThan(overlayScale(600, 'medium'))
    expect(overlayScale(600, 'medium')).toBeLessThan(overlayScale(600, 'large'))
  })

  it('grows with the picture, not the box: a letterboxed picture scales with its own width', () => {
    const fullscreenBox = { width: 932, height: 430 }
    const picture = videoRectIn(fullscreenBox, 'contain')
    expect(overlayScale(picture.width, 'medium')).toBeLessThan(overlayScale(fullscreenBox.width, 'medium'))
    expect(overlayScale(picture.width, 'medium')).toBeGreaterThan(overlayScale(390, 'medium'))
  })

  it('never shrinks below legible nor grows into a banner', () => {
    expect(overlayScale(120, 'small')).toBe(OVERLAY_SIZE_MIN_SCALE.small)
    expect(overlayScale(4000, 'large')).toBe(MAX_SCALE)
  })

  it('is 1 when the picture is not measured', () => {
    expect(overlayScale(0, 'large')).toBe(1)
    expect(overlayScale(Number.NaN, 'large')).toBe(1)
  })
})

describe('scaleStyle', () => {
  it('multiplies dimensions only and returns a new object', () => {
    const base = {
      fontSize: 10,
      paddingHorizontal: 8,
      gap: 4,
      borderRadius: 6,
      maxWidth: '100%',
      opacity: 0.5,
      fontWeight: '700',
      backgroundColor: '#000',
      top: 8,
    }
    const scaled = scaleStyle(base, 2)
    expect(scaled).toEqual({
      fontSize: 20,
      paddingHorizontal: 16,
      gap: 8,
      borderRadius: 12,
      maxWidth: '100%',
      opacity: 0.5,
      fontWeight: '700',
      backgroundColor: '#000',
      top: 8,
    })
    expect(base.fontSize).toBe(10)
  })

  it('returns the same style at scale 1', () => {
    const base = { fontSize: 11 }
    expect(scaleStyle(base, 1)).toBe(base)
  })
})
