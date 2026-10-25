import { mergeRanges, type TimeRange } from '../timeline/coverage.js'

/** A per-profile availability span as returned by recording.getAvailability. */
export interface AvailabilitySpan {
  readonly profile: string
  readonly startMs: number
  readonly endMs: number
}

/** Flatten per-profile spans into a single merged, sorted, non-overlapping
 *  coverage set for the timeline ("has footage" bands). Profile is irrelevant
 *  for coverage — any profile present means footage exists. */
export function availabilityToCoverage(spans: readonly AvailabilitySpan[]): TimeRange[] {
  return mergeRanges(spans.map((s) => ({ startMs: s.startMs, endMs: s.endMs })))
}

/** Verdict of {@link recordingKnownAt}: only an explicit `'absent'` may hide
 *  the "go to this moment" affordance — ambiguity keeps it visible. */
export type RecordingKnowledge = 'recorded' | 'absent' | 'unknown'

/**
 * ZERO-COST recording-availability check for a moment, using coverage the
 * surface ALREADY fetched (the timeline's day-window `getAvailability`) —
 * never a per-item call.
 *
 *   • epoch inside a coverage range                    → 'recorded'
 *   • epoch inside the queried window, outside ranges  → 'absent'
 *   • epoch outside the queried window, or coverage [] → 'unknown'
 *     (an empty array is ambiguous: still loading / fetch failed / truly
 *     none — never hide an affordance on ambiguity).
 */
export function recordingKnownAt(
  coverage: readonly TimeRange[],
  windowFromMs: number,
  windowToMs: number,
  epochMs: number,
): RecordingKnowledge {
  if (coverage.length === 0) return 'unknown'
  if (epochMs < windowFromMs || epochMs > windowToMs) return 'unknown'
  return coverage.some((r) => epochMs >= r.startMs && epochMs <= r.endMs) ? 'recorded' : 'absent'
}
