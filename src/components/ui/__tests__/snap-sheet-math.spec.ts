import { describe, expect, it } from 'vitest'
import { nextSnap, restingSnap, snapOffset } from '../snap-sheet-math.js'

const heights = { collapsed: 80, half: 400, full: 760 }

describe('snap sheet math', () => {
  it('a snap is an offset from the full layout', () => {
    expect(snapOffset(heights, 'full')).toBe(0)
    expect(snapOffset(heights, 'half')).toBe(360)
    expect(snapOffset(heights, 'collapsed')).toBe(680)
  })

  it('rests at the nearest snap of where the drag ended', () => {
    expect(restingSnap(heights, 20, 0)).toBe('full')
    expect(restingSnap(heights, 380, 0)).toBe('half')
    expect(restingSnap(heights, 600, 0)).toBe('collapsed')
  })

  it('a fling carries the sheet past a snap', () => {
    expect(restingSnap(heights, 360, 1800)).toBe('collapsed')
    expect(restingSnap(heights, 360, -1800)).toBe('full')
  })

  it('a tap on the handle cycles', () => {
    expect(nextSnap('collapsed')).toBe('half')
    expect(nextSnap('half')).toBe('full')
    expect(nextSnap('full')).toBe('collapsed')
  })
})
