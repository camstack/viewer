/**
 * Which targets ONE links poll names — a slice, not the whole demand set.
 *
 * ## The burst this removes
 *
 * After D108 a target named in `getSnapshotLinks` is a capture order, and the
 * hub honours it only once the frame is older than its 15 s currency
 * (`LINK_CURRENT_MAX_AGE_MS` in `snapshot.addon.ts`). Naming every tile every
 * 5 s therefore does not capture every tile every 5 s — it captures every tile
 * whose frame just expired, and since they were all captured together the
 * last time, they all expire together: one poll in three found ~20 of the
 * tablet reel's 30 frames expired at once (hub, 2026-09-10 21:52–22:00:
 * `minted links … stale 5 / 5 / 19 / 5 / 5 / 21 / 5 / 6 / 23 …`), minted
 * most of them over the OLD frame because the batch wait is 750 ms, and two
 * cameras blew the 2.5 s mint deadline on every single cycle. The client then
 * fetched 20+ new frames through a 6-slot gate that shares the wire with the
 * live WebRTC plane: `snapshot fetch queued behind the plane`, 2–7 s waits.
 * Every card refreshed; every card refreshed in the same second, and the
 * hub paid for it in the same second.
 *
 * ## The rule
 *
 *  1. A target with no accepted row is named on EVERY poll until it has one.
 *     A cold tile paints as fast as it does today; a tile scrolled in is
 *     minted at once; a row that expired is re-minted at once.
 *  2. Every other target belongs to one of {@link SNAPSHOT_LINK_POLL_SLICES}
 *     slices — by a hash of its KEY, never by its index, so a neighbour
 *     scrolling in or out does not move anybody's turn — and is named when its
 *     slice's turn comes round.
 *
 * ## Why four slices, not three
 *
 * A named target is recaptured only if its frame is > 15 s old at the moment
 * it is named. Three slices at a 5 s poll is ~15 s + RPC time between namings,
 * and the previous capture landed some hundreds of ms AFTER its poll began —
 * so on a fast hub the frame can be 14.8 s old when its turn comes, be found
 * current, and wait a whole extra cycle (30 s, past the 30 s `stale` badge).
 * Four slices is ≥ 20 s between namings: every naming recaptures, every card
 * refreshes every ~20–23 s, the per-poll capture load is a quarter of the
 * reel, and the first cycle after a cold mount is the longest a card ever
 * waits.
 *
 * The poll cadence itself is untouched: `SNAPSHOT_LINKS_POLL_MS` stays 5 s and
 * the query key stays one key, so `viewer-hub-churn.spec.ts`'s catalogue and
 * D108's "the poll IS the capture trigger" both still hold.
 *
 * Takes the targets' KEYS alongside the targets rather than importing
 * `snapshotLinkTargetKey`: `use-snapshot-links.ts` imports this module, and a
 * value import back would be a cycle. The hook already has the keys.
 */
import type { SnapshotLinkTarget } from './use-snapshot-links.js'

/** How many polls a minted target waits between namings. See the docblock. */
export const SNAPSHOT_LINK_POLL_SLICES = 4

/**
 * A target's slice, from its key alone. FNV-1a over the key string: cheap,
 * and a `deviceId % 4` would put every camera of a sequential batch adoption
 * into the same two slices.
 */
export function snapshotLinkSliceOf(key: string, slices = SNAPSHOT_LINK_POLL_SLICES): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % slices
}

export interface LinkPollPlanInput {
  /** The full, sorted demand set. */
  readonly targets: readonly SnapshotLinkTarget[]
  /** `snapshotLinkTargetKey` of each target, same order. */
  readonly keys: readonly string[]
  /** Keys that currently hold an accepted, unexpired row. */
  readonly minted: ReadonlySet<string>
  /** This poll's ordinal; the caller counts. */
  readonly tick: number
  readonly slices?: number
}

/** The targets THIS poll names, in the input's order. Pure. */
export function planSnapshotLinkPoll({
  targets,
  keys,
  minted,
  tick,
  slices = SNAPSHOT_LINK_POLL_SLICES,
}: LinkPollPlanInput): readonly SnapshotLinkTarget[] {
  const turn = ((tick % slices) + slices) % slices
  return targets.filter((_, index) => {
    const key = keys[index]
    return key === undefined || !minted.has(key) || snapshotLinkSliceOf(key, slices) === turn
  })
}
