import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { containBox as liveContainBox, panExtent as livePanExtent } from '../stream-zoom-clamp'
import { ZOOM_MAX, ZOOM_MIN } from '../zoom-steps'
import {
  containBox as stillContainBox,
  MAX_ZOOM,
  MIN_ZOOM,
  panExtent as stillPanExtent,
} from '../../components/camera/theater/detail/zoom-math'

/**
 * The live picture and the still picture must zoom the SAME way.
 *
 * They are two hosts — a stream in a WebView wrapper, an Image in a gallery —
 * so they cannot share a component. What they must share is the arithmetic, and
 * for a while they did not: both derived the focal pan inline, both stated
 * their own 1..4 range, and both hand-rolled a letterbox clamp. Three
 * duplications, each of which drifts quietly, and one of which was already
 * WRONG in both copies (the focal anchor).
 *
 * The ladder and the focal maths now have one home (`zoom-steps.ts`). The two
 * clamps stay separate because their input guards genuinely differ — the still
 * one clamps the scale first, and merging them blind would change the live
 * path. So they are pinned against each other here instead: agreement is
 * asserted, not assumed.
 */
describe('the two zoom surfaces agree', () => {
  it('shares one definition of how far zoom goes', () => {
    expect(MIN_ZOOM).toBe(ZOOM_MIN)
    expect(MAX_ZOOM).toBe(ZOOM_MAX)
  })

  /**
   * The equality above cannot fail while the range is re-exported — changing
   * the source changes both sides — so on its own it is a tautology, and it
   * stayed green when the ladder was deliberately altered to check. What CAN
   * regress is someone writing the numbers back into this file, which is how
   * the two 4s got there in the first place. That is a fact about the SOURCE,
   * so the source is what is asserted.
   */
  it('does not let the still surface state the range in its own numbers again', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', 'components', 'camera', 'theater', 'detail', 'zoom-math.ts'),
      'utf-8',
    )
    expect(src).toContain("from '../../../../live/zoom-steps.js'")
    expect(src).toMatch(/export const MIN_ZOOM = ZOOM_MIN/)
    expect(src).toMatch(/export const MAX_ZOOM = ZOOM_MAX/)
  })

  it('computes the SAME contain box across viewports and aspects', () => {
    for (const w of [320, 640, 932, 1179]) {
      for (const h of [180, 360, 430, 800]) {
        for (const aspect of [16 / 9, 4 / 3, 1, 2.39]) {
          const live = liveContainBox(w, h, aspect)
          const still = stillContainBox(w, h, aspect)
          expect(still.width).toBeCloseTo(live.width, 6)
          expect(still.height).toBeCloseTo(live.height, 6)
        }
      }
    }
  })

  it('computes the SAME pan extent for every in-range scale', () => {
    for (const container of [320, 640, 932]) {
      for (const content of [180, 360, 640]) {
        for (const scale of [ZOOM_MIN, 1.5, 2, 3, ZOOM_MAX]) {
          expect(stillPanExtent(container, content, scale)).toBeCloseTo(
            livePanExtent(container, content, scale),
            6,
          )
        }
      }
    }
  })
})
