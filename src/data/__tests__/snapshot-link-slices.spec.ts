/**
 * The links poll names a SLICE of its targets per tick, so the hub's captures
 * are spread instead of bursting.
 *
 * ## The burst, measured (hub, 2026-09-10 21:52–22:00, tablet theater open)
 *
 * 31 targets named every ~5.8 s. The hub recaptures a target only when its
 * frame is older than its 15 s currency contract, so every third poll found
 * ~20 frames expired AT ONCE and minted 18–28 rows stale while the captures
 * ran (`snapshot: minted links … stale 5 / 5 / 19 / 5 / 5 / 21 …`), and two
 * cameras (1438, 3838) exceeded the 2.5 s mint deadline on every cycle. On the
 * client the same burst is 20+ image GETs into a 6-slot gate behind a live
 * WebRTC plane: `snapshot fetch queued behind the plane`, waits of 2–7 s,
 * queue depth up to 41. Every card refreshed, and every card refreshed in the
 * same second.
 *
 * ## The rule
 *
 * A target that has no accepted row yet is named on every poll until it has
 * one — a cold tile paints as fast as it does today. Every other target
 * belongs to ONE slice, by a hash of its key, and is named when its slice's
 * turn comes. Four slices at a 5 s poll is ≥ 20 s between namings, comfortably
 * past the hub's 15 s currency, so a named target is recaptured every time
 * rather than found "still current" and skipped for another cycle — which is
 * what three slices would risk on a fast hub.
 */
import { describe, expect, it } from 'vitest'

import {
  SNAPSHOT_LINK_POLL_SLICES,
  planSnapshotLinkPoll,
  snapshotLinkSliceOf,
} from '../snapshot-link-slices.js'
import { snapshotLinkTargetKey, type SnapshotLinkTarget } from '../use-snapshot-links.js'

function targets(ids: readonly number[], width = 384): readonly SnapshotLinkTarget[] {
  return ids.map((deviceId) => ({ deviceId, width }))
}

/** What the hook does: keys computed once, alongside the sorted targets. */
function plan(
  list: readonly SnapshotLinkTarget[],
  minted: ReadonlySet<string>,
  tick: number,
): readonly SnapshotLinkTarget[] {
  return planSnapshotLinkPoll({ targets: list, keys: list.map(snapshotLinkTargetKey), minted, tick })
}

const THIRTY = targets(Array.from({ length: 30 }, (_, i) => 103 + i * 7))
const NONE: ReadonlySet<string> = new Set()
const ALL_MINTED: ReadonlySet<string> = new Set(THIRTY.map(snapshotLinkTargetKey))

describe('planSnapshotLinkPoll', () => {
  it('names every target that has no accepted row yet, on any tick', () => {
    for (const tick of [0, 1, 2, 3, 7]) {
      expect(plan(THIRTY, NONE, tick)).toHaveLength(30)
    }
  })

  it('names only one slice of the minted targets per tick', () => {
    const named = plan(THIRTY, ALL_MINTED, 0)
    expect(named.length).toBeGreaterThan(0)
    expect(named.length).toBeLessThanOrEqual(Math.ceil(30 / SNAPSHOT_LINK_POLL_SLICES) + 3)
  })

  it('names every minted target exactly once per full cycle', () => {
    const seen = new Map<string, number>()
    for (let tick = 0; tick < SNAPSHOT_LINK_POLL_SLICES; tick += 1) {
      for (const target of plan(THIRTY, ALL_MINTED, tick)) {
        const key = snapshotLinkTargetKey(target)
        seen.set(key, (seen.get(key) ?? 0) + 1)
      }
    }
    expect(seen.size).toBe(30)
    expect([...seen.values()].every((count) => count === 1)).toBe(true)
  })

  it('a newcomer is named at once, next to the slice whose turn it is', () => {
    const newcomer: SnapshotLinkTarget = { deviceId: 9999, width: 384 }
    const all = [...THIRTY, newcomer]
    const named = plan(all, ALL_MINTED, 1)
    expect(named.some((t) => t.deviceId === 9999)).toBe(true)
    expect(named.length).toBeLessThan(all.length)
  })

  it("a target's slice does not move when its neighbours come and go", () => {
    // Index-based slicing would reshuffle every phase on a scroll. The slice
    // is a property of the KEY alone.
    const one: SnapshotLinkTarget = THIRTY[12]
    const turn = snapshotLinkSliceOf(snapshotLinkTargetKey(one))
    const fewer = THIRTY.filter((_, i) => i % 2 === 0)
    expect(plan(fewer, ALL_MINTED, turn).some((t) => t.deviceId === one.deviceId)).toBe(true)
    expect(plan(THIRTY, ALL_MINTED, turn).some((t) => t.deviceId === one.deviceId)).toBe(true)
  })

  it('two widths of one camera are two targets with their own turns', () => {
    const a = snapshotLinkTargetKey({ deviceId: 101, width: 384 })
    const b = snapshotLinkTargetKey({ deviceId: 101, width: 1564 })
    expect(a).not.toBe(b)
    expect(snapshotLinkSliceOf(a)).toBeLessThan(SNAPSHOT_LINK_POLL_SLICES)
    expect(snapshotLinkSliceOf(b)).toBeLessThan(SNAPSHOT_LINK_POLL_SLICES)
  })

  it('spreads thirty camera ids across the slices, not into one', () => {
    const counts = new Array<number>(SNAPSHOT_LINK_POLL_SLICES).fill(0)
    for (const target of THIRTY) counts[snapshotLinkSliceOf(snapshotLinkTargetKey(target))] += 1
    expect(Math.max(...counts)).toBeLessThanOrEqual(Math.ceil(30 / SNAPSHOT_LINK_POLL_SLICES) + 3)
    expect(Math.min(...counts)).toBeGreaterThan(0)
  })

  it('keeps the input order, so the positional answer still lines up', () => {
    expect(plan(THIRTY, NONE, 0).map((t) => t.deviceId)).toEqual(THIRTY.map((t) => t.deviceId))
  })
})
