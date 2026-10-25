/**
 * clip-progress — WHERE inside the file the picture is, and against WHAT.
 *
 * ## Two axes on one wire
 *
 * The embed reports the player's position as `positionMs`, and the server
 * sends it as `epochMs`. While a clip holds the pointer BOTH names lie: the
 * number is milliseconds from the first sample of the FILE (D575), and no
 * epoch is involved. `routePlayerPosition` is the one place that decides
 * which axis a report is on, from the one authority that knows — the clip
 * stage. Before it existed every report went to the playback machine, which
 * ignores positions unless it is in `playback` mode — so on a camera whose
 * timeline had been scrubbed before the clip was opened, a report of
 * "12 000" landed as the playhead and the indicator jumped to 1970.
 *
 * ## The duration is measured, or it is unknown — never zero
 *
 * `Clip.inProgress === true` means the catalog's `endMs` is NOT this file's
 * end: the camera's index froze it while the file grows (107: the same
 * `endTime` for eight minutes). A progress bar drawn against that end is a
 * lie that moves. The broker MEASURES the length from the MP4 index once the
 * clip is open and reports it (`clipDuration`); until it has, a closed clip
 * may borrow the catalog span, an in-progress one may not, and "unknown" is
 * drawn as unknown — a fill of 0 % would say the file is empty (D393).
 *
 * Pure: no React, no i18n, no network.
 */

import type { ClipStage } from './clip-stage.js'
import type { ClipControlsView } from './clip-controls.js'
import { clampFraction } from '../lib/progress.js'

/** Where a duration came from, so the surface can say it. */
export type ClipDurationSource = 'measured' | 'index' | 'unknown'

export interface ClipDurationInput {
  /** The broker's measurement for THIS clip, or `null` when none has landed. */
  readonly measuredMs: number | null
  /** The catalog row's span — `endMs` is a claim about the file's end. */
  readonly startMs: number
  readonly endMs: number
  /** The catalog's `endMs` is frozen: the file was still growing when indexed. */
  readonly inProgress: boolean
}

export interface ClipDuration {
  /** `null` ⟺ unknown. Never 0. */
  readonly ms: number | null
  readonly source: ClipDurationSource
}

export const UNKNOWN_CLIP_DURATION: ClipDuration = { ms: null, source: 'unknown' }

export function resolveClipDuration(input: ClipDurationInput): ClipDuration {
  if (input.measuredMs !== null && Number.isFinite(input.measuredMs) && input.measuredMs > 0) {
    return { ms: input.measuredMs, source: 'measured' }
  }
  // A growing file's catalog end is not its end. Unknown, whatever the span says.
  if (input.inProgress) return UNKNOWN_CLIP_DURATION
  const span = input.endMs - input.startMs
  if (!Number.isFinite(span) || span <= 0) return UNKNOWN_CLIP_DURATION
  return { ms: span, source: 'index' }
}

export interface ClipProgress {
  /** File-relative position, or `null` before the first report. */
  readonly positionMs: number | null
  readonly duration: ClipDuration
  /** 0..1, or `null` when either side is unknown. */
  readonly fraction: number | null
}

export const EMPTY_CLIP_PROGRESS: ClipProgress = {
  positionMs: null,
  duration: UNKNOWN_CLIP_DURATION,
  fraction: null,
}

export function resolveClipProgress(positionMs: number | null, duration: ClipDuration): ClipProgress {
  if (positionMs === null || duration.ms === null) return { positionMs, duration, fraction: null }
  return { positionMs, duration, fraction: clampFraction(positionMs / duration.ms) }
}

/**
 * Re-exported, not redefined. The canonical clamp lives in `lib/progress.ts`
 * with the `known | unknown` vocabulary it belongs to — a second copy here is
 * how the clip axis and the export progress would end up rounding differently.
 */
export { clampFraction }

/** The px→fraction half of a drag on the track. */
export function fractionAtX(x: number, trackWidth: number): number {
  if (!(trackWidth > 0)) return 0
  return clampFraction(x / trackWidth)
}

/** The fraction→ms half: where a release at `fraction` commits, in file ms. */
export function clipOffsetAtFraction(fraction: number, durationMs: number): number {
  return Math.round(clampFraction(fraction) * Math.max(0, durationMs))
}

/**
 * A "file-relative" report at or above this is an EPOCH that arrived late —
 * ~3.2 years of milliseconds, which no clip reaches and every epoch exceeds.
 * The server disposes the old feeder before it builds the clip's, but a
 * position already on the channel can still land after the stage flipped.
 */
export const CLIP_POSITION_EPOCH_FLOOR_MS = 100_000_000_000

export type PlayerPositionRoute =
  /** A clip holds the frame: the number is file-relative, for the clip surface. */
  | { readonly kind: 'clip'; readonly clipId: string; readonly positionMs: number }
  /** The session's own footage: an epoch, for the playback machine. */
  | { readonly kind: 'session'; readonly epochMs: number }
  /** A clip holds the frame but the number is an epoch — a straggler from the
   *  feeder the clip replaced. Dropped, and the drop is counted. */
  | { readonly kind: 'dropped'; readonly clipId: string; readonly reportedMs: number }

export function routePlayerPosition(stage: ClipStage, reportedMs: number): PlayerPositionRoute {
  if (stage.kind !== 'clip') return { kind: 'session', epochMs: reportedMs }
  if (reportedMs >= CLIP_POSITION_EPOCH_FLOOR_MS) {
    return { kind: 'dropped', clipId: stage.clipId, reportedMs }
  }
  return { kind: 'clip', clipId: stage.clipId, positionMs: Math.max(0, reportedMs) }
}

/**
 * The seek gesture on the clip's own track, in the three moments the scrub
 * family already has. `begin` mints the drag id; `commit` carries it.
 */
export interface ClipSeekBinding {
  readonly onSeekBegin: () => void
  readonly onSeekMove: (positionMs: number) => void
  readonly onSeekCommit: (positionMs: number) => void
}

/** Everything the progress control needs, from the one hook that owns the clip. */
export interface ClipProgressBinding extends ClipSeekBinding {
  readonly progress: ClipProgress
  /**
   * What this camera's clips may be driven to do, and how well that is known
   * (`clip-controls.ts`, D612).
   *
   * Carried on the binding rather than re-derived by the control, for the
   * reason D602 was written in the first place: the refusal already exists in
   * `use-clip-stage`'s commit, and a bar that does not know about it lets the
   * operator drag backwards and then snaps forward under their finger. A
   * control that undoes the gesture reads as BROKEN, where a control that
   * cannot be dragged there reads as unavailable (D62).
   *
   * The PRESENCE travels with it because a track may only be locked on an
   * answer that arrived: a pending read must not draw a dead control (D315).
   */
  readonly controls: ClipControlsView
}
