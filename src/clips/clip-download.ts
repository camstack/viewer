/**
 * clip-download — what the control on a clip TILE offers.
 *
 * ## Where it sits, and why that is the whole specification
 *
 * > *"Il pulsante download può essere messo sulla thumbnail dove di solito
 * > mostriamo la lente del cluster group."* — the operator, 2026-09-20.
 *
 * The magnifier's corner on `ClusterCard` (`styles.actionsRow` / `actionBtn`),
 * which clips mode leaves empty because `onClusterOpenDetail` is undefined
 * there. Reusing the position, the size and the hit area is the ask: the
 * affordance is already familiar, and a second corner treatment for a second
 * kind of card is how one of them falls behind.
 *
 * ## It creates an EXPORT. It is no longer a download (2026-09-23)
 *
 * > *"possiamo anche riutilizzare il meccanismo di export"* — the operator,
 * > which is what he asked for when D558 was written: *"forse conviene andare
 * > sempre tramite backend e trovare poi la clip in exports"*.
 *
 * **This docblock used to say the opposite, and it was wrong.** It asserted
 * that D558's server slice "is not built", that there was no export record,
 * nothing collectable later and no library entry — and that is why a direct
 * fetch of the provider's Range route was still here. D558 **landed on the
 * server on 2026-09-21**: `createExport` takes a discriminated `ExportSubject`
 * with a `clip` arm, and `videoclips.readClipBytes` is implemented for
 * Hikvision *and* Reolink. A comment describing a design that exists as though
 * it does not is the leftover this repo treats as worse than nothing: it reads
 * as verification, and it kept the interim alive for two days.
 *
 * So the press creates an `ExportRecord` with a clip subject
 * (`clip-export-subject.ts`). What that buys, and what the old path could not:
 *
 *  - a record that survives, with a lifetime and a janitor;
 *  - something collectable later, and from another phone;
 *  - an entry in the Library beside every other artifact;
 *  - progress that is the same on web and native, and that keeps running when
 *    the surface that started it is dismissed.
 *
 * The recorder stays the sole owner of the file and the download plane; the
 * addon that owns the camera stays the sole producer of the bytes, pulled once
 * by handle under a bound. Nothing about that is this module's business — it
 * only decides what the corner control IS.
 *
 * ## Why the label is not the word "download"
 *
 * It never was one, and now it is not even a local fetch: the bytes land on the
 * hub. `CLIP_DOWNLOAD_LABEL_KEY` stays `saveClip` — "keep this" — because that
 * is the verb that is true on every platform and at every stage.
 *
 * ## Why the polarity is the opposite of the frame's
 *
 * The frame plays the CHEAPEST copy the row resolved (D559, `clip-quality.ts`):
 * it is a scroll of cards on a phone. A keep is the opposite, and the default
 * here is `high` for the same reason `EXPORT_SELECTION_PROFILE` is. Anyone
 * copying one rule into the other will get it backwards unless both say why, so
 * both do. What is NEW is that the operator is asked when there are two
 * distinct copies to ask about (`clip-export-quality.ts`).
 *
 * Pure: no React, no i18n, no network.
 */

import { isPlayable, type Clip } from './clip-model.js'
import { playsFromRecording } from './clip-mapping.js'
import { resolveClipExportQuality, type ClipExportQualityOffer } from './clip-export-quality.js'

/**
 * The control's words.
 *
 * A constant rather than a string spelled at the call site, so the spec that
 * pins it to what the control actually does has something to assert against.
 */
export const CLIP_DOWNLOAD_LABEL_KEY = 'v2.clips.saveClip'

/** What the tile's corner control should be. */
export type ClipDownload =
  /**
   * Keep this clip. `quality` says whether the press asks first: `direct` is
   * one distinct copy and queues straight away, `choice` is two and opens the
   * picker. The decision is read entirely off the catalog row.
   */
  | {
      readonly kind: 'offered'
      readonly deviceId: number
      readonly clipId: string
      readonly quality: ClipExportQualityOffer
    }
  /**
   * SHOWN, disabled, carrying the provider's own words.
   *
   * Not hidden. A hidden control makes "this clip cannot be served" and "this
   * build has no keep" the same blank corner, and the operator then files the
   * first as the second. A control that looks available and fails when pressed
   * is the other half of the same defect; this is neither.
   */
  | { readonly kind: 'refused'; readonly reason: string | null }
  /**
   * Every copy of this clip is above the export path's read bound, so the job
   * would be refused (`too-large-to-transfer`) rather than truncated. Drawn
   * disabled, with OUR words — there is no provider prose for a limit that is
   * ours. Measured on 592's live catalog: 86 of 357 rows have a main twin over
   * the bound (largest 166.93 MB) and not one has a sub over it, so this arm
   * is rare and the `choice` arm carrying a disabled `high` is not.
   */
  | { readonly kind: 'tooLarge' }
  /** No control at all — this clip is not a file (see {@link resolveClipDownload}). */
  | { readonly kind: 'none' }

/** The cache/export file name. Carries the camera and the clip's own instant,
 *  so two clips never collide and a file says which camera it came from. */
export function clipDownloadFileName(clip: Clip): string {
  return `clip-${clip.deviceId}-${clip.startMs}.mp4`
}

/**
 * The decision, read entirely off the row — no call, no second lookup.
 *
 * A clip of OUR OWN recording gets `none`: it is a range of the hub's footage,
 * not a file, and it is collected through the timeline's own export control,
 * which has its own selection and its own quality rule. Two ways to get one
 * thing is how the two diverge (D62, reached from the tile).
 */
export function resolveClipDownload(clip: Clip): ClipDownload {
  if (playsFromRecording(clip.sourceId)) return { kind: 'none' }
  if (!isPlayable(clip)) return { kind: 'refused', reason: clip.unplayableReason ?? null }
  const quality = resolveClipExportQuality(clip)
  if (quality.kind === 'unavailable') return { kind: 'tooLarge' }
  return { kind: 'offered', deviceId: clip.deviceId, clipId: clip.clipId, quality }
}
