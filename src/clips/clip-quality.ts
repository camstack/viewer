/**
 * clip-quality — which COPY of a clip the timeline asks for.
 *
 * ## The rule, and where it comes from
 *
 * > *"bisogna mostrare nella timeline IL profilo più basso di una clip
 * > disponibile"* — the operator, 2026-09-20.
 *
 * The timeline is the cheap surface: it plays the cheapest copy the ROW says it
 * has, and it offers no quality control (D559). Quality is a KEEP-time choice,
 * and as of 2026-09-23 the keep half exists: the tile creates an export with a
 * clip subject and asks which copy first when the row has two distinct ones
 * (`clip-export-quality.ts`, D558). This module is still the PLAYBACK half and
 * still answers ONE profile and never a list — the split is the point, and the
 * sentence here used to say the keep half "does not exist yet", which was true
 * for two days after D558 landed on the server and false afterwards.
 *
 * `ClipStreams` is resolved by the hub at LISTING time, so choosing a copy
 * never re-searches the camera (D549 15). The whole decision is therefore
 * readable off the row, before any call.
 *
 * ## Why `low` and `mid` are not two answers, and `auto` is none
 *
 * `low` and `mid` map to the SAME sub file. Offering both would be a non-choice
 * presented as a choice, and the surface would then owe an explanation for why
 * picking `mid` gets you `low`. `auto` is refused by the cap: the adaptive tier
 * is resolved from a live broker session and a stored file has none — the
 * viewer's live `auto` handling must never be reached from this path.
 *
 * ## The polarity, which is the opposite of the export path's, on purpose
 *
 * `EXPORT_SELECTION_PROFILE` is `'high'`, because *"exporting what I was
 * looking at would silently produce the worst copy the hub holds"*. A clip
 * TIMELINE plays at the lowest, because it is a scroll of cards on a phone.
 * Same app, opposite defaults, both right; anyone copying one into the other
 * will get it backwards unless both say why.
 *
 * Pure: no React, no i18n, no network.
 */

import type { Clip } from './clip-model.js'

/** The cheap file. `mid` resolves to the same bytes and is never asked for. */
export const CLIP_PROFILE_LOW = 'low'
/** The main twin — roughly 30x the sub (20.0 MB vs 0.67 MB, measured on 592). */
export const CLIP_PROFILE_HIGH = 'high'

/** A profile this surface is willing to ask a stored file for. */
export type ClipProfile = typeof CLIP_PROFILE_LOW | typeof CLIP_PROFILE_HIGH

/**
 * The cheapest copy the row says it has, or null to ask for nothing.
 *
 * Null is not "no clip": it is a row whose catalog resolved no twins (an older
 * hub, or a listing that could not pair them). Naming a profile we cannot
 * justify from the row would invite the provider to substitute one silently;
 * absence means "your own default", which is the only honest ask.
 */
export function cheapestClipProfile(clip: Clip): ClipProfile | null {
  const streams = clip.streams
  if (streams === undefined) return null
  if (streams.sub !== undefined) return CLIP_PROFILE_LOW
  if (streams.main !== undefined) return CLIP_PROFILE_HIGH
  return null
}

/** The provider served a different copy than the one asked for. */
export interface ClipServedMismatch {
  readonly asked: string
  readonly served: string
}

/**
 * Whether `served` disagrees with what was asked, so the surface can say so.
 *
 * D549 15: a missing twin is never served silently as the other. The catalog
 * row can be stale — it is a snapshot with a `catalogAsOf` — so this stays the
 * residual path even once the ask is derived from `streams`, and it must not be
 * swallowed: on a phone on cellular the difference is 30x the bytes.
 */
export function clipServedMismatch(
  asked: ClipProfile | null,
  served: string | null,
): ClipServedMismatch | null {
  if (asked === null || served === null) return null
  return asked === served ? null : { asked, served }
}
