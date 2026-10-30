/**
 * The key that decides when a snapshot tile writes a `tile transition` line.
 *
 * ## Why the age is not in it
 *
 * The signature used to carry `age=fresh|stale|ancient`, a class derived from
 * how old the painted snapshot was. That class changes ON ITS OWN — the tile
 * does nothing, the clock moves past 60 s and again past 5 min — so every tile
 * on screen re-logged twice for having sat still. Measured on the operator's
 * phone 2026-09-09 over two hours of ordinary use: `media:snapshot` was 4 098
 * of the 9 536 client lines shipped to the hub, 43% of everything the app said,
 * peaking at 421 lines in a single minute on a grid nobody was touching.
 *
 * ## Why `awaitingFrame` is not in it either
 *
 * Every 5 s snapshot refresh flips a tile waiting -> ready, so with it in the
 * key each tile logged twice per poll: ~8 000 `tile transition` lines an hour
 * from one viewer. The routine refresh cycle is not a transition worth a line;
 * a tile STUCK waiting is reported separately, once, by `stuckWaitingMs`. The
 * cached file's presence (`file` vs `file-empty`) flips on the same cycle and
 * is collapsed for the same reason; only whether the platform HAS the cache
 * is part of the key.
 *
 * The age is still on the line as `ageMs`. It is a property of the state, not
 * a reason to announce one — and a trail that fires on a clock buries the
 * transitions it exists to show.
 */

/** Everything a tile's state is made of, as the trail understands it. */
export interface SnapshotTransitionInputs {
  readonly enabled: boolean
  readonly uri: string | null
  readonly stateReason: string | null
  readonly failed: boolean
  /** Kept in the shape for the caller; deliberately UNUSED (see below). */
  readonly awaitingFrame: boolean
  /** Whether this platform has the on-disk snapshot cache at all. */
  readonly cachedFileSupported: boolean
  /** The cached file actually in hand, when the platform supports one. */
  readonly cachedFileUri: string | null
  readonly neverCaptured: boolean
  /** Kept in the shape for the caller's convenience; deliberately UNUSED. */
  readonly ageMs: number | null
}

/**
 * Build the transition key. Two calls that differ only in `ageMs` return the
 * same string — that is the whole point, and `snapshot-transition-log-rate`
 * pins it.
 */
export function snapshotTransitionSignature(inputs: SnapshotTransitionInputs): string {
  return [
    inputs.enabled ? 'en' : 'off',
    inputs.uri === null ? 'nouri' : 'uri',
    `sr=${inputs.stateReason ?? '-'}`,
    inputs.failed ? 'failed' : 'ok',
    // Which layer is painting. A miss rate that differs between the file cache
    // and the network path is otherwise indistinguishable in the trail.
    inputs.cachedFileSupported ? 'file' : 'net',
    inputs.neverCaptured ? 'nc' : '-',
  ].join('|')
}

/** A tile waiting for a frame longer than this is logged once as stuck. */
export const SNAPSHOT_STUCK_WAITING_MS = 30_000
