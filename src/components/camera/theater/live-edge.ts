/**
 * live-edge — the pure "is this scrubbed epoch at the live edge?" predicate.
 *
 * TIME-based, not pixel-based: a fixed pixel slack mapped to wildly different
 * time spans across zoom levels (tens of minutes at coarse zoom), so the live
 * stream latched far too eagerly. We compare how far BEHIND the live edge (in ms)
 * the scrubbed epoch is against a constant time tolerance — consistent across
 * every zoom, using the SAME `topMs` reference the geometry + player position
 * share. `behindLiveMs === topMs - epoch`; 0 (or negative, on an over-scroll
 * bounce) means at/above the live edge.
 *
 * The live/scrub DECISION and its gating no longer live here. The single owner
 * of "am I live?" is the playback machine (`playback-machine.ts`); whether a
 * scroll frame is a user scrub vs our own auto-follow is decided by the
 * programmatic-scroll flag in `TheaterTimeline`. This module is just the math.
 */

export function atLiveEdge(behindLiveMs: number, toleranceMs: number): boolean {
  return behindLiveMs <= toleranceMs
}

/**
 * Is an UNFLAGGED scroll report a hand on the list?
 *
 * Going live from a scroll report is only right when the operator is the one
 * scrolling. A tap on a recent event seeks to `start − 2 s`, which sits inside
 * the live band, and the follower parks the list there; any later report we did
 * not flag (a layout shift when the cursor changes position, a content-height
 * clamp) reads as "scrolled home" and used to send the picture back to LIVE.
 * A finger down, momentum, or an active scrub is a hand; so is any report on
 * the web, where a mouse wheel scrolls with none of those signals.
 */
export function scrollIsHand(input: {
  readonly pointerDown: boolean
  readonly momentum: boolean
  readonly scrubActive: boolean
  readonly web: boolean
}): boolean {
  return input.web || input.pointerDown || input.momentum || input.scrubActive
}
