/**
 * library-items — the MERGED element model of the Library's gallery.
 *
 * Artifacts (media the hub produced on its own) and recording exports (media the
 * operator asked for) used to be two sections with two lists, two filters and
 * two unrelated ideas of what an element supports. They are one section now, and
 * this module is the single authority on:
 *
 *   • what an element IS ({@link LibraryItem} — a discriminated union, never a
 *     `kind` string branched on at a call site);
 *   • what it SUPPORTS ({@link libraryItemActions});
 *   • whether the filter keeps it ({@link libraryItemMatches});
 *   • which SOURCES a filter selection still needs fetching
 *     ({@link wantsArtifacts} / {@link wantsExports}).
 *
 * Pure (no React, no react-native) so every one of those answers is unit
 * testable in the repo's node environment — the two screens it replaced each
 * answered the first two questions with inline booleans, and they disagreed.
 *
 * DELETE, for both halves: the hub grew `nc.deleteArtifact` on 2026-09-13 (it
 * removes the index row, the bytes, and a video's poster with them), so an
 * artifact now offers the action its export neighbour always had. Whether THIS
 * session may remove THIS row is the hub's call and is never guessed here: a
 * GLOBAL artifact is admin-only and a non-admin gets `deleted: false`, the same
 * single answer the hub gives for an unknown or expired id. The screen reports
 * that refusal as a refusal — not as an error, not as a success.
 */
import { NC_GALLERY_ARTIFACT_KINDS, type NcArtifactKind, type NcArtifactRecord } from '../../data/nc-artifacts.js'
import type { ExportRecord } from '../../data/use-exports.js'

/** The discriminant of the export half of the union, and its filter chip. */
export const LIBRARY_EXPORT_KIND = 'export'

/** Every chip the merged gallery's Type facet offers. */
export type LibraryItemKind = NcArtifactKind | typeof LIBRARY_EXPORT_KIND

/**
 * Chip order: the hub's own output first, the operator's own exports last.
 * Poster kinds are still never chips — a still is the thumbnail of a video row.
 */
export const LIBRARY_KIND_ORDER: readonly LibraryItemKind[] = [
  ...NC_GALLERY_ARTIFACT_KINDS,
  LIBRARY_EXPORT_KIND,
]

/** i18n key for a Type chip / badge. */
export function libraryKindLabelKey(kind: LibraryItemKind): string {
  return kind === LIBRARY_EXPORT_KIND ? 'v2.artifacts.kind.export' : `v2.artifacts.kind.${kind}`
}

/** One element of the merged gallery. */
export type LibraryItem =
  | {
      readonly source: 'artifact'
      /** List key. SOURCE-PREFIXED: the two id spaces are independent and a
       *  collision would silently drop one of the two rows. */
      readonly id: string
      /** What the element is ABOUT — the one ordering both sources share. */
      readonly sortMs: number
      readonly record: NcArtifactRecord
    }
  | {
      readonly source: 'export'
      readonly id: string
      readonly sortMs: number
      readonly record: ExportRecord
    }

/** Wrap one artifact row as a gallery element. */
export function artifactItem(record: NcArtifactRecord): LibraryItem {
  return { source: 'artifact', id: `artifact:${record.id}`, sortMs: record.capturedAt, record }
}

/**
 * Wrap one export row as a gallery element.
 *
 * Ordered on `fromMs` — the START of the footage it covers — and not on
 * `createdAt`: an export of last Tuesday rendered this morning is a picture of
 * last Tuesday, the same reason `capturedLabel` dates an artifact by
 * `capturedAt`. Dating it by the render would file it under today, on a day
 * cursor, where the operator would never find it.
 */
export function exportItem(record: ExportRecord): LibraryItem {
  return { source: 'export', id: `export:${record.id}`, sortMs: record.fromMs, record }
}

/** What an element offers. Every flag is a REAL action, never a disabled hint. */
export interface LibraryItemActions {
  /** The element has moving pictures to play in the viewer. */
  readonly playback: boolean
  /** The bytes can be fetched / shared right now. */
  readonly download: boolean
  /** The hub exposes a delete for this element AND it is in a state that has
   *  something to delete. */
  readonly delete: boolean
  /** Production is still running and can be stopped. */
  readonly cancel: boolean
}

const NOTHING: LibraryItemActions = { playback: false, download: false, delete: false, cancel: false }

/**
 * The ONE answer to "what can I do with this".
 *
 * A still image reports `playback: false` rather than being handed a play button
 * that does nothing — a mosaic genuinely has nothing to play, and saying so is
 * the honest shape. An expired artifact loses BOTH media actions: the countdown
 * is the hub's retention window and past it the bytes are gone, so a download
 * would 404 and a stage would stay black.
 */
export function libraryItemActions(item: LibraryItem, nowMs: number): LibraryItemActions {
  if (item.source === 'artifact') {
    const alive = item.record.expiresAt > nowMs
    return {
      playback: alive && item.record.mediaType !== 'image',
      download: alive,
      // Unlike the two media actions, delete does NOT expire with the bytes:
      // the index row outlives them (retention sweeps a file before its window
      // closes when the shelf fills), and a row nobody can clear is a gallery
      // that only grows. Same reasoning as a failed/expired export below.
      delete: true,
      // Nothing is in flight: an artifact is indexed only once it is complete.
      cancel: false,
    }
  }
  switch (item.record.state) {
    case 'queued':
    case 'rendering':
      return { ...NOTHING, cancel: true }
    case 'ready':
      return { playback: true, download: true, delete: true, cancel: false }
    case 'failed':
    case 'expired':
      // The FILE is gone or was never written, but the history row is still the
      // operator's to clear — `deleteExport` keeps the row and moves it to
      // `deleted`, which is what makes this the tidy-up action rather than a
      // second way to lose media.
      return { ...NOTHING, delete: true }
    case 'deleted':
      return NOTHING
  }
}

/** The narrowing the gallery applies, resolved to absolute values. */
export interface LibraryFilterCriteria {
  /** Selected Type chips. EMPTY means every kind. */
  readonly kinds: readonly LibraryItemKind[]
  /** Selected cameras. EMPTY means every camera. */
  readonly deviceIds: readonly number[]
  /** Inclusive day-window bounds (`artifactDayBounds`). */
  readonly fromMs: number
  readonly toMs: number
}

/** Every camera an element covers. A mosaic covers many; `deviceId` names one. */
function itemDeviceIds(item: LibraryItem): readonly number[] {
  if (item.source === 'export') return [item.record.deviceId]
  if (item.record.deviceIds.length > 0) return item.record.deviceIds
  return item.record.deviceId !== null ? [item.record.deviceId] : []
}

/** The element's own Type chip. */
function itemKind(item: LibraryItem): LibraryItemKind {
  return item.source === 'export' ? LIBRARY_EXPORT_KIND : item.record.kind
}

/**
 * Does the filter keep this element?
 *
 * Applied CLIENT-SIDE and only where it has to be: the artifact list is narrowed
 * by the hub (`nc.listArtifacts` takes kinds, devices and a window), but
 * `recordingExport.listExports` takes at most a `deviceId` and answers with the
 * whole history — so an export is filtered here or not at all. Running BOTH
 * sources through the same predicate is what makes the two halves of one list
 * obey one filter; a screen that filtered only what the hub could filter would
 * show a day's artifacts beside every export ever made.
 */
export function libraryItemMatches(item: LibraryItem, criteria: LibraryFilterCriteria): boolean {
  if (item.sortMs < criteria.fromMs || item.sortMs > criteria.toMs) return false
  if (criteria.kinds.length > 0 && !criteria.kinds.includes(itemKind(item))) return false
  if (criteria.deviceIds.length > 0) {
    const ids = itemDeviceIds(item)
    if (!ids.some((id) => criteria.deviceIds.includes(id))) return false
  }
  return true
}

/**
 * Is the artifact query still worth running for this kind selection?
 *
 * It is not, when every selected chip is `export`. This must be a fetch-time
 * gate rather than a post-filter: `buildListArtifactsInput` OMITS an empty kind
 * list, and "no kinds" on the wire means "every kind", so an artifact-free
 * selection would otherwise ask the hub for the entire gallery and then throw it
 * away — a full page of traffic for a list the operator narrowed to nothing.
 */
export function wantsArtifacts(kinds: readonly LibraryItemKind[]): boolean {
  return kinds.length === 0 || kinds.some((k) => k !== LIBRARY_EXPORT_KIND)
}

/** Are exports part of this kind selection? */
export function wantsExports(kinds: readonly LibraryItemKind[]): boolean {
  return kinds.length === 0 || kinds.includes(LIBRARY_EXPORT_KIND)
}

/** The artifact kinds of a selection — what may be sent to the hub. */
export function artifactKindsOf(kinds: readonly LibraryItemKind[]): readonly NcArtifactKind[] {
  return kinds.filter((k): k is NcArtifactKind => k !== LIBRARY_EXPORT_KIND)
}

/** Both sources as ONE list, newest first. */
export function mergeLibraryItems(
  artifacts: readonly NcArtifactRecord[],
  exports: readonly ExportRecord[],
): readonly LibraryItem[] {
  return [...artifacts.map(artifactItem), ...exports.map(exportItem)].sort((a, b) => b.sortMs - a.sortMs)
}
