import { describe, expect, it } from 'vitest'
import { coverScale, doubleTapTarget } from '../double-tap-zoom'

describe('coverScale', () => {
  it('a 16:9 picture in a wider box (landscape phone) fills it by the width ratio', () => {
    // 19.5:9 box, 16:9 picture: pillarboxed; cover = (19.5/9) / (16/9).
    expect(coverScale({ viewportWidth: 844, viewportHeight: 390, contentAspect: 16 / 9, fit: 'contain' })).toBeCloseTo(
      844 / 390 / (16 / 9),
      6,
    )
  })

  it('a 16:9 picture in a taller box (portrait, 4:3) fills it by the height ratio', () => {
    expect(coverScale({ viewportWidth: 390, viewportHeight: 844, contentAspect: 16 / 9, fit: 'contain' })).toBeCloseTo(
      (16 / 9) / (390 / 844),
      6,
    )
    expect(coverScale({ viewportWidth: 1024, viewportHeight: 768, contentAspect: 16 / 9, fit: 'contain' })).toBeCloseTo(
      (16 / 9) / (4 / 3),
      6,
    )
  })

  it('a portrait picture in a landscape box is the same rule the other way round', () => {
    expect(coverScale({ viewportWidth: 1600, viewportHeight: 900, contentAspect: 9 / 16, fit: 'contain' })).toBeCloseTo(
      (16 / 9) / (9 / 16),
      6,
    )
  })

  it('equal aspects have nothing to fill: 1', () => {
    expect(coverScale({ viewportWidth: 1600, viewportHeight: 900, contentAspect: 16 / 9, fit: 'contain' })).toBeCloseTo(1, 9)
  })

  it('a box drawn cover-cropped already fills: 1', () => {
    expect(coverScale({ viewportWidth: 390, viewportHeight: 600, contentAspect: 16 / 9, fit: 'cover' })).toBe(1)
  })

  it('a size not measured yet never zooms', () => {
    expect(coverScale({ viewportWidth: 0, viewportHeight: 600, contentAspect: 16 / 9, fit: 'contain' })).toBe(1)
    expect(coverScale({ viewportWidth: 400, viewportHeight: 600, contentAspect: Number.NaN, fit: 'contain' })).toBe(1)
    expect(coverScale({ viewportWidth: 400, viewportHeight: 600, contentAspect: 0, fit: 'contain' })).toBe(1)
  })
})

describe('doubleTapTarget', () => {
  const base = { minScale: 1, maxScale: 4, fallbackStep: 2 }

  it('zoomed out → in to the cover scale', () => {
    expect(doubleTapTarget({ ...base, current: 1, cover: 1.22 })).toEqual({ kind: 'zoom', scale: 1.22 })
  })

  it('zoomed out with cover equal to fit → the fallback step', () => {
    expect(doubleTapTarget({ ...base, current: 1, cover: 1 })).toEqual({ kind: 'zoom', scale: 2 })
    expect(doubleTapTarget({ ...base, current: 1, cover: 1.005 })).toEqual({ kind: 'zoom', scale: 2 })
  })

  it('a cover scale past the top is clamped to it', () => {
    expect(doubleTapTarget({ ...base, current: 1, cover: 5.2 })).toEqual({ kind: 'zoom', scale: 4 })
  })

  it('zoomed in by any amount → back to fit, whatever the cover scale', () => {
    for (const current of [1.05, 1.22, 2, 2.6, 4]) {
      expect(doubleTapTarget({ ...base, current, cover: 1.22 })).toEqual({ kind: 'fit' })
      expect(doubleTapTarget({ ...base, current, cover: 1 })).toEqual({ kind: 'fit' })
    }
  })

  it('a scale that is not a number reads as zoomed out', () => {
    expect(doubleTapTarget({ ...base, current: Number.NaN, cover: 1.5 })).toEqual({ kind: 'zoom', scale: 1.5 })
  })
})
