/**
 * A complete {@link TrackSummary} for tests that need one without
 * round-tripping through `toTrackSummary` — `over` replaces any field.
 * D683's fused-id test (`track-alias-read.spec.ts`) is the first consumer: it
 * needs two cached rows that differ only by `trackId`.
 */
import type { TrackSummary } from '../track-events.js'

export function trackSummaryFixture(over: Partial<TrackSummary> = {}): TrackSummary {
  return {
    trackId: 't1',
    deviceId: 101,
    cameraName: 'Front door',
    className: 'person',
    firstSeen: 1000,
    lastSeen: 2000,
    state: 'closed',
    active: false,
    zonesVisited: [],
    zoneNames: [],
    audioLabels: [],
    bestEventId: 't1',
    ...over,
  }
}
