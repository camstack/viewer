/**
 * clip-row-playback — which ROW in the clips list is the one that is running,
 * and how far through it is.
 *
 * > *"quando una clip gira, si deve evidenziare, e mostrarne il progresso
 * > sulla stessa"* — the operator, 2026-09-23.
 *
 * ## Two facts, not one
 *
 * "This row is playing" and "this row is 40 % through" are independent claims
 * and the list had neither. They are kept apart here on purpose: a clip is
 * routinely the one on the frame while its progress is *unknown*, and a shape
 * that folded the two would have to invent a number to say the first.
 *
 * So {@link ClipRowPlayback} exists ONLY for the running row (absence in the
 * map the surface builds is "not playing", which is decided locally and is
 * never a read that failed), and the progress inside it is a declared verb
 * with an `unknown` arm rather than a number with a sentinel.
 *
 * ## `unknown` is not zero (D393)
 *
 * A streamed clip's length is often genuinely not known: the broker measures
 * it from the MP4 index once the file is open and says so
 * (`clip-progress.ts`), and until then — for an in-progress file, forever —
 * `ClipDuration.ms` is `null`. The broker's own log line for it is *"clip
 * playback: duration unknown — the source ended without a length"*.
 *
 * A bar drawn at 0 % on such a clip says "this file has not started", which is
 * false and which moves the moment a duration lands. The `unknown` arm is
 * drawn INDETERMINATE instead: the surface says the clip is running and
 * declines to say how far, which is exactly what is true.
 *
 * ## Two axes reach the same row
 *
 * A clips list holds cards of two provenances (`clips-surface.ts`), and the
 * thing that PLAYS them differs:
 *
 *  - a FILE the camera wrote takes the camera's frame and reports its position
 *    on the file's own axis (D575) — {@link clipRowFromHeld};
 *  - a clip DERIVED from our own recording is played by seeking the session,
 *    so its progress is the epoch playhead inside the card's own window —
 *    {@link clipRowFromEpoch}.
 *
 * Both end at the same shape, so the card draws one thing and never learns
 * which axis it came from.
 *
 * Pure: no React, no i18n, no network.
 */

import type { ClipProgress } from './clip-progress.js'
import { UNKNOWN_PROGRESS, knownProgress, type Progress } from '../lib/progress.js'

/**
 * How far through the running clip is.
 *
 * It IS `lib/progress.ts`'s {@link Progress} — an alias, not a parallel type.
 * A clip export reports the same way, and the second vocabulary is the one
 * that would have quietly lost its `unknown` arm.
 */
export type ClipRowProgress = Progress

/** The state of the ONE row that is running. Rows that are not get no value. */
export interface ClipRowPlayback {
  readonly progress: ClipRowProgress
}

export const UNKNOWN_CLIP_ROW_PLAYBACK: ClipRowPlayback = { progress: UNKNOWN_PROGRESS }

/**
 * The row whose FILE holds the camera's frame, from that file's own progress.
 *
 * `fraction` is already `null` whenever either the position or the duration is
 * unknown (`resolveClipProgress`), and that null is carried across as
 * `unknown` rather than collapsed.
 */
export function clipRowFromHeld(progress: ClipProgress): ClipRowPlayback {
  if (progress.fraction === null) return UNKNOWN_CLIP_ROW_PLAYBACK
  return { progress: knownProgress(progress.fraction) }
}

export interface ClipRowEpochInput {
  /** The card's window — the same `startMs`/`endMs` its time label reads. */
  readonly startMs: number
  readonly endMs: number
  /** Where our recorded pointer is, or `null` before any position has landed. */
  readonly playheadMs: number | null
  /**
   * The catalog's `endMs` is FROZEN: the file was still growing when it was
   * indexed, so the window is not a length and a fraction against it would
   * move as the row is re-indexed (`Clip.inProgress`).
   */
  readonly inProgress: boolean
}

/** The row being played by SEEKING our own footage, from the epoch playhead. */
export function clipRowFromEpoch(input: ClipRowEpochInput): ClipRowPlayback {
  if (input.inProgress) return UNKNOWN_CLIP_ROW_PLAYBACK
  if (input.playheadMs === null || !Number.isFinite(input.playheadMs)) {
    return UNKNOWN_CLIP_ROW_PLAYBACK
  }
  const span = input.endMs - input.startMs
  if (!Number.isFinite(span) || span <= 0) return UNKNOWN_CLIP_ROW_PLAYBACK
  return { progress: knownProgress((input.playheadMs - input.startMs) / span) }
}
