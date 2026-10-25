/**
 * What the chrome may offer for a clip — resolved from the HUB's envelope, and
 * from nothing else (D612).
 *
 * Two properties carry the whole design and both are asserted here:
 *
 *  1. **Only a `present` answer restricts anything.** `pending`, `absent` and
 *     `unknown` all resolve to the freedom this app always had, because a
 *     restriction is something the hub SAYS. A viewer newer than its hub must
 *     not start refusing gestures that worked (and a not-yet-answered query
 *     must never read as "this camera offers nothing" — D315).
 *  2. **A rate the camera cannot serve is still DRAWN.** `clipRateChoices`
 *     never shrinks below the hub's own ladder, so the menu can grey the row
 *     rather than drop it (D62).
 */
import { describe, it, expect } from 'vitest'
import { CLIP_PLAYBACK_OPTIONS } from '@camstack/types'

import {
  clipControlDisabled,
  clipRateAllowed,
  clipRateChoices,
  clipRateMenuShown,
  clipScrubAllowed,
  clipSeekAllowed,
  clipSeekFloorFraction,
  clipStepBackAllowed,
  LEGACY_CONTROLS,
  resolveClipControls,
  type ClipSourceControls,
} from '../clip-controls.js'
import { CLIP_LEGACY_RATE_LADDER } from '../clip-playback-options.js'
import type { ClipPlaybackPresence } from '../clip-playback-options.js'

const FILE = CLIP_PLAYBACK_OPTIONS.file
const REALTIME = CLIP_PLAYBACK_OPTIONS.realtimeStream

describe('resolveClipControls — what licenses a restriction', () => {
  it('is the freedom this app always had on every arm but `present`', () => {
    for (const presence of ['pending', 'absent', 'unknown'] as const) {
      const view = resolveClipControls(presence, REALTIME)
      expect(view.presence).toBe(presence)
      // Note the ARGUMENT: a real, restrictive envelope is handed in and
      // ignored. The gate is the standing of the answer, not the payload.
      expect(view.controls).toEqual(LEGACY_CONTROLS)
    }
  })

  it('takes a `present` envelope WHOLE — all four verbs at once', () => {
    const view = resolveClipControls('present', REALTIME)
    expect(view.presence).toBe('present')
    expect(view.controls.seek).toBe('forward')
    expect(view.controls.stepBack).toBe(false)
    expect(view.controls.scrub).toBe(false)
    expect([...view.controls.rates]).toEqual([0.25, 0.5, 1])
  })

  it('a `present` answer with NO envelope is still the old freedom', () => {
    // The parser answers null for a payload it cannot read. Half-reading one
    // would invent a restriction the hub never stated.
    expect(resolveClipControls('present', null).controls).toEqual(LEGACY_CONTROLS)
  })

  it("the `file` envelope is exactly what shipped — the ordinary camera loses nothing", () => {
    expect(resolveClipControls('present', FILE).controls).toEqual(LEGACY_CONTROLS)
  })

  it('LEGACY_CONTROLS is free, steppable, scrubbable and carries the hub ladder', () => {
    expect(LEGACY_CONTROLS.seek).toBe('free')
    expect(LEGACY_CONTROLS.stepBack).toBe(true)
    expect(LEGACY_CONTROLS.scrub).toBe(true)
    expect([...LEGACY_CONTROLS.rates]).toEqual([...CLIP_LEGACY_RATE_LADDER])
  })
})

describe('clipSeekAllowed', () => {
  const forward = resolveClipControls('present', REALTIME).controls
  const free = LEGACY_CONTROLS

  it('refuses a target behind the head on a forward-only clip', () => {
    expect(clipSeekAllowed(forward, 0, 5_000)).toBe(false)
    expect(clipSeekAllowed(forward, 4_999, 5_000)).toBe(false)
    expect(clipSeekAllowed(forward, 5_000, 5_000)).toBe(true)
    expect(clipSeekAllowed(forward, 9_000, 5_000)).toBe(true)
  })

  it('allows anything on a freely seekable clip', () => {
    expect(clipSeekAllowed(free, 0, 5_000)).toBe(true)
    expect(clipSeekAllowed(free, 9_000, 5_000)).toBe(true)
  })

  it('allows everything while the head is still at zero', () => {
    expect(clipSeekAllowed(forward, 0, 0)).toBe(true)
    expect(clipSeekAllowed(forward, 12_000, 0)).toBe(true)
  })
})

describe('clipSeekFloorFraction', () => {
  const forward: ClipSourceControls = { ...LEGACY_CONTROLS, seek: 'forward' }

  it('is the head on a forward-only clip and zero on a free one', () => {
    expect(clipSeekFloorFraction(forward, 0.5)).toBe(0.5)
    expect(clipSeekFloorFraction(LEGACY_CONTROLS, 0.5)).toBe(0)
  })

  it('is zero while the head is unknown — a floor from nothing would lock the track', () => {
    expect(clipSeekFloorFraction(forward, null)).toBe(0)
    expect(clipSeekFloorFraction(forward, Number.NaN)).toBe(0)
  })
})

describe('the per-verb gates', () => {
  it('read the envelope, each on its own', () => {
    expect(clipStepBackAllowed(LEGACY_CONTROLS)).toBe(true)
    expect(clipScrubAllowed(LEGACY_CONTROLS)).toBe(true)
    const realtime = resolveClipControls('present', REALTIME).controls
    expect(clipStepBackAllowed(realtime)).toBe(false)
    expect(clipScrubAllowed(realtime)).toBe(false)
  })

  it('answer for a RATE against the camera own ladder', () => {
    const realtime = resolveClipControls('present', REALTIME).controls
    expect(clipRateAllowed(realtime, 1)).toBe(true)
    expect(clipRateAllowed(realtime, 0.5)).toBe(true)
    expect(clipRateAllowed(realtime, 2)).toBe(false)
    expect(clipRateAllowed(realtime, 4)).toBe(false)
    expect(clipRateAllowed(LEGACY_CONTROLS, 4)).toBe(true)
  })
})

describe('clipRateChoices — only what this camera can actually do', () => {
  /**
   * This block used to assert the opposite, and the operator retired it:
   * *"nascondi il selettore e basta. Mostrare quella label non ha alcun senso
   * proprio per niente"* (2026-09-23). The menu drew the union of this build's
   * ladder with the camera's, greyed the difference, and explained the cap in
   * a line at the foot. Measured against the two cameras that prompted it —
   * both declare `[0.25, 0.5, 1]` — that is three live rows, three dead ones
   * and a paragraph, every time the menu opens.
   *
   * What is GIVEN UP is real and worth stating: a greyed 2× told the operator
   * the camera could not do it, where a missing 2× could also mean this app
   * never built one. He decided that distinction is not worth its rent.
   */
  it('draws the camera own ladder, and nothing this build wishes it had', () => {
    const realtime = resolveClipControls('present', REALTIME)
    expect([...clipRateChoices(realtime)]).toEqual([...realtime.controls.rates])
    // Nothing drawn is dead, which is why the note at the foot could go.
    const dead = clipRateChoices(realtime).filter((r) => !clipRateAllowed(realtime.controls, r))
    expect(dead).toEqual([])
  })

  it('ADMITS a rate this build has never heard of, because the hub owns the set', () => {
    const exotic = { presence: 'present', controls: { ...LEGACY_CONTROLS, rates: [0.25, 1, 8] } } as const
    expect([...clipRateChoices(exotic)]).toEqual([0.25, 1, 8])
  })

  it('keeps the full ladder while nothing has been SAID about the camera', () => {
    // D315 at its plainest: a pending read must never shrink a menu. Only a
    // `present` answer may narrow it.
    for (const presence of ['pending', 'absent', 'unknown'] as const) {
      const view = { presence, controls: { ...LEGACY_CONTROLS, rates: [1] } } as const
      expect([...clipRateChoices(view)]).toEqual([...CLIP_LEGACY_RATE_LADDER])
    }
  })

  it('is ascending and de-duplicated', () => {
    const view = clipRateChoices({
      presence: 'present',
      controls: { ...LEGACY_CONTROLS, rates: [4, 1, 0.25, 1] },
    })
    expect([...view]).toEqual([...view].sort((a, b) => a - b))
    expect(new Set(view).size).toBe(view.length)
  })
})

describe('clipRateMenuShown — no control where there is nothing to choose', () => {
  it('hides the chip for a camera that plays at one speed', () => {
    const single = { presence: 'present', controls: { ...LEGACY_CONTROLS, rates: [1] } } as const
    expect(clipRateMenuShown(single)).toBe(false)
  })

  it('keeps it for the two cameras that prompted this — they DO slow down', () => {
    // Hikvision 1436 and Amcrest 3836, live on 2026-09-23, both `[0.25,0.5,1]`.
    // Hiding the control outright would have taken away working slow motion.
    const measured = { presence: 'present', controls: { ...LEGACY_CONTROLS, rates: [0.25, 0.5, 1] } } as const
    expect(clipRateMenuShown(measured)).toBe(true)
    expect([...clipRateChoices(measured)]).toEqual([0.25, 0.5, 1])
  })

  it('keeps it while the answer is still pending', () => {
    const pending = { presence: 'pending', controls: { ...LEGACY_CONTROLS, rates: [1] } } as const
    expect(clipRateMenuShown(pending)).toBe(true)
  })
})

describe('clipControlDisabled — a control is greyed only on an ANSWER', () => {
  it('greys a refused verb once the hub has said so', () => {
    expect(clipControlDisabled({ presence: 'present', controls: LEGACY_CONTROLS }, false)).toBe(true)
  })

  it('never greys anything on pending / absent / unknown', () => {
    // D315: not-yet-known must never look like not-available. `allowed: false`
    // is passed on every arm, so the only thing that can flip the answer is
    // the presence.
    for (const presence of ['pending', 'absent', 'unknown'] as const) {
      expect(clipControlDisabled({ presence, controls: LEGACY_CONTROLS }, false)).toBe(false)
    }
  })

  it('never greys a verb the camera DOES serve', () => {
    const presences: readonly ClipPlaybackPresence[] = ['pending', 'present', 'absent', 'unknown']
    for (const presence of presences) {
      expect(clipControlDisabled({ presence, controls: LEGACY_CONTROLS }, true)).toBe(false)
    }
  })
})
