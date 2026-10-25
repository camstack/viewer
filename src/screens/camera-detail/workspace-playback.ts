/**
 * workspace-playback — the timeline's transport commands reaching the WALL as
 * well as the picture.
 *
 * ## Why this is a wrapper and not a change to the timeline
 *
 * `TheaterTimeline` drives the camera in the picture through the props the
 * screen hands it, and that path is the one the playback machine owns end to
 * end. With a view populated, the same tap has to reach the other cameras too —
 * but they are not React children of this screen on iOS or web: they are tiles
 * inside a WebView. Nothing here can call a method on them.
 *
 * `live/playback-bus.ts` is the seam that already solved this for the grid
 * screen, and its sink shape is `PlaybackControlSink` plus a rate ON PURPOSE,
 * so the verbs below are the ones the single-camera timeline already speaks.
 * `GridLiveEmbed` — the very component the wall mounts — registers a sink for
 * as long as it is mounted, which means this needs no gate: with no wall on
 * screen the broadcast reaches zero sinks and costs one map iteration.
 *
 * The wrapping is here rather than inside the timeline because the timeline
 * must keep NOT knowing how the cells are rendered. It changes what it queries,
 * not who draws.
 *
 * Pure — the bus is injected, so the fan-out is asserted by value.
 */
import type { GridPlaybackSink } from '../../live/playback-bus.js'
import type { ScrubSource } from '../../recording/playback-machine.js'

/** Apply `fn` to every registered player surface; returns how many it reached. */
export type PlaybackBroadcast = (fn: (sink: GridPlaybackSink) => void) => number

/** The scrub-move hint the timeline passes through — opaque here. */
export interface ScrubMoveHint {
  readonly mode: 'fine' | 'coarse'
  readonly velocityPxPerS: number
}

/**
 * The transport handlers the theater timeline is given, restricted to the ones
 * that MEAN something for a set of cameras.
 *
 * Every member has a `GridPlaybackSink` twin. Anything singular — the export,
 * the snapshot, PTZ — is deliberately absent: those left the timebar rather
 * than being fanned out, because "pan every camera at once" is not an
 * operation, and a control that silently acted on one camera out of six would
 * be worse than no control.
 */
export interface WallPlayback {
  readonly onSeek: (epochMs: number, source: ScrubSource) => void
  readonly onScrubBegin: (source: ScrubSource) => void
  readonly onScrubMove: (epochMs: number, source: ScrubSource, hint?: ScrubMoveHint) => void
  readonly onScrubCommit: (epochMs: number, source: ScrubSource) => void
  readonly onGoLive: () => void
  readonly onTogglePlayPause: () => void
  readonly onSelectRate: (rate: number) => void
}

export interface WallPlaybackInput {
  /** The handlers that drive the camera in the picture. Always called, first. */
  readonly primary: WallPlayback
  readonly broadcast: PlaybackBroadcast
  /**
   * Whether the picture is paused RIGHT NOW.
   *
   * The timeline's play/pause is a TOGGLE while the sink takes a rate, so the
   * wall has to be told the state the toggle is about to produce. Reading it
   * from the caller keeps one source of truth: deriving a second "is it
   * playing" here is how the wall and the picture end up disagreeing after a
   * transport error nudges one of them.
   */
  readonly paused: boolean
}

/**
 * Wrap the primary handlers so each one also reaches the wall.
 *
 * The picture is driven FIRST in every case. It is the surface the operator is
 * looking at, and if a broadcast were ever to throw before it (it cannot — the
 * bus catches per sink — but ordering is cheaper than trusting that) the
 * camera in front of them would be the one that failed to move.
 */
export function fanOutPlaybackToWall(input: WallPlaybackInput): WallPlayback {
  const { primary, broadcast, paused } = input
  return {
    onSeek: (epochMs, source) => {
      primary.onSeek(epochMs, source)
      broadcast((sink) => sink.seek(epochMs))
    },
    onScrubBegin: (source) => {
      primary.onScrubBegin(source)
      broadcast((sink) => sink.scrubStart())
    },
    onScrubMove: (epochMs, source, hint) => {
      primary.onScrubMove(epochMs, source, hint)
      broadcast((sink) => sink.scrubTo(epochMs))
    },
    onScrubCommit: (epochMs, source) => {
      primary.onScrubCommit(epochMs, source)
      broadcast((sink) => sink.scrubCommit(epochMs))
    },
    onGoLive: () => {
      primary.onGoLive()
      broadcast((sink) => sink.goLive())
    },
    onTogglePlayPause: () => {
      primary.onTogglePlayPause()
      // The state the toggle PRODUCES, not the one it leaves: a wall that
      // received the current rate would pause exactly when the picture resumed.
      broadcast((sink) => sink.setRate(paused ? 1 : 0))
    },
    onSelectRate: (rate) => {
      primary.onSelectRate(rate)
      broadcast((sink) => sink.setRate(rate))
    },
  }
}
