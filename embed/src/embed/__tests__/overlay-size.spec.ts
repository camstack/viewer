import { describe, it, expect } from 'vitest'
import {
  DEFAULT_OVERLAY_SIZE,
  MAX_SCALE,
  OVERLAY_SIZE_MIN_SCALE,
  OVERLAY_SCALE_VAR,
  isOverlaySize,
  ov,
  overlayScale,
  scaleVarStyle,
} from '../overlay-size'
import { fitInside, VIDEO_ASPECT } from '../cell-fit'

describe('overlayScale — a share of the PICTURE width', () => {
  it('defaults to medium', () => {
    expect(DEFAULT_OVERLAY_SIZE).toBe('medium')
    expect(isOverlaySize('medium')).toBe(true)
    expect(isOverlaySize('huge')).toBe(false)
  })

  it('orders small < medium < large on one picture', () => {
    expect(overlayScale(500, 'small')).toBeLessThan(overlayScale(500, 'medium'))
    expect(overlayScale(500, 'medium')).toBeLessThan(overlayScale(500, 'large'))
  })

  it('grows with the picture, and is clamped both ways', () => {
    expect(overlayScale(600, 'medium')).toBeGreaterThan(overlayScale(400, 'medium'))
    expect(overlayScale(100, 'small')).toBe(OVERLAY_SIZE_MIN_SCALE.small)
    expect(overlayScale(5000, 'large')).toBe(MAX_SCALE)
  })

  it('is 1 before the picture is measured', () => {
    expect(overlayScale(0, 'large')).toBe(1)
    expect(overlayScale(Number.NaN, 'large')).toBe(1)
  })

  it('a banded (spanned) cell is sized by the picture inside it, not by the cell', () => {
    // 2 tracks wide, 1 tall: a 32:9 cell. The 16:9 picture is only as wide as it is tall.
    const cellW = 800
    const cellH = 225
    const picture = fitInside(cellW, cellH, VIDEO_ASPECT)
    expect(picture.width).toBeLessThan(cellW)
    expect(overlayScale(picture.width, 'medium')).toBeLessThan(overlayScale(cellW, 'medium'))
  })
})

describe('the CSS side', () => {
  it('writes a dimension against the frame\'s custom property, with 1 as the fallback', () => {
    expect(ov(11)).toBe(`calc(11px * var(${OVERLAY_SCALE_VAR}, 1))`)
  })

  it('publishes the multiplier as the custom property', () => {
    expect(scaleVarStyle(1.5)).toEqual({ [OVERLAY_SCALE_VAR]: 1.5 })
  })
})
