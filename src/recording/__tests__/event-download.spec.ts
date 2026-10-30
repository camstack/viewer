/**
 * The arithmetic of "download this event": the clip's fixed span, the export it
 * queues, and which stills an event can be saved as.
 */
import { describe, expect, it } from 'vitest'

import {
  EVENT_CLIP_PAD_MS,
  eventClipRange,
  eventStillFilename,
  pickEventStills,
  planEventClip,
  targetFromEvent,
  targetFromTrack,
  type EventDownloadTarget,
} from '../event-download.js'
import { MIN_EXPORT_SELECTION_MS } from '../export-selection.js'
import type { MediaGroup } from '../../data/track-media-groups.js'
import type { MediaFileLite, TrackSummary } from '../../data/track-events.js'

const START = Date.parse('2026-09-07T10:00:00Z')
const END = START + 12_000

const TARGET: EventDownloadTarget = {
  deviceId: 7,
  cameraName: 'Driveway',
  trackId: 't1',
  bestEventId: 'e1',
  startMs: START,
  endMs: END,
}

describe('the clip is exactly three seconds either side', () => {
  it('requests event start − 3000 ms to end + 3000 ms', () => {
    const r = eventClipRange(TARGET)
    expect(EVENT_CLIP_PAD_MS).toBe(3_000)
    expect(r.fromMs).toBe(START - 3_000)
    expect(r.toMs).toBe(END + 3_000)
    expect(r.durationMs).toBe(18_000)
  })

  it('the queued export carries those bounds for the event camera', () => {
    const plan = planEventClip(TARGET, END + 3_600_000)
    expect(plan.input).toMatchObject({ deviceId: 7, fromMs: START - 3_000, toMs: END + 3_000 })
  })

  it('a point event ends where it starts — pre + post only', () => {
    const r = eventClipRange({ startMs: START })
    expect(r.fromMs).toBe(START - 3_000)
    expect(r.toMs).toBe(START + 3_000)
  })

  it('an end before the start is treated as a point event', () => {
    expect(eventClipRange({ startMs: START, endMs: START - 9_000 }).toMs).toBe(START + 3_000)
  })

  it('never reaches into the future, and never below the export floor', () => {
    const live = eventClipRange({ startMs: START, endMs: START + 1_000 }, START + 2_000)
    expect(live.toMs).toBe(START + 2_000)
    const floored = eventClipRange({ startMs: START }, START)
    expect(floored.durationMs).toBe(Math.max(MIN_EXPORT_SELECTION_MS, 3_000))
  })
})

describe('the two surfaces describe an event the same way', () => {
  it('a track and an event with the same span produce the same clip', () => {
    const fromEvent = targetFromEvent(
      { id: 'e1', deviceId: 7, trackId: 't1', className: 'person', timestamp: START, endTimestamp: END },
      'Driveway',
    )
    const track = { trackId: 't1', deviceId: 7, bestEventId: 'e1', firstSeen: START, lastSeen: END } as Pick<
      TrackSummary,
      'trackId' | 'deviceId' | 'bestEventId' | 'firstSeen' | 'lastSeen'
    >
    const fromTrack = targetFromTrack(track as TrackSummary, 'Driveway')
    expect(eventClipRange(fromTrack)).toEqual(eventClipRange(fromEvent))
    expect(fromTrack).toEqual(fromEvent)
  })
})

function file(kind: string, mediaId: number): MediaFileLite {
  return { mediaId, kind, base64: '', timestamp: START }
}
function group(logicalKind: MediaGroup['logicalKind'], display: MediaFileLite, full: MediaFileLite): MediaGroup {
  return { id: `${logicalKind}:${full.mediaId}`, logicalKind, display, full, hasFullVariant: display !== full, timestamp: START }
}

describe('pickEventStills', () => {
  it('takes the native variant of the key frame and of the camera snapshot', () => {
    const kfSmall = file('keyFrameSmall', 1)
    const kf = file('keyFrame', 2)
    const snap = file('snapshot', 3)
    const stills = pickEventStills([group('keyFrame', kfSmall, kf), group('snapshot', snap, snap)])
    expect(stills.keyframe).toBe(kf)
    expect(stills.snapshot).toBe(snap)
  })

  it('falls back to the pipeline full frame when the camera gave no snapshot', () => {
    const ff = file('fullFrame', 4)
    expect(pickEventStills([group('frame', ff, ff)]).snapshot).toBe(ff)
  })

  it('an event with neither has neither', () => {
    const crop = file('crop', 5)
    expect(pickEventStills([group('objectCrop', crop, crop)])).toEqual({ snapshot: null, keyframe: null })
  })
})

describe('eventStillFilename', () => {
  it('names the owner and the kind', () => {
    expect(eventStillFilename({ trackId: 'T_1/x', bestEventId: 'e1' }, 'keyframe')).toBe('camstack-t-1-x-keyframe')
    expect(eventStillFilename({ trackId: null, bestEventId: 'E1' }, 'snapshot')).toBe('camstack-e1-snapshot')
  })
})
