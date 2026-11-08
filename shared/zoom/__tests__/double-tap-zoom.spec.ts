import { describe, expect, it } from 'vitest'
import { doubleTapTarget } from '../double-tap-zoom'
import * as mod from '../double-tap-zoom'

const base = { minScale: 1, maxScale: 4 }

describe('doubleTapTarget — the classic gallery', () => {
  it('at the whole picture: full zoom, whatever the picture and box', () => {
    expect(doubleTapTarget({ ...base, current: 1 })).toEqual({ kind: 'zoom', scale: 4 })
    expect(doubleTapTarget({ ...base, current: 1.005 })).toEqual({ kind: 'zoom', scale: 4 })
  })

  it('at any other scale: back to the whole picture, never a further rung', () => {
    for (const current of [1.05, 1.22, 2, 2.6, 3.9, 4]) {
      expect(doubleTapTarget({ ...base, current })).toEqual({ kind: 'fit' })
    }
  })

  it('a scale that is not a number reads as the whole picture', () => {
    expect(doubleTapTarget({ ...base, current: Number.NaN })).toEqual({ kind: 'zoom', scale: 4 })
  })

  it('has no rungs and no long-press reset left', () => {
    expect(Object.keys(mod).sort()).toEqual(['DOUBLE_TAP_EPSILON', 'doubleTapTarget'])
  })
})
