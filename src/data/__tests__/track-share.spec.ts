import { describe, it, expect } from 'vitest'
import { trackShareTarget, shareImageFilename } from '../track-share.js'
import type { TrackSummary } from '../track-events.js'

function track(over: Partial<TrackSummary> = {}): TrackSummary {
  return {
    trackId: 'trk-42',
    deviceId: 102,
    cameraName: 'Front Door',
    className: 'person',
    firstSeen: 1_700_000_000_000,
    lastSeen: 1_700_000_050_000,
    state: 'left',
    active: false,
    zonesVisited: [],
    zoneNames: [],
    audioLabels: [],
    bestEventId: 'evt-9',
    ...over,
  }
}

describe('trackShareTarget', () => {
  it('encodes the events route + track/device/ts params', () => {
    expect(trackShareTarget(track())).toEqual({
      path: '/events',
      queryParams: { trackId: 'trk-42', deviceId: '102', ts: '1700000000000' },
    })
  })
})

describe('shareImageFilename', () => {
  it('produces a filesystem-safe basename', () => {
    expect(shareImageFilename(track({ trackId: 'a/b:c' }), 'keyFrame')).toBe('camstack-a-b-c-keyframe')
  })
})
