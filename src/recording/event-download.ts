/**
 * event-download — the arithmetic behind "download this event".
 *
 * One menu, three acts (see `EventActionMenu`):
 *
 *  - CLIP: the event's own span widened by a FIXED lead-in and tail
 *    ({@link EVENT_CLIP_PAD_MS}). `ObjectEvent` says when it started
 *    (`timestamp`) and, for a track-shaped event, when it ended
 *    (`endTimestamp`); a point event ends where it starts. The clip is exported
 *    through the SAME path as a timeline selection (`planSelectionCommit` +
 *    `useRunExport`), so this module only produces the commit — nothing here
 *    calls the hub.
 *  - SNAPSHOT: the camera's native full frame, when the event's media has one.
 *  - KEYFRAME: the pipeline's clean key frame at native resolution.
 *
 * A cluster pill and the track detail both describe what they hold as an
 * {@link EventDownloadTarget}, so the two cannot disagree on what a download
 * covers.
 *
 * Pure — no React, no hub.
 */
import type { ObjectEvent } from '../components/camera/theater/event-cluster.js'
import type { MediaGroup } from '../data/track-media-groups.js'
import type { MediaFileLite, TrackSummary } from '../data/track-events.js'
import { MIN_EXPORT_SELECTION_MS, type ExportSelectionRange } from './export-selection.js'
import { planSelectionCommit } from './selection-commit.js'
import type { ExportCommit } from './use-run-export.js'

/** Footage kept before the event starts and after it ends. Not a choice. */
export const EVENT_CLIP_PAD_MS = 3_000

/** What a download is about, whichever surface asked. */
export interface EventDownloadTarget {
  readonly deviceId: number
  readonly cameraName: string
  /** The media owner; null for an event with no track (no stills to read). */
  readonly trackId: string | null
  /** The event whose media listing is read (`listTrackMedia`'s event half). */
  readonly bestEventId: string | null
  readonly startMs: number
  /** Absent for a point event. */
  readonly endMs?: number
}

export function targetFromEvent(event: ObjectEvent, cameraName: string): EventDownloadTarget {
  return {
    deviceId: event.deviceId,
    cameraName,
    trackId: event.trackId ?? null,
    bestEventId: event.id,
    startMs: event.timestamp,
    ...(event.endTimestamp !== undefined ? { endMs: event.endTimestamp } : {}),
  }
}

export function targetFromTrack(track: TrackSummary, cameraName: string): EventDownloadTarget {
  return {
    deviceId: track.deviceId,
    cameraName,
    trackId: track.trackId,
    bestEventId: track.bestEventId,
    startMs: track.firstSeen,
    endMs: track.lastSeen,
  }
}

/**
 * The range a clip of `target` covers: `start − 3 s` to `end + 3 s`.
 *
 * A point event (no end, or one before the start) ends at its start. The
 * result is never shorter than the export floor and, given `nowMs`, never
 * reaches into the future, where nothing can have been recorded.
 */
export function eventClipRange(
  target: Pick<EventDownloadTarget, 'startMs' | 'endMs'>,
  nowMs?: number,
): ExportSelectionRange {
  const end = Math.max(target.startMs, target.endMs ?? target.startMs)
  const fromMs = target.startMs - EVENT_CLIP_PAD_MS
  let toMs = end + EVENT_CLIP_PAD_MS
  if (nowMs !== undefined) toMs = Math.min(toMs, Math.max(nowMs, fromMs))
  if (toMs - fromMs < MIN_EXPORT_SELECTION_MS) toMs = fromMs + MIN_EXPORT_SELECTION_MS
  return { fromMs, toMs, durationMs: toMs - fromMs }
}

/** The export a "Download clip" queues. */
export function planEventClip(target: EventDownloadTarget, nowMs: number): ExportCommit {
  const plan = planSelectionCommit('export', true, target.deviceId, eventClipRange(target, nowMs))
  if (plan.action !== 'export') throw new Error('an export plan was expected')
  return plan
}

export type EventStillKind = 'snapshot' | 'keyframe'

/** The two stills a download can save; null where the event has none. */
export interface EventStills {
  readonly snapshot: MediaFileLite | null
  readonly keyframe: MediaFileLite | null
}

/**
 * Snapshot is the camera's own full frame (a `snapshot`, else the pipeline's
 * `fullFrame`); keyframe is the clean key frame. Both at the native variant.
 */
export function pickEventStills(groups: readonly MediaGroup[]): EventStills {
  const fileOf = (kind: MediaGroup['logicalKind']): MediaFileLite | null =>
    groups.find((g) => g.logicalKind === kind)?.full ?? null
  return {
    snapshot: fileOf('snapshot') ?? fileOf('frame'),
    keyframe: fileOf('keyFrame'),
  }
}

/** The file name (no extension) a saved still of the target gets. */
export function eventStillFilename(
  target: Pick<EventDownloadTarget, 'trackId' | 'bestEventId'>,
  kind: EventStillKind,
): string {
  const owner = (target.trackId ?? target.bestEventId ?? 'event').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  return `camstack-${owner}-${kind}`
}
