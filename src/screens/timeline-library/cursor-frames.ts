/**
 * cursor-frames — which cameras the Library timeline draws a still of at the
 * cursor, and WHEN it asks the recorder for them.
 *
 * The Library timeline has no picture of its own: its "stream slot" holds a
 * small grid of stills, one per camera, cut from the recorded footage at the
 * instant the cursor is on. Two rules keep that cheap enough to sit under a
 * finger that is scrubbing:
 *
 *  - **A cap on tiles.** Twenty cameras are twenty ffmpeg one-shots on the hub
 *    per cursor move; the grid draws at most {@link frameTileCap} of them and
 *    says how many it left out. The cap follows the room, not the fleet.
 *  - **Frames wait for the release.** While a drag is in flight only the cursor
 *    and the bands move; the instant frames are loaded for does not change
 *    until the drag has ended and {@link FRAME_SETTLE_MS} has passed
 *    ({@link settleInstant}), so a scrub across a day costs zero still reads.
 *
 * Pure — no React, no network.
 */

/** Quiet time after the release before the frames follow the cursor. */
export const FRAME_SETTLE_MS = 250

/**
 * How far behind "now" the live edge's frames are cut.
 *
 * The recorder's still route decodes footage that was already written; the
 * newest few seconds are not closed yet, and asking for them answers 204, which
 * the tile would show as "no footage". The tile is honest about the moment it
 * shows (its caption reads the instant), so lagging is not a lie.
 */
export const LIVE_FRAME_LAG_MS = 15_000

/** Tiles on a phone-wide box, a tablet-wide box and anything wider. */
const TILE_CAP_PHONE = 4
const TILE_CAP_TABLET = 6
const TILE_CAP_DESKTOP = 9

/** Width thresholds (pt) of the three caps — the viewer's own breakpoints. */
const PHONE_MAX_WIDTH = 600
const TABLET_MAX_WIDTH = 1000

/** The most tiles a box of this width may carry. */
export function frameTileCap(boxWidth: number): number {
  if (boxWidth < PHONE_MAX_WIDTH) return TILE_CAP_PHONE
  if (boxWidth < TABLET_MAX_WIDTH) return TILE_CAP_TABLET
  return TILE_CAP_DESKTOP
}

export interface FrameTilePlan<T> {
  /** The cameras that get a tile, in scope order. */
  readonly shown: readonly T[]
  /** How many the cap left out — never silently dropped, the grid says so. */
  readonly hidden: number
}

/** Cut a scope at the cap, keeping its order (the head is the first camera the
 *  operator picked, and the one an over-large scope may never cost). */
export function planFrameTiles<T>(cameras: readonly T[], cap: number): FrameTilePlan<T> {
  const limit = Math.max(0, Math.floor(cap))
  return {
    shown: cameras.slice(0, limit),
    hidden: Math.max(0, cameras.length - limit),
  }
}

/**
 * The wall-clock instant the cursor is on, for a still.
 *
 * `activeEpoch` is the playback machine's own reading (the seek preview while
 * dragging, else the playhead) and is null at the live edge, where the cursor
 * is "now" — lagged by {@link LIVE_FRAME_LAG_MS}.
 */
export function cursorInstant(activeEpoch: number | null, nowMs: number): number {
  return activeEpoch ?? nowMs - LIVE_FRAME_LAG_MS
}

export interface SettleState {
  /** The instant the frames are currently loaded for. */
  readonly settled: number
  /** The instant the cursor is on now. */
  readonly pending: number
  /** A drag is in flight. */
  readonly scrubbing: boolean
}

/**
 * The instant the frames should be loaded for after `pending` has been quiet:
 * the settled one while a drag is in flight (nothing moves), the pending one
 * once it has ended. The debounce itself is the hook's timer; this is the
 * decision it takes when the timer fires.
 */
export function settleInstant(state: SettleState): number {
  return state.scrubbing ? state.settled : state.pending
}
