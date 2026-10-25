import { describe, it, expect } from 'vitest'
import { dedupeFragmentItems, type ObjectEvent } from '../event-cluster.js'

/**
 * The carousel shows one page per SUBJECT, and a track is the subject.
 *
 * Before 2026-08-01 this only INFERRED subject identity from class plus a time
 * gap — a guess the data already answers whenever `trackId` is present. Six
 * events of one person became six pages, each its own swipe and, within the
 * active window, its own image.
 */
/**
 * A real `ObjectEvent`, not a cast — the repo forbids them and a partial shape
 * would let the subject under test read a field the fixture never set.
 *
 * The TIMELINE's `ObjectEvent`, which is this module's own view model and is
 * NOT the hub's `pipeline-analytics` event: it is built from a TRACK
 * (`trackToTimelineEvent`, where `id` is `bestEventId ?? trackId`), so its id
 * is text and stays text even though a hub event id is now a number (D474).
 * The fixture used to import the cap type and pass structurally; when the two
 * diverged that coincidence was the only thing holding the spec up.
 */
const ev = (id: string, trackId: string | undefined, timestamp: number): ObjectEvent => ({
  id,
  deviceId: 101,
  className: 'person',
  timestamp,
  ...(trackId !== undefined ? { trackId } : {}),
})

describe('dedupeFragmentItems — one page per track', () => {
  it('collapses every event of one track to a single item', () => {
    const out = dedupeFragmentItems([
      ev('a', 't1', 1_000), ev('b', 't1', 2_000), ev('c', 't1', 3_000),
    ])
    expect(out).toHaveLength(1)
  })

  it('keeps distinct tracks apart even when they interleave in time', () => {
    // The old heuristic chained on class + gap, so two people crossing at once
    // could be folded together or split wrongly. Track ids cannot.
    const out = dedupeFragmentItems([
      ev('a', 't1', 1_000), ev('b', 't2', 1_500), ev('c', 't1', 2_000), ev('d', 't2', 2_500),
    ])
    expect(out).toHaveLength(2)
  })

  it('shows the LATEST event of a track when nothing ranks them apart', () => {
    // `betterFragment` ranks on importance first and falls back to the later
    // end. These fixtures carry no importance, so the fallback is what decides —
    // asserted deliberately rather than asserting a field the type does not have,
    // which is how the first draft of this spec was wrong.
    const out = dedupeFragmentItems([ev('early', 't1', 1_000), ev('late', 't1', 2_000)])
    expect(out.map((e) => e.id)).toEqual(['late'])
  })

  it('does NOT drop events that carry no track — audio and synthesised items', () => {
    const out = dedupeFragmentItems([ev('a', 't1', 1_000), ev('untracked', undefined, 500_000)])
    expect(out.map((e) => e.id).sort()).toEqual(['a', 'untracked'])
  })

  it('preserves the cluster newest-to-oldest presentation order', () => {
    const input = [ev('c', 't3', 3_000), ev('b', 't2', 2_000), ev('a', 't1', 1_000)]
    expect(dedupeFragmentItems(input).map((e) => e.id)).toEqual(['c', 'b', 'a'])
  })
})
