/**
 * clip-export-quality — WHICH copy of a clip the operator is keeping, and
 * whether there is anything to ask him.
 *
 * > *"se abbiamo gia' i profili disponibili su una clip allora va bene,
 * > mostriamo un piccolo modal dove far selezionare la qualita'"* — the
 * > operator, 2026-09-23.
 *
 * ## The copies come off the ROW, and from nowhere else
 *
 * `Clip.streams` is resolved by the hub at LISTING time (D549 15), so the whole
 * decision is readable before any call and choosing a copy never re-searches
 * the camera. It is deliberately NOT read from the provider's playback envelope
 * (`videoclips.getPlaybackOptions`): that describes how a clip can be DRIVEN —
 * transport, seek, step, rates — and the copies that exist vary per clip. Two
 * authorities on one fact is the shape this app has spent a week removing.
 *
 * ## `low` and `mid` are one copy, so they are one entry
 *
 * They map to the same sub file (`clip-quality.ts`). Offering both would be a
 * non-choice presented as a choice, and the surface would then owe an
 * explanation for why picking `mid` got you `low`. `auto` is not a member at
 * all: a stored file has no broker session and the adaptive tier cannot be
 * resolved for it.
 *
 * The test for "a real choice" is therefore not "the row has two fields" but
 * **two DISTINCT copies**: `main` and `sub` both present and addressing
 * different bytes (`ClipStream.id`). A row whose twins resolved to one id is
 * one copy wearing two names, and it gets no dialog.
 *
 * ## The default is `high`, and the polarity is on purpose
 *
 * The timeline plays the CHEAPEST copy because it is a scroll of cards on a
 * phone (D559). A keep is the opposite: handing over the worst copy the hub
 * holds is exactly what `EXPORT_SELECTION_PROFILE` was pinned to `high` to
 * avoid. Both rules say why, because anyone copying one into the other gets it
 * backwards.
 *
 * ## The ceiling is a fact the surface can already know
 *
 * `recording-export` reads a clip's bytes ONCE, by handle, under
 * `RECORDING_EXPORT_MAX_READ_BYTES` (50 MiB), and a read above it is
 * **refused, never truncated** — `too-large-to-transfer` on the record. The
 * catalog row already carries `bytes` per copy, so a copy that will certainly
 * be refused is knowable before the tap. Offering it anyway would spend an
 * operator's attention on a job engineered to fail.
 *
 * And the other half of the same rule: `bytes` is often absent, and an absent
 * size is **not** a refusal. `refusal: null` covers both "it fits" and "the row
 * did not say", because only the first can be asserted and the second must not
 * block a keep that would have worked.
 *
 * Pure: no React, no i18n, no network.
 */

import { RECORDING_EXPORT_MAX_READ_BYTES } from '@camstack/types/client'
import { CLIP_PROFILE_HIGH, CLIP_PROFILE_LOW, type ClipProfile } from './clip-quality.js'
import type { Clip, ClipStream } from './clip-model.js'

/**
 * The transfer ceiling, as this surface reads it.
 *
 * Imported, never re-spelled: it is a published value in `@camstack/types`
 * (52 428 800) and a local copy would drift the day the hub raises it, in the
 * direction that hides options the export path would have accepted.
 */
export const CLIP_EXPORT_MAX_BYTES: number = RECORDING_EXPORT_MAX_READ_BYTES

/** Why a copy cannot be asked for. A token, so the surface picks the words. */
export type ClipQualityRefusal = 'too-large'

export interface ClipQualityOption {
  readonly profile: ClipProfile
  /** What the ROW says this copy weighs. `null` ⟺ the row did not say. */
  readonly bytes: number | null
  /**
   * The export path will refuse this copy before it fetches it.
   *
   * `null` means "it will not, as far as this row can tell" — which covers a
   * copy that fits AND a copy whose size is unknown. Unknown is never a
   * refusal (D393): an unread size is no evidence of a big file.
   */
  readonly refusal: ClipQualityRefusal | null
}

/**
 * What the tile's control should do about quality.
 *
 * `direct` — one copy to offer. **No modal**: a dialog with one option is
 *   friction pretending to be agency, and the press must keep doing what it
 *   does today, immediately.
 * `choice` — two distinct copies. The modal, with the sizes, because the size
 *   is the thing that makes the choice mean anything (20.0 MB main vs 0.67 MB
 *   sub, measured on 592).
 * `unavailable` — every distinct copy this row knows about is above the
 *   ceiling. The control is drawn DISABLED with the reason, never hidden and
 *   never live-and-failing: D62's distinction, and the same treatment a
 *   provider refusal already gets on this control.
 */
export type ClipExportQuality =
  | { readonly kind: 'direct'; readonly option: ClipQualityOption }
  | {
      readonly kind: 'choice'
      readonly options: readonly ClipQualityOption[]
      readonly defaultProfile: ClipProfile
    }
  | { readonly kind: 'unavailable'; readonly reason: ClipQualityRefusal }

/**
 * The arms that actually OFFER something.
 *
 * Named so `ClipDownload.offered` can say, in the type, that it never carries
 * `unavailable` — the surface checks the ceiling once and must not be asked to
 * check it again three branches later.
 */
export type ClipExportQualityOffer = Exclude<ClipExportQuality, { readonly kind: 'unavailable' }>

function optionFor(profile: ClipProfile, stream: ClipStream | undefined): ClipQualityOption {
  const bytes = stream?.bytes ?? null
  return {
    profile,
    bytes,
    // Strictly greater: the producer's own test is `size > max`, so a copy
    // exactly at the ceiling is accepted and must be offered.
    refusal: bytes !== null && bytes > CLIP_EXPORT_MAX_BYTES ? 'too-large' : null,
  }
}

/**
 * The copies worth offering, in keep order (best first).
 *
 * Empty when the row resolved no twins at all — see {@link resolveClipExportQuality},
 * which turns that into an ask for `high` rather than into nothing: the subject
 * requires exactly one profile, the record reports what was SERVED, and a
 * divergence is rendered rather than hidden (D549 15).
 */
export function clipQualityOptions(clip: Clip): readonly ClipQualityOption[] {
  const streams = clip.streams
  if (streams === undefined) return []
  const { main, sub } = streams
  const out: ClipQualityOption[] = []
  if (main !== undefined) out.push(optionFor(CLIP_PROFILE_HIGH, main))
  // One copy wearing two names is ONE entry. The catalog can pair a row's twins
  // onto the same id, and a second row for the same bytes is the non-choice
  // this module exists to refuse.
  if (sub !== undefined && sub.id !== main?.id) out.push(optionFor(CLIP_PROFILE_LOW, sub))
  return out
}

export function resolveClipExportQuality(clip: Clip): ClipExportQuality {
  const options = clipQualityOptions(clip)
  if (options.length === 0) {
    // The row resolved nothing. Ask for the copy worth keeping and let the
    // record say what it got: naming no profile is not available here (the
    // subject requires one), and guessing the cheap one would hand the
    // operator the worst copy the hub holds without being asked.
    return { kind: 'direct', option: { profile: CLIP_PROFILE_HIGH, bytes: null, refusal: null } }
  }
  const askable = options.filter((o) => o.refusal === null)
  if (askable.length === 0) {
    // Every copy is over the ceiling. `options[0].refusal` is non-null by
    // construction here; the reason is the same for all of them.
    return { kind: 'unavailable', reason: 'too-large' }
  }
  if (options.length === 1) return { kind: 'direct', option: options[0] }
  // Two distinct copies, at least one askable. The refused one STAYS in the
  // list, disabled: dropping it would silently downgrade the keep to the sub
  // file, which is the substitution D549 15 forbids doing quietly.
  return { kind: 'choice', options, defaultProfile: askable[0].profile }
}
