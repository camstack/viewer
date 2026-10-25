/**
 * The one decision that turns the broker's `clipAudio` into something an
 * operator can read — and the one place that refuses to turn it into a fault.
 *
 * The hub has named seven causes for a silent clip (D600, D621). Six are
 * permanent facts about the file or the negotiation and are somebody else's
 * problem; the seventh, `rate`, is the operator's own finger on the speed chip
 * and comes and goes with it. Drawing that one as a defect is the D62 failure
 * this module exists to prevent: a thing that is deliberately off must never
 * look broken.
 */
import { describe, it, expect } from 'vitest'

import { resolveClipAudioNotice } from '../clip-audio-notice.js'
import type { ClipAudioReport } from '../../recording/recording-messages.js'

const RATE_8: ClipAudioReport = {
  type: 'clipAudio',
  clipId: 'clip-1',
  carried: false,
  reason: 'rate',
  rate: 8,
}

describe('resolveClipAudioNotice — silence the SPEED caused, and nothing else', () => {
  it('says the rate, from the report that named it', () => {
    expect(resolveClipAudioNotice('clip-1', RATE_8)).toEqual({ kind: 'silent-by-speed', rate: 8 })
    expect(resolveClipAudioNotice('clip-1', { ...RATE_8, rate: 2 })).toEqual({
      kind: 'silent-by-speed',
      rate: 2,
    })
    // The slow end of the ladder drops audio too — the hub's predicate is
    // `rate !== 1`, not `rate > 1`, and a viewer that only believed the fast
    // half would leave 0.25× silent with no explanation.
    expect(resolveClipAudioNotice('clip-1', { ...RATE_8, rate: 0.25 })).toEqual({
      kind: 'silent-by-speed',
      rate: 0.25,
    })
  })

  it('says NOTHING for the other six reasons — they are faults or facts, not a speed', () => {
    for (const reason of [
      'not-negotiated',
      'not-offered',
      'no-audio-track',
      'unsupported-codec',
      'codec-mismatch',
      'stream-failed',
    ] as const) {
      // WITH a rate attached, deliberately. Without one this asserts only
      // "no rate ⇒ no badge", which is a different gate and which passes with
      // the reason check deleted — measured, 2026-09-24.
      expect(resolveClipAudioNotice('clip-1', { ...RATE_8, reason, rate: 8 }), reason).toBeNull()
      expect(resolveClipAudioNotice('clip-1', { ...RATE_8, reason, rate: undefined }), reason).toBeNull()
    }
  })

  it('says nothing about a clip that IS carrying sound', () => {
    expect(
      resolveClipAudioNotice('clip-1', {
        type: 'clipAudio',
        clipId: 'clip-1',
        carried: true,
        codec: 'opus',
      }),
    ).toBeNull()
  })

  it('…not even one that carries sound AND names the rate — the contradiction is refused here', () => {
    /**
     * Deleting the `carried` gate left the suite green on 2026-09-23: every
     * other case reached a later `return null` for its own reason, so nothing
     * was asserting THIS one. The shape that exposes it is the contradictory
     * report — carrying sound and blaming the speed at once.
     *
     * The hub cannot send it (D621 pairs `rate` with `reason: 'rate'`, and a
     * carried clip is never given a reason at all), and that is exactly why
     * it is asserted here: this module must not depend on its caller having
     * been correct. Defence in depth, the same argument the six-reason case
     * already carries one gate above.
     */
    expect(resolveClipAudioNotice('clip-1', { ...RATE_8, carried: true })).toBeNull()
  })

  it('refuses a report that names a clip the stage is not holding', () => {
    // The hub carries the same guard on its side (D621): a report that lands
    // after the pointer moved on names a clip nobody is playing, and a badge
    // built from it would blame the NEXT file for the previous one's speed.
    expect(resolveClipAudioNotice('clip-2', RATE_8)).toBeNull()
    expect(resolveClipAudioNotice(null, RATE_8)).toBeNull()
  })

  it('says nothing when nothing has reported', () => {
    expect(resolveClipAudioNotice('clip-1', null)).toBeNull()
  })

  it('refuses a rate of 1 — 1× is where the sound PLAYS, so it can never be the cause', () => {
    expect(resolveClipAudioNotice('clip-1', { ...RATE_8, rate: 1 })).toBeNull()
  })

  it('refuses a rate that is not a rate, rather than drawing an empty badge', () => {
    for (const rate of [undefined, 0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveClipAudioNotice('clip-1', { ...RATE_8, rate })).toBeNull()
    }
  })
})
