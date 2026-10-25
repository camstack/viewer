/**
 * clip-export-subject — the exact `createExport` input a clip tile produces.
 *
 * > *"possiamo anche riutilizzare il meccanismo di export"* — the operator,
 * > 2026-09-23, which is the same thing he asked for when D558 was written:
 * > *"forse conviene andare sempre tramite backend e trovare poi la clip in
 * > exports"*.
 *
 * This is D558's **entry path 1**: from a clip that has already been chosen —
 * no selection step, no extra query. (Entry path 2, the segment strip inside
 * `NewExportModal`, is not built here and is named in the report rather than
 * half-started.)
 *
 * ## Why this is a module and not four lines at the call site
 *
 * Every rule below is a REFUSAL on the hub's side, i.e. a job that fails after
 * the operator thought it was queued:
 *
 *  - **`deviceId` stays at the top level as well as in the subject.**
 *    `METHOD_DEVICE_SELECTORS` maps top-level fields only, so per-device scope
 *    enforcement reads the top-level one and cannot see `subject.deviceId`. A
 *    subject naming a different camera is refused outright.
 *  - **No `fromMs`/`toMs`, ever.** The camera chose the boundaries; they reach
 *    the record only as the projection. Supplying a range alongside a clip
 *    subject is refused rather than ignored (D558 § 5.4.3), so a caller that
 *    "helpfully" passes the row's own span breaks the export.
 *  - **No `speed`, no `timelapse`.** Nothing on this path is re-timed, and both
 *    are `unsupported-option` refusals at creation (D572).
 *  - **Exactly ONE profile on the subject**, because one tap is never two
 *    fetches (D558 § 5.2) — and because a clip export WAKES a sleeping camera,
 *    where one authorised yes is one wake.
 *
 * ## `includeAudio` is required and means nothing here
 *
 * The schema requires the boolean; D572 settles that a clip export *"claims
 * nothing about audio"* — it is neither honoured nor contradicted, the
 * delivered sound is whatever the producer's mux could copy, and the surface
 * does not render the variant row for a clip. `false` is sent as the value that
 * asserts the least, and nothing in this app reads it back for a clip.
 *
 * ## Why the shapes are mirrored here and not imported
 *
 * `ExportClipSubjectSchema` is not in the installed `@camstack/types` (1.2.235
 * predates D558's landing), and this checkout resolves `@camstack/*` from the
 * PUBLISHED packages exactly as metro and CI do. Mirroring the shape is the
 * convention `use-exports.ts` already states for this cap; re-pointing the
 * alias to the workspace would type-check green and throw on first evaluation.
 * `RECORDING_EXPORT_MAX_READ_BYTES` IS published, so `clip-export-quality.ts`
 * imports that one rather than re-spelling it.
 *
 * Pure: no React, no i18n, no network.
 */

import type { CreateExportInput } from '../data/use-exports.js'
import type { Clip } from './clip-model.js'
import type { ClipProfile } from './clip-quality.js'

/**
 * How long the hub keeps a clip export.
 *
 * The SAME seven days a timeline selection gets (`EXPORT_SELECTION_LIFE_MS`).
 * Retention is INHERITED: D558 says a clip export gets no bespoke `expiresAt`
 * or `deleteAfterDownload` policy, and a second lifetime constant is how the
 * two drift.
 */
export const CLIP_EXPORT_LIFE_MS = 7 * 24 * 60 * 60 * 1_000

/** The catalog day the surface was listing when the clip was picked. */
export interface ClipCatalogWindow {
  readonly sinceMs: number
  readonly untilMs: number
}

/**
 * `ExportSubject` with `kind: 'clip'`, mirrored.
 *
 * `provider` is the serving addon's id — the `provider` pin `listClips`
 * requires; a bare call fans out over every source. `source` is the source id
 * the `clipId` is namespaced with, and `sourceLabel` is FROZEN at creation so a
 * history row still reads "SD card" after the source is unbound.
 */
export interface ClipExportSubject {
  readonly kind: 'clip'
  readonly deviceId: number
  readonly provider: string
  readonly source: string
  readonly sourceLabel: string
  readonly clipId: string
  readonly catalogWindow: ClipCatalogWindow
  readonly profile: ClipProfile
}

export interface ClipExportRequest {
  readonly clip: Clip
  /** The addon that LISTED this row (`clips.choice.addonId`). */
  readonly provider: string
  /** The hub's own label for the source. Rendered and stored verbatim. */
  readonly sourceLabel: string
  /** The window the surface was already listing — not a range control. */
  readonly catalogWindow: ClipCatalogWindow
  readonly profile: ClipProfile
}

export function buildClipExportSubject(request: ClipExportRequest): ClipExportSubject {
  return {
    kind: 'clip',
    deviceId: request.clip.deviceId,
    provider: request.provider,
    source: request.clip.sourceId,
    sourceLabel: request.sourceLabel,
    clipId: request.clip.clipId,
    catalogWindow: request.catalogWindow,
    profile: request.profile,
  }
}

/**
 * The whole `createExport` input.
 *
 * `profiles` is deliberately ABSENT: the subject carries the one profile, and
 * the top-level array is the footage path's. `fromMs`/`toMs` are absent for the
 * reason above — their presence is a refusal, not a redundancy.
 */
export function buildClipExportInput(request: ClipExportRequest): CreateExportInput {
  return {
    deviceId: request.clip.deviceId,
    subject: buildClipExportSubject(request),
    options: {
      includeAudio: false,
      maxLifeMs: CLIP_EXPORT_LIFE_MS,
      deleteAfterDownload: false,
    },
  }
}
