/**
 * The tile-transition trail logs STATE CHANGES, not the passage of time.
 *
 * Measured on the operator's phone, 2026-09-09, two hours of ordinary use:
 * `media:snapshot` produced 4 098 of the 9 536 client log lines shipped to the
 * hub — 43% of everything the app said — peaking at 421 lines in ONE minute,
 * seven a second, while he was doing nothing but looking at the camera grid.
 * `tile transition` was 498 of 30 minutes' 726.
 *
 * The cause is in the signature, not in the volume of events: it carried
 * `age=fresh|stale|ancient`, a class derived from the snapshot's age. That
 * class flips on its own as a tile sits there — no state changed, the clock
 * moved — and every tile re-logged when it did. A grid of twelve cameras
 * therefore emitted a burst at 60 s and again at 5 min, forever, on a screen
 * nobody was touching.
 *
 * The age is still worth having ON the line; it is not a reason FOR one. It
 * stays a field and leaves the signature, so a tile logs when its state
 * genuinely changes — enabled, uri, failure, which layer is painting — and the
 * age of that state is readable in the same entry.
 *
 * This is the same discipline `snapshot-paint-log.ts` already applies to
 * paints, which is why `image displayed` was 116 lines where this was 498.
 */
import { describe, expect, it } from 'vitest'
import { snapshotTransitionSignature } from '../snapshot-transition-signature.js'

const BASE = {
  enabled: true,
  uri: 'https://hub/snap.jpg',
  stateReason: null,
  failed: false,
  awaitingFrame: false,
  cachedFileSupported: true,
  cachedFileUri: 'file:///cache/snap.jpg',
  neverCaptured: false,
} as const

describe('the snapshot tile-transition signature', () => {
  it('does not change when only the snapshot ages', () => {
    const fresh = snapshotTransitionSignature({ ...BASE, ageMs: 1_000 })
    const stale = snapshotTransitionSignature({ ...BASE, ageMs: 120_000 })
    const ancient = snapshotTransitionSignature({ ...BASE, ageMs: 9_000_000 })
    expect(stale).toBe(fresh)
    expect(ancient).toBe(fresh)
  })

  it('still changes on every state a human would ask about', () => {
    const base = snapshotTransitionSignature({ ...BASE, ageMs: 1_000 })
    expect(snapshotTransitionSignature({ ...BASE, ageMs: 1_000, enabled: false })).not.toBe(base)
    expect(snapshotTransitionSignature({ ...BASE, ageMs: 1_000, uri: null })).not.toBe(base)
    expect(snapshotTransitionSignature({ ...BASE, ageMs: 1_000, failed: true })).not.toBe(base)
    expect(snapshotTransitionSignature({ ...BASE, ageMs: 1_000, awaitingFrame: true })).not.toBe(
      base,
    )
    expect(snapshotTransitionSignature({ ...BASE, ageMs: 1_000, cachedFileUri: null })).not.toBe(
      base,
    )
    expect(
      snapshotTransitionSignature({ ...BASE, ageMs: 1_000, cachedFileSupported: false }),
    ).not.toBe(base)
    expect(snapshotTransitionSignature({ ...BASE, ageMs: 1_000, neverCaptured: true })).not.toBe(
      base,
    )
    expect(
      snapshotTransitionSignature({ ...BASE, ageMs: 1_000, stateReason: 'privacy-mask' }),
    ).not.toBe(base)
  })

  it('carries no age class at all — the age belongs to the line, not the key', () => {
    const sig = snapshotTransitionSignature({ ...BASE, ageMs: 1_000 })
    expect(sig).not.toMatch(/fresh|stale|ancient|age=/)
  })
})
