/**
 * The one answer to "what moment is the operator looking at", and how its
 * consumers carry it (D483).
 *
 * Both directions of the live/playback split are asserted for every consumer,
 * because the degenerate case is where this breaks: neither the swap nor the
 * overlay may open a recorded feeder at wall-clock now, past the archive's
 * edge — the overlay did, and did not start until pause → play.
 */
import { describe, it, expect } from 'vitest'
import { atParam, viewedInstant } from '../viewed-instant.js'
import { onDemandSeedSeekMs, resolveReelInstant } from '../../live/ondemand-player.js'

const NOW = 1_700_000_000_000
const T = 1_699_999_000_000

describe('what the primary is showing', () => {
  it('an epoch off the live edge', () => {
    expect(viewedInstant(T)).toEqual({ kind: 'at', atMs: T })
  })

  it('LIVE when the machine reports null', () => {
    expect(viewedInstant(null)).toEqual({ kind: 'live' })
  })

  /** Epoch 0 is a real instant. `|| ` would read it as absent; `=== null` does not. */
  it('treats epoch zero as an instant, not as live', () => {
    expect(viewedInstant(0)).toEqual({ kind: 'at', atMs: 0 })
  })
})

describe('the SWAP carries the playhead', () => {
  /** The operator's words: «se sono in playback deve rimanere allo stesso
   *  istante sulla nuova camera». */
  it('takes the instant to the new camera, in the vocabulary that already exists', () => {
    expect(atParam(viewedInstant(T))).toBe(`?at=${T}`)
  })

  /**
   * And the other direction, which is the one that breaks. Live must carry
   * NOTHING: an `?at=<now>` would open camera B in recorded playback just
   * behind the live edge — a feeder, a seek, and a picture that never catches
   * up, for a gesture the operator reads as "show me this camera".
   */
  it('carries NOTHING when the primary is live, so the new camera opens live', () => {
    expect(atParam(viewedInstant(null))).toBe('')
  })

  it('rounds to a whole millisecond — one rounding, in one place', () => {
    expect(atParam(viewedInstant(T + 0.6))).toBe(`?at=${T + 1}`)
  })

  it('carries an epoch of zero rather than dropping it', () => {
    expect(atParam(viewedInstant(0))).toBe('?at=0')
  })
})

describe('the on-demand OVERLAY says live in words, never as now', () => {
  it('uses the playhead when there is one', () => {
    expect(resolveReelInstant(T)).toBe(T)
    expect(onDemandSeedSeekMs({ deviceId: 101, atMs: resolveReelInstant(T) })).toBe(T)
  })

  /**
   * The defect: live used to resolve to wall-clock now, and the overlay's
   * player was mounted with `initialSeekMs = now` — a RECORDED seek past the
   * archive's edge, parked at the newest closed segment until the next one
   * closed. Live must reach the player as NO seek at all.
   */
  it('mounts a live overlay with no seek', () => {
    expect(resolveReelInstant(null)).toBe('live')
    expect(onDemandSeedSeekMs({ deviceId: 101, atMs: resolveReelInstant(null) })).toBeUndefined()
  })

  /** The overlay and the swap now AGREE about live: neither carries an instant. */
  it('agrees with the swap about live', () => {
    const live = viewedInstant(null)
    expect(atParam(live)).toBe('')
    expect(resolveReelInstant(null)).toBe('live')
  })
})
