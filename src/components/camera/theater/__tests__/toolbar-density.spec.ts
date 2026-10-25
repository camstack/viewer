import { describe, expect, it } from 'vitest'
import {
  MAX_SCALE,
  REFERENCE_WIDTH,
  TOOLBAR_DENSITY_FACTOR,
  scaleForWidth,
  timelineTokens,
  type ToolbarDensity,
} from '../timeline-scale-tokens.js'

/**
 * The operator can make the player's toolbar taller.
 *
 * The scale system already existed and already solved the hard half: every
 * token is derived ONCE from the available width and read through
 * `useTimelineScale()`, so nothing has to be re-scaled by hand — which is
 * exactly why a density setting can say "the components scale accordingly"
 * without touching a single component.
 *
 * What it lacked was a way to grow. The module's ceiling was 1 with the reason
 * stated plainly: "a tablet gets more timeline, not a bigger play button". That
 * is right for a WIDTH-derived scale — a wide screen is not a request for
 * bigger chrome. An explicit density choice IS that request, so it multiplies
 * the width-derived scale rather than replacing it: a narrow phone still
 * shrinks, and 'large' on a phone stays smaller than 'large' on a tablet.
 */
describe('toolbar density', () => {
  it('leaves small exactly where the toolbar is today', () => {
    expect(TOOLBAR_DENSITY_FACTOR.small).toBe(1)
    expect(scaleForWidth(REFERENCE_WIDTH, 'small')).toBe(MAX_SCALE)
  })

  it('grows through medium to large', () => {
    const at = (d: ToolbarDensity) => scaleForWidth(REFERENCE_WIDTH, d)
    expect(at('medium')).toBeGreaterThan(at('small'))
    expect(at('large')).toBeGreaterThan(at('medium'))
  })

  it('still SHRINKS on a narrow surface, whatever the density', () => {
    // Density is a preference, not an override of the geometry: a drawer that
    // is 200pt wide cannot host a phone-sized toolbar just because the operator
    // asked for 'large'.
    for (const d of ['small', 'medium', 'large'] as const) {
      expect(scaleForWidth(200, d)).toBeLessThan(scaleForWidth(REFERENCE_WIDTH, d))
    }
  })

  it('defaults to small when nothing is chosen — today\'s behaviour is the default', () => {
    expect(scaleForWidth(REFERENCE_WIDTH)).toBe(scaleForWidth(REFERENCE_WIDTH, 'small'))
  })

  it('carries the density into EVERY token family, not just the buttons', () => {
    // The point of the token set is that one decision reaches everything; a
    // density that only grew the button would reproduce the hand-scaling defect
    // this module was written to end.
    const small = timelineTokens(REFERENCE_WIDTH, 'small')
    const large = timelineTokens(REFERENCE_WIDTH, 'large')
    expect(large.control.button).toBeGreaterThan(small.control.button)
    expect(large.control.primary).toBeGreaterThan(small.control.primary)
    expect(large.icon.sm).toBeGreaterThan(small.icon.sm)
    expect(large.font.sm).toBeGreaterThan(small.font.sm)
    expect(large.space.sm).toBeGreaterThan(small.space.sm)
  })

  it('keeps a degenerate width answering the density, not a crash', () => {
    expect(Number.isFinite(scaleForWidth(0, 'large'))).toBe(true)
    expect(Number.isFinite(scaleForWidth(Number.NaN, 'medium'))).toBe(true)
  })
})
