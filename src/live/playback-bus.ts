/**
 * The fan-out between ONE timeline and N player surfaces.
 *
 * A wall renders its cells three different ways — the shared server embed in
 * a single WebView (iOS), the same page in an iframe (web), and the native
 * per-tile wall (Android) — and each of those owns its cells differently. A
 * timeline that reached into the players directly would need one code path per
 * platform, in the screen, and every future surface would have to remember to
 * add itself.
 *
 * It lived under `grid/timeline/` until 2026-09-02, next to the grid page's own
 * timeline. That timeline is gone — the grid page mounts the theater's — and
 * the bus outlived it because it was never part of it: BOTH surfaces that
 * aggregate cameras drive their walls through here (`workspace-playback.ts` for
 * camera-detail, `GridWallTimeline` for the grid page). Leaving it in a
 * directory named after the deleted component would have read as a leftover of
 * it.
 *
 * So the timeline does not know the players at all: it broadcasts onto a bus,
 * and whoever renders cells REGISTERS a sink for as long as it is mounted. One
 * sink can stand for many cells (the embed forwards a single command that the
 * page applies to every tile) or for exactly one (a native tile registering its
 * own `LiveViewHandle`) — the bus does not care, which is the point.
 *
 * The sink shape is `recording/playback-machine.ts`'s `PlaybackControlSink`
 * plus a transport rate, so a native tile can register its `LiveViewHandle`
 * essentially as-is and the seek path is the SAME one the single-camera
 * timeline already drives — no second seeking implementation.
 *
 * Pure (no react) so the registry semantics are unit-testable.
 */
import { log } from '../lib/logger.js'

/** What the grid timeline can ask of a player surface. Structurally a superset
 *  of `PlaybackControlSink` (which has no rate). */
export interface GridPlaybackSink {
  /** A drag started — suspend background loading until it settles. */
  scrubStart(): void
  /** Throttled drag preview. */
  scrubTo(epochMs: number): void
  /** The single commit at the release: decode-accurate resume. */
  scrubCommit(epochMs: number): void
  /** Jump to `epochMs` without a drag (a cluster tap, a keyboard nudge). */
  seek(epochMs: number): void
  /** 0 = paused, 1 = play. */
  setRate(rate: number): void
  /** Leave recorded playback, return to the live edge. */
  goLive(): void
}

export interface GridPlaybackBus {
  /** Register `sink` under `key`; returns the unregister. Registering the same
   *  key twice REPLACES the sink (a remounted surface must not double-fire). */
  register(key: string, sink: GridPlaybackSink): () => void
  /** Apply `fn` to every registered sink. Returns how many it reached, so a
   *  caller can log a broadcast that landed nowhere. */
  broadcast(fn: (sink: GridPlaybackSink) => void): number
  /** How many sinks are registered right now. */
  size(): number
  /** Drop every sink (grid unmount / camera-set change). */
  clear(): void
}

export function createGridPlaybackBus(): GridPlaybackBus {
  const sinks = new Map<string, GridPlaybackSink>()
  return {
    register(key: string, sink: GridPlaybackSink): () => void {
      sinks.set(key, sink)
      return (): void => {
        // Only remove OUR sink: a fast remount can register the replacement
        // before the old effect's cleanup runs, and an unconditional delete
        // would then unregister the live one.
        if (sinks.get(key) === sink) sinks.delete(key)
      }
    },
    broadcast(fn: (sink: GridPlaybackSink) => void): number {
      let reached = 0
      // Snapshot: a sink may unregister itself while being driven (a tile that
      // errors out and tears down), and mutating the map mid-iteration would
      // skip its neighbour.
      for (const sink of [...sinks.values()]) {
        try {
          fn(sink)
          reached++
        } catch (err) {
          // One broken surface must never stop the others from seeking — that
          // is the whole reason the grid scrub is a broadcast and not a loop
          // over a list the caller owns.
          log.warn('grid:playback-bus', 'sink threw during broadcast', { error: String(err) })
        }
      }
      return reached
    },
    size(): number {
      return sinks.size
    },
    clear(): void {
      sinks.clear()
    },
  }
}

/** The process-wide bus. There is at most one wall on screen; the surface that
 *  renders cells registers for as long as it is mounted. */
export const gridPlaybackBus: GridPlaybackBus = createGridPlaybackBus()
