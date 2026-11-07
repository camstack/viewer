import { describe, expect, it } from 'vitest'
import { growBoxHeight } from '../../../live/zoom-render.js'
import { zoomBoxHeight, type ZoomBoxParams } from '../zoom-box.js'

const base: ZoomBoxParams = {
  fill: false,
  winHeight: 800,
  isWideDetail: false,
  wideStreamH: 300,
  pinchExpandsHeight: true,
  defaultHeight: 220,
  maxHeight: 520,
  growScale: 2.5,
}

describe('zoomBoxHeight', () => {
  it('fill wins, then wide, then the fixed box', () => {
    expect(zoomBoxHeight(2, { ...base, fill: true, isWideDetail: true })).toBe(800)
    expect(zoomBoxHeight(2, { ...base, isWideDetail: true })).toBe(300)
    expect(zoomBoxHeight(2, { ...base, pinchExpandsHeight: false })).toBe(220)
  })

  it('grows with the live scale exactly as the grow rule says', () => {
    for (const s of [1, 1.7, 2.5, 4]) {
      expect(zoomBoxHeight(s, base)).toBe(growBoxHeight(s, { rest: 220, max: 520, growScale: 2.5 }))
    }
  })
})
