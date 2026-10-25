import { describe, expect, it } from 'vitest'
import {
  RAIL_NARROW_BELOW,
  TIMELINE_RAIL_WIDTH,
  TIMELINE_RAIL_WIDTH_NARROW,
  computeWideDetailSizes,
} from '../wide-detail-sizes.js'

/**
 * The rail has to fit the toolbar it carries.
 *
 * `TIMELINE_RAIL_WIDTH`'s own comment said 380 "comfortably fits the full
 * TimelineToolbarInline row (it fits a 390pt phone today)". It stopped being
 * true as controls were added: photographed on the operator's iPad on
 * 2026-09-19, the row had WRAPPED onto a second line — back, ‹, date, ›,
 * activity, light, move, list on the first, Auto and help pushed below — and
 * the profile menu that opens from it was clipped by the rail's edge.
 *
 * A wrapped toolbar is not a cosmetic complaint: the second line eats the
 * vertical space the timeline itself needs, and a menu clipped at the rail
 * edge cannot be read at all.
 *
 * The numbers are bumped by one control's worth each. What this test pins is
 * not the numbers — it is the two invariants that made the old ones safe, so
 * the next person to widen the rail cannot quietly break either.
 */
describe('the timeline rail', () => {
  it('is wide enough for a toolbar that no longer wraps', () => {
    expect(TIMELINE_RAIL_WIDTH).toBeGreaterThanOrEqual(420)
    expect(TIMELINE_RAIL_WIDTH_NARROW).toBeGreaterThanOrEqual(380)
  })

  it('never leaves the stream column below 600pt at the narrow breakpoint', () => {
    // The reason the narrow fallback exists at all. Widening the rail eats
    // the picture, and this is the floor that says how far it may go.
    const { streamWidth } = computeWideDetailSizes({
      containerWidth: RAIL_NARROW_BELOW,
      viewportHeight: 834,
    })
    expect(RAIL_NARROW_BELOW - TIMELINE_RAIL_WIDTH_NARROW).toBeGreaterThanOrEqual(600)
    expect(streamWidth).toBeGreaterThan(0)
  })

  it('keeps the narrow rail narrower than the wide one', () => {
    expect(TIMELINE_RAIL_WIDTH_NARROW).toBeLessThan(TIMELINE_RAIL_WIDTH)
  })

  it('still hands the picture the whole column it has left', () => {
    const wide = computeWideDetailSizes({ containerWidth: 1600, viewportHeight: 1200 })
    expect(wide.railWidth).toBe(TIMELINE_RAIL_WIDTH)
    expect(wide.streamWidth).toBeLessThanOrEqual(1600 - TIMELINE_RAIL_WIDTH)
  })
})
