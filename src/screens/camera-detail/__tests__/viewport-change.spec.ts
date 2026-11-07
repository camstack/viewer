import { describe, expect, it } from 'vitest'
import { classifyViewportChange, VIEWPORT_CHANGE_MIN_PT } from '../viewport-change.js'

const portrait = { width: 390, height: 844 }

describe('classifyViewportChange', () => {
  it('ignores safe-area / system-bar jitter', () => {
    expect(classifyViewportChange(portrait, { width: 390, height: 844 - 34 })).toBe('none')
    expect(classifyViewportChange(portrait, { width: 390.4, height: 843.6 })).toBe('none')
  })

  it('reports an orientation flip however small the numbers', () => {
    expect(classifyViewportChange(portrait, { width: 844, height: 390 })).toBe('orientation')
    expect(classifyViewportChange({ width: 500, height: 499 }, { width: 499, height: 500 })).toBe(
      'orientation',
    )
  })

  it('reports a real resize at the threshold', () => {
    expect(
      classifyViewportChange(portrait, {
        width: 390,
        height: 844 - VIEWPORT_CHANGE_MIN_PT,
      }),
    ).toBe('resize')
    expect(
      classifyViewportChange(portrait, {
        width: 390,
        height: 844 - VIEWPORT_CHANGE_MIN_PT + 1,
      }),
    ).toBe('none')
  })
})
