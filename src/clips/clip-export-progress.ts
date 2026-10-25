/**
 * clip-export-progress — what the modal says while the hub renders the clip.
 *
 * ## The progress problem solved itself by going through the backend
 *
 * The interim download had it the hard way: HTTP byte-progress, available on
 * native (`createDownloadResumable`) and not on web (`window.open`), so the
 * same modal would have drawn a bar on one platform and nothing on the other —
 * and an invented bar is the same lie as an invented duration.
 *
 * An export is a RECORD with a state. The hub reports `progressPct`, the same
 * way for web and native, and it survives the modal being dismissed: the
 * operator can close it and the job keeps going, which is the thing an
 * in-flight `fetch` could never offer.
 *
 * ## …and it is already honest
 *
 * D558 pinned it: *"`progressPct` stays honest — a real fraction only where one
 * exists (the mux, and the fetch when the catalog row carries `bytes`), `null`
 * otherwise. No ramp."* So `null` is not a small number, and this module funnels
 * it into the app's ONE progress vocabulary (`lib/progress.ts`) where `unknown`
 * is an arm rather than a zero.
 *
 * ## A failure is a TOKEN plus the producer's words
 *
 * `ExportRecord.error` on this path is `<token>: <prose>` (D572,
 * `clipExportFailure`). The token is what a surface may key a translated
 * sentence on; the prose is the camera's own words and travels verbatim,
 * never paraphrased (D563). Both are carried, and a string that did not come
 * from that vocabulary yields a null token and keeps its whole text — every
 * footage failure and everything thrown by code that never heard of the enum.
 *
 * The parse is spelled here rather than imported: `clipExportFailureOf` is not
 * in the installed `@camstack/types` (1.2.235 predates D558's landing), and
 * this checkout resolves `@camstack/*` from the published packages.
 *
 * Pure: no React, no i18n, no network.
 */

import { UNKNOWN_PROGRESS, progressFrom, type Progress } from '../lib/progress.js'
import type { ExportRecord } from '../data/use-exports.js'

/**
 * Every way a clip export can fail, as the hub names it
 * (`ClipExportFailureSchema`). Mirrored, in the cap's own order.
 */
export const CLIP_EXPORT_FAILURES: readonly string[] = [
  'catalog-miss',
  'catalog-unreachable',
  'no-file-for-window',
  'clip-in-progress',
  'unsupported-option',
  'sleeping',
  'camera-refused',
  'fetch-failed',
  'too-large-to-transfer',
  'wake-expired',
]

export interface ClipExportFailureText {
  /** The token, or `null` when the error did not come from that vocabulary. */
  readonly code: string | null
  /** The producer's own words. Empty when the error was only a token. */
  readonly detail: string
}

/**
 * Split `<token>: <prose>`.
 *
 * A string with no known token keeps its WHOLE text as the detail — including
 * the part before the first colon. Reading `"ECONNRESET: socket hang up"` as
 * the token `ECONNRESET` and the detail `socket hang up` would drop half of a
 * message nobody can translate anyway.
 */
export function clipExportFailureText(error: string | null): ClipExportFailureText | null {
  if (error === null || error.length === 0) return null
  const cut = error.indexOf(':')
  const head = (cut === -1 ? error : error.slice(0, cut)).trim()
  if (!CLIP_EXPORT_FAILURES.includes(head)) return { code: null, detail: error }
  return { code: head, detail: cut === -1 ? '' : error.slice(cut + 1).trim() }
}

/**
 * Where the export is, for the one surface that watches one.
 *
 * `asked` is the gap between the tap and the first record — the mutation is in
 * flight and there is nothing with a state yet. It is its own arm and not a
 * `working` with unknown progress, because the two are different truths: one
 * says the hub has not answered, the other says it has and cannot measure.
 */
export type ClipExportPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'asked' }
  | { readonly kind: 'working'; readonly progress: Progress }
  | { readonly kind: 'ready'; readonly exportId: string; readonly fileBytes: number | null }
  | { readonly kind: 'failed'; readonly failure: ClipExportFailureText | null }

export const IDLE_CLIP_EXPORT: ClipExportPhase = { kind: 'idle' }
export const ASKED_CLIP_EXPORT: ClipExportPhase = { kind: 'asked' }

/**
 * The record's state, as a phase.
 *
 * `expired` and `deleted` are reported as `ready` — the RENDER succeeded, and
 * this modal's job ends when the job does. A file the janitor has since
 * removed is the Library's story to tell, not a failure of the tap.
 */
export function resolveClipExportPhase(record: ExportRecord | null): ClipExportPhase {
  if (record === null) return ASKED_CLIP_EXPORT
  switch (record.state) {
    case 'queued':
    case 'rendering':
      return {
        kind: 'working',
        // `progressPct` is 0..100 on the wire; `null` stays unknown, and a
        // `queued` job that has not started is ALSO unknown rather than 0 —
        // a bar at zero and a bar that cannot say are different claims.
        progress:
          record.progressPct === null ? UNKNOWN_PROGRESS : progressFrom(record.progressPct / 100),
      }
    case 'failed':
      return { kind: 'failed', failure: clipExportFailureText(record.error) }
    default:
      return { kind: 'ready', exportId: record.id, fileBytes: record.fileBytes }
  }
}
