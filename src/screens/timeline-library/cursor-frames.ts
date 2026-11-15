/**
 * cursor-frames — which cameras the Library timeline draws a still of at the
 * cursor, and WHEN it asks the recorder for them.
 *
 * The Library timeline has no picture of its own: its "stream slot" holds a
 * grid of stills, one per camera in the scope, cut from the recorded footage at
 * the instant the cursor is on. The grid draws EVERY camera the operator picked
 * (issue 557 removed the per-width cap and its "+N more" note; the camera
 * picker is what narrows the wall) and fills its box ({@link fillFrameGrid}).
 *
 *  - **Live scrub on a small scope.** With at most
 *    {@link LIVE_SCRUB_MAX_CAMERAS} cameras the stills follow a drag, at most
 *    once per {@link SCRUB_FRAME_INTERVAL_MS}. Measured on the operator's hub
 *    (one request in flight per tile): 4 cameras answer at p50 32 ms / p90
 *    43 ms (29 frames/s per tile), 8 cameras at p50 64 ms / p90 79 ms
 *    (15 frames/s) — the hub copes with 8, but four tiles is where a phone
 *    still keeps up.
 *  - **Otherwise frames wait for the release.** While a drag is in flight only
 *    the cursor and the bands move; the instant frames are loaded for changes
 *    once the drag has ended and {@link FRAME_SETTLE_MS} has passed
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

/** The largest scope whose stills follow a drag live. */
export const LIVE_SCRUB_MAX_CAMERAS = 4

/** At most one still request per tile per this interval while scrubbing live. */
export const SCRUB_FRAME_INTERVAL_MS = 100

/** Does a scope of this size scrub live? */
export function scrubsLive(cameraCount: number): boolean {
  return cameraCount > 0 && cameraCount <= LIVE_SCRUB_MAX_CAMERAS
}

/** A grid of `count` tiles stretched over a box: every cell the same size. */
export interface FrameGrid {
  readonly cols: number
  readonly rows: number
  readonly cellW: number
  readonly cellH: number
}

/**
 * Fill the box: `cols` is the column split the wall's own area-maximising
 * rule picks (`computeGridLayout`, passed in so this stays pure), and the cells
 * then STRETCH to the whole box, gaps included — the picture is cropped to the
 * cell, so no band of empty space is left around a 16:9 block.
 */
export function fillFrameGrid(
  count: number,
  boxW: number,
  boxH: number,
  gap: number,
  cols: number,
): FrameGrid {
  if (count <= 0 || boxW <= 0 || boxH <= 0) return { cols: 0, rows: 0, cellW: 0, cellH: 0 }
  const c = Math.max(1, Math.min(count, Math.floor(cols)))
  const rows = Math.ceil(count / c)
  return {
    cols: c,
    rows,
    cellW: Math.max(0, Math.floor((boxW - gap * (c - 1)) / c)),
    cellH: Math.max(0, Math.floor((boxH - gap * (rows - 1)) / rows)),
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
  /** The scope is small enough to follow a drag ({@link scrubsLive}). */
  readonly live?: boolean
}

/**
 * The instant the frames should be loaded for when the hook's timer fires: the
 * settled one while a drag is in flight on a large scope (nothing moves), the
 * pending one once it has ended — or at once on a live-scrub scope.
 */
export function settleInstant(state: SettleState): number {
  return state.scrubbing && state.live !== true ? state.settled : state.pending
}
