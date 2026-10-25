import { describe, expect, it } from 'vitest'
import { activeNavSegment, navPressAction } from '../nav-items.js'

/**
 * Pressing the entry you are already LIT on.
 *
 * A camera detail lights the Cameras entry — deliberately, because lighting
 * nothing reads as "you are nowhere". The bar then treated "lit" as "already
 * there" and swallowed the press, so the one gesture every operator uses to
 * get back to the list did nothing.
 */
describe('navPressAction', () => {
  it('does nothing when we are already ON the entry route', () => {
    expect(navPressAction('/cameras', '/cameras')).toBe('noop')
    expect(navPressAction('/grids', '/grids')).toBe('noop')
  })

  it('NAVIGATES from a camera detail back to the cameras list', () => {
    // The reported bug, in one line.
    expect(activeNavSegment('/camera/101')).toBe('/cameras')
    expect(navPressAction('/camera/101', '/cameras')).toBe('navigate')
  })

  it('navigates from a grid wall back to the grids list', () => {
    expect(activeNavSegment('/grid/3')).toBe('/grids')
    expect(navPressAction('/grid/3', '/grids')).toBe('navigate')
  })

  it('navigates to a DIFFERENT entry, as it always did', () => {
    expect(navPressAction('/camera/101', '/grids')).toBe('navigate')
    expect(navPressAction('/cameras', '/settings')).toBe('navigate')
  })
})
