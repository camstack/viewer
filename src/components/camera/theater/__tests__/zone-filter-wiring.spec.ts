import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The drawn zone survives the trip from the player surface to the cluster list.
 *
 * On 2026-08-01 the operator reported that the timeline's drawn-zone filter had
 * stopped working. Every unit test of the geometry passed, `tsc` was clean and
 * the bundle exported — because the defect was not in any one module. It was in
 * the SPACES two of them worked in: the rect was normalised against the video
 * box while the tracks were normalised against a frame size GUESSED from the
 * loaded rows, and on a camera whose subjects never reach the bottom of its
 * picture that guess was 630×175 against a real 640×360. The filter did exactly
 * what it was told, in the wrong coordinate system.
 *
 * The repair makes the frame exact by carrying the server's normalised
 * `envelope` next to the pixel boxes. That is a five-file path, and every one of
 * the five is a place a later refactor can quietly drop a field:
 *
 *   listTracks row → parsePositionBoxes + parseNormalizedEnvelope
 *     → trackToTimelineEvent → ObjectEvent → filterEventsByZone → clusters
 *
 * This is a SOURCE guard, for the same reason `timeline-scrub-wiring.spec.ts` is
 * one: the viewer's vitest config collects only `src/**\/__tests__/**\/*.spec.ts`
 * with environment `node` and no react renderer, so a component cannot be
 * mounted here and a `.spec.tsx` is silently never collected. A pure-function
 * test cannot see a caller that stopped calling it.
 */

const SRC = join(process.cwd(), 'src')
const read = (...parts: readonly string[]): string =>
  readFileSync(join(SRC, ...parts), 'utf8')

describe('the drawn zone reaches the timeline it filters', () => {
  it('the track feed parses BOTH halves of the geometry off the same row', () => {
    const src = read('data', 'use-device-tracks.ts')
    // Boxes alone are what the filter had before, and they are not enough: the
    // envelope is the only thing that pins the detection frame.
    expect(src).toContain('parsePositionBoxes(row)')
    expect(src).toContain('parseNormalizedEnvelope(row)')
    expect(src).toContain('positionBoxes: parsePositionBoxes(row)')
    expect(src).toContain('normalizedEnvelope,')
  })

  it('the timeline item type still carries both fields to the filter', () => {
    const src = read('components', 'camera', 'theater', 'event-cluster.ts')
    expect(src).toContain('positionBoxes?: readonly PixelRect[]')
    expect(src).toContain('normalizedEnvelope?: ZoneRect')
  })

  it('the zone filter resolves the frame EXACTLY, never from the estimate alone', () => {
    const src = read('components', 'camera', 'theater', 'zone-filter.ts')
    // `filterEventsByZone` reaching for `estimateFrameSize` directly is the
    // regression: it is the fallback for legacy rows, not the frame source.
    expect(src).toContain('const frame = resolveFrameSize(events)')
    expect(src).toContain('frameSizeFromEnvelope(item.positionBoxes, item.normalizedEnvelope)')
  })

  it('TheaterTimeline applies the zone BEFORE clustering and feeds the result onward', () => {
    const src = read('components', 'camera', 'theater', 'TheaterTimeline.tsx')
    expect(src).toContain('filterEventsByZone(objectEvents, zoneRect)')
    // A zone filter whose output is computed and then not consumed is the
    // easiest thing in this file to leave behind during a refactor.
    expect(src).toContain('filterDetectionsByKind(zoneFilteredEvents,')
    expect(src).toContain('clusterByZoom(filteredEvents,')
  })

  it('the zone never drops items silently — the diagnostic reports what it hid', () => {
    const src = read('components', 'camera', 'theater', 'TheaterTimeline.tsx')
    // "the timeline is empty" and "the zone hid everything" look identical on
    // screen; the resolved frame is what tells them apart afterwards.
    expect(src).toContain('kept: zoneFilteredEvents.length')
    expect(src).toContain('dropped: objectEvents.length - zoneFilteredEvents.length')
    expect(src).toContain('frame: resolveFrameSize(objectEvents)')
    // Device-scoped, so a report of "102 is worse than 101" can be answered.
    expect(src).toContain('deviceId: props.deviceId')
  })

  it('CameraDetailScreen owns the zone and binds it to the timeline in both layouts', () => {
    const src = read('screens', 'CameraDetailScreen.tsx')
    // The rect is drawn on the player and consumed by the timeline, so the
    // screen is the only place that can hold it. `renderTimeline` is shared by
    // the stacked, wide and landscape layouts — one binding covers all three.
    expect(src).toContain('zoneRect: timelineZone,')
    expect(src).toContain('onConfirm={onZoneConfirm}')
    expect(src).toContain('<ZoneDrawOverlay')
  })
})
