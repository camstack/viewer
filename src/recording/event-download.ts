/**
 * event-download — the arithmetic behind "download this event" on a timeline card.
 *
 * Two acts, one dialog:
 *
 *  - CLIP: the event's own span widened by a lead-in and a tail. `ObjectEvent`
 *    says when it started (`timestamp`) and, for a track-shaped event, when it
 *    ended (`endTimestamp`); a point event has no end and ends where it starts.
 *    The clip is exported through the SAME path as a timeline selection
 *    (`planSelectionCommit` + `createExport`), so this module only produces the
 *    `ExportSelectionRange` and the coverage verdict — nothing here calls the hub.
 *  - SNAPSHOT: one stored still, at the native full resolution when the event's
 *    media has one, else the display variant.
 *
 * Pure — no React, no hub.
 */
import type { ObjectEvent } from '../components/camera/theater/event-cluster.js'
import type { MediaGroup } from '../data/track-media-groups.js'
import type { MediaFileLite } from '../data/track-events.js'
import type { TimeRange } from '../timeline/coverage.js'
import {
  MIN_EXPORT_SELECTION_MS,
  selectionCoverage,
  type ExportSelectionRange,
  type SelectionCoverage,
} from './export-selection.js'

/** Footage kept before the event starts and after it ends, unless changed. */
export const EVENT_CLIP_DEFAULT_PAD_MS = 5_000

/** What the dialog offers for the lead-in and the tail. */
export const EVENT_CLIP_PAD_CHOICES_MS: readonly number[] = [0, 5_000, 10_000, 30_000]

export type EventSpan = Pick<ObjectEvent, 'timestamp' | 'endTimestamp'>

/**
 * The range a clip of `event` covers: `start − pre` to `end + post`.
 *
 * A point event (no `endTimestamp`, or one before the start) ends at its start.
 * The result is never shorter than the export floor — a point event with no
 * padding would otherwise queue a zero-length job — and, given `nowMs`, never
 * reaches into the future, where nothing can have been recorded.
 */
export function eventClipRange(
  event: EventSpan,
  preMs: number = EVENT_CLIP_DEFAULT_PAD_MS,
  postMs: number = EVENT_CLIP_DEFAULT_PAD_MS,
  nowMs?: number,
): ExportSelectionRange {
  const start = event.timestamp
  const end = Math.max(start, event.endTimestamp ?? start)
  const fromMs = start - Math.max(0, preMs)
  let toMs = end + Math.max(0, postMs)
  if (nowMs !== undefined) toMs = Math.min(toMs, Math.max(nowMs, fromMs))
  if (toMs - fromMs < MIN_EXPORT_SELECTION_MS) toMs = fromMs + MIN_EXPORT_SELECTION_MS
  return { fromMs, toMs, durationMs: toMs - fromMs }
}

/** What Save does for a coverage verdict. */
export type EventClipGate = 'allow' | 'confirm-gap' | 'blocked'

/**
 * Coverage of the clip, off the day-window availability the timeline already
 * holds (`selectionCoverage` — an empty or out-of-window read is `unknown`).
 */
export function eventClipCoverage(
  coverage: readonly TimeRange[],
  windowFromMs: number,
  windowToMs: number,
  range: ExportSelectionRange,
): SelectionCoverage {
  return selectionCoverage(coverage, windowFromMs, windowToMs, range)
}

/**
 * `absent` blocks (nothing was recorded, there is nothing to render), `partial`
 * asks first, `covered` and `unknown` go — an unanswered coverage read is no
 * evidence of an empty one.
 */
export function eventClipGate(coverage: SelectionCoverage): EventClipGate {
  if (coverage === 'absent') return 'blocked'
  if (coverage === 'partial') return 'confirm-gap'
  return 'allow'
}

export type SnapshotResolution = 'high' | 'low'

/** The two stills an event can be saved as; null where it has none. */
export interface SnapshotOptions {
  readonly high: MediaFileLite | null
  readonly low: MediaFileLite | null
}

/**
 * High is the native full variant, offered only when the media group really has
 * a separate higher-resolution file; low is the display variant.
 */
export function snapshotOptions(group: MediaGroup | null): SnapshotOptions {
  if (group === null) return { high: null, low: null }
  return { high: group.hasFullVariant ? group.full : null, low: group.display }
}

/** The file name (no extension) a saved snapshot of the event gets. */
export function eventSnapshotFilename(
  event: Pick<ObjectEvent, 'id' | 'trackId'>,
  resolution: SnapshotResolution,
): string {
  const owner = (event.trackId ?? event.id).replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  return `camstack-${owner}-${resolution}`
}
