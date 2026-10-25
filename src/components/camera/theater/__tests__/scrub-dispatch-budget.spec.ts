/**
 * How much a single drag costs — MEASURED, not asserted from the constants.
 *
 * Two operator reports meet here: "the scrub during recording is jerky" and
 * "there is a vibration at every micro-step". Both are about what a gesture
 * does per FRAME, and both were answered by counting rather than guessing.
 *
 * The gesture played below is a real one: two seconds of finger travel at
 * 60 Hz, 120 samples — what an iPhone's ScrollView and a pointer drag both
 * produce. Each surface's interval is folded over it with the app's own
 * predicate (`shouldEmitScrubSample`), so the numbers here are the numbers the
 * device gets.
 *
 * What the counts show, and why the fix was NOT another throttle: both scrub
 * surfaces were already braked (33 ms on the heatmap, 50 ms on the timeline)
 * and the player behind them at 40 ms. The per-frame cost that was NOT bounded
 * was the DETENT — a taptic pulse plus a walk over every cluster of the day,
 * floored at 80 ms and therefore up to 25 pulses across this same drag.
 */
import { describe, it, expect } from 'vitest'
import {
  HEATMAP_SCRUB_EMIT_MS,
  PLAYER_SCRUB_EMIT_MS,
  TIMELINE_SCRUB_EMIT_MS,
  shouldEmitScrubSample,
} from '../../../../lib/scrub-throttle.js'
import {
  DETENT_INITIAL,
  DETENT_MIN_INTERVAL_MS,
  detentKeyWhileScrubbing,
  resolveDetent,
} from '../../../../lib/scrub-detent.js'

/** Two seconds of drag at 60 Hz: the sample times a real gesture produces. */
const GESTURE_MS = 2_000
const FRAME_MS = 1000 / 60
const SAMPLES: readonly number[] = Array.from(
  { length: Math.round(GESTURE_MS / FRAME_MS) },
  (_, i) => Math.round(i * FRAME_MS),
)

/** Fold the app's own emit rule over the gesture and count what got through. */
function emitsPerGesture(minIntervalMs: number): number {
  let last = -Infinity
  let emitted = 0
  for (const now of SAMPLES) {
    if (!shouldEmitScrubSample(last, now, minIntervalMs)) continue
    last = now
    emitted += 1
  }
  return emitted
}

describe('a 2 s drag at 60 Hz produces 120 samples', () => {
  it('unbraked, that is one dispatch per sample', () => {
    expect(SAMPLES).toHaveLength(120)
    expect(emitsPerGesture(0)).toBe(120)
  })
})

describe('both scrub surfaces are braked, and by how much', () => {
  // A sample can only be emitted ON a frame, so each interval rounds UP to the
  // next frame boundary: 33 ms behaves as 2 frames (33.3), 40 ms as 3 (50).
  // That rounding is why these are measurements and not divisions.
  it('the heatmap emits 60 of the 120 — half the frames, ~30/s', () => {
    expect(HEATMAP_SCRUB_EMIT_MS).toBe(33)
    expect(emitsPerGesture(HEATMAP_SCRUB_EMIT_MS)).toBe(60)
  })

  it('the vertical timeline emits 40 of the 120 — a third, ~20/s', () => {
    expect(TIMELINE_SCRUB_EMIT_MS).toBe(50)
    expect(emitsPerGesture(TIMELINE_SCRUB_EMIT_MS)).toBe(40)
  })

  it('the player behind them takes 40 (40 ms rounds up to 3 frames)', () => {
    expect(emitsPerGesture(PLAYER_SCRUB_EMIT_MS)).toBe(40)
  })

  it('every surface stays under half the sample rate', () => {
    for (const ms of [HEATMAP_SCRUB_EMIT_MS, TIMELINE_SCRUB_EMIT_MS, PLAYER_SCRUB_EMIT_MS]) {
      expect(emitsPerGesture(ms)).toBeLessThanOrEqual(SAMPLES.length / 2 + 1)
    }
  })
})

/**
 * The detent, over the SAME gesture, on a dense timeline: a different cluster
 * under the cursor on every emitted sample — the "dense hour" the operator was
 * dragging through.
 */
function detentPulses(selectionArmed: boolean, emitIntervalMs: number): number {
  let state = DETENT_INITIAL
  let last = -Infinity
  let pulses = 0
  let cluster = 0
  for (const now of SAMPLES) {
    if (!shouldEmitScrubSample(last, now, emitIntervalMs)) continue
    last = now
    cluster += 1
    const key = detentKeyWhileScrubbing(selectionArmed, () => `cluster-${cluster}`)
    const decision = resolveDetent(state, key, now)
    state = decision.state
    if (decision.tick) pulses += 1
  }
  return pulses
}

describe('the detent is what was unbounded per micro-step', () => {
  it('hunting for an event, a dense drag pulses at the detent cadence', () => {
    // This case pinned 80 ms and 19 pulses across the drag. That WAS the
    // defect: 19 pulses in two seconds is 12.5 a second, which the operator
    // reported as a continuous buzz — first while drawing a selection (fixed
    // by silencing that case), then on 2026-09-10 while simply scrubbing to
    // FIND the start of an export, which is this case.
    expect(DETENT_MIN_INTERVAL_MS).toBe(200)
    // Floor-limited, not sample-limited: the emit rate no longer decides the
    // cadence, so both surfaces land on the same, much smaller count.
    const timeline = detentPulses(false, TIMELINE_SCRUB_EMIT_MS)
    const heatmap = detentPulses(false, HEATMAP_SCRUB_EMIT_MS)
    expect(timeline).toBe(heatmap)
    expect(timeline).toBeLessThanOrEqual(10)
    // Still detents, not silence.
    expect(timeline).toBeGreaterThan(3)
  })

  it('DRAWING a selection, the same drag pulses ZERO times', () => {
    expect(detentPulses(true, TIMELINE_SCRUB_EMIT_MS)).toBe(0)
    expect(detentPulses(true, HEATMAP_SCRUB_EMIT_MS)).toBe(0)
  })

  it('and the cluster walk behind each pulse is skipped, not just its result', () => {
    let walked = 0
    detentKeyWhileScrubbing(true, () => {
      walked += 1
      return 'cluster-1'
    })
    expect(walked).toBe(0)
    detentKeyWhileScrubbing(false, () => {
      walked += 1
      return 'cluster-1'
    })
    expect(walked).toBe(1)
  })

  it('silence is not a latch: the next hunt pulses again', () => {
    expect(detentPulses(false, TIMELINE_SCRUB_EMIT_MS)).toBeGreaterThan(0)
  })
})
