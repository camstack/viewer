import { describe, it, expect } from 'vitest'
import { deviceStateInvalidationKeys, trackLifecycleInvalidationKeys } from '../use-live-invalidation.js'

describe('trackLifecycleInvalidationKeys', () => {
  // 3.4a — "the newest available videos cannot be watched". Root cause: a
  // `pipeline-analytics.track-lifecycle` start/end event refreshed the TRACK
  // list (so the new event/card appears live) but never touched the recording
  // availability that decides whether a moment is WATCHABLE — clips mode's
  // `deriveClipsFromClusters` (fed by `useTimelineActivity`'s
  // `['v2','analytics','activity']`) and the cluster detail's "go to this
  // moment" gate (`recordingKnownAt`, fed by `useRecordingAvailability`'s
  // `['v2','recording','availability']`). Neither of those two queries carries
  // a `refetchInterval` or any other live channel — they refresh ONLY when
  // their query key changes (a new day, a lookback extension) or on an
  // explicit manual retry. So a video could go live (visible as a track/event
  // card, thanks to the existing `device-tracks` invalidation) and never
  // become watchable for as long as the camera screen stayed open on the same
  // day/window — exactly "available" (listed) but "not watchable".
  it('start/end also invalidates the two availability reads clips-mode and the seek gate depend on', () => {
    const keys = trackLifecycleInvalidationKeys('start')
    expect(keys).toContainEqual(['v2', 'analytics', 'activity'])
    expect(keys).toContainEqual(['v2', 'recording', 'availability'])
  })

  it('still invalidates the existing device-tracks + events keys (unchanged behaviour)', () => {
    const keys = trackLifecycleInvalidationKeys('end')
    expect(keys).toContainEqual(['v2', 'analytics', 'device-tracks'])
    expect(keys).toContainEqual(['v2', 'events'])
  })

  it('a mid-track "update" phase invalidates nothing — too chatty, same rule as device-tracks', () => {
    expect(trackLifecycleInvalidationKeys('update')).toEqual([])
  })

  it('an unrecognised/missing phase invalidates nothing', () => {
    expect(trackLifecycleInvalidationKeys(undefined)).toEqual([])
    expect(trackLifecycleInvalidationKeys('bogus')).toEqual([])
  })
})

describe('deviceStateInvalidationKeys', () => {
  const has = (keys: readonly (readonly string[])[], key: readonly string[]): boolean =>
    keys.some((k) => k.join('/') === key.join('/'))

  // Measured on the live hub (2026-10-06): 267 `device.state-changed` events in
  // 20 s, 243 of them `audio-metrics` (the dB meter). Every one invalidated the
  // per-camera children-states fan-out and the badge aggregate, so the Cameras
  // screen re-sent 32 `getChildren` + a badge batch every ~0.5 s through the
  // tunnel for as long as it was open — and nothing those queries read moved.
  it('a dB tick (audio-metrics) no longer refetches children-states or the badges', () => {
    const keys = deviceStateInvalidationKeys({ data: { deviceId: 103, capName: 'audio-metrics' } })
    expect(has(keys, ['v2', 'children-states'])).toBe(false)
    expect(has(keys, ['v2', 'camera-badges'])).toBe(false)
    expect(has(keys, ['v2', 'accessories'])).toBe(false)
    expect(has(keys, ['v2', 'linked-devices'])).toBe(false)
    expect(has(keys, ['v2', 'cap-status'])).toBe(false)
  })

  it('a dB tick still moves the pinned live readouts', () => {
    const keys = deviceStateInvalidationKeys({ data: { deviceId: 103, capName: 'audio-metrics' } })
    expect(has(keys, ['v2', 'device-live-fields'])).toBe(true)
  })

  it('a switch / motion-trigger slice refreshes the child states the card draws', () => {
    for (const capName of ['switch', 'motion-trigger']) {
      const keys = deviceStateInvalidationKeys({ data: { deviceId: 9, capName } })
      expect(has(keys, ['v2', 'children-states'])).toBe(true)
      expect(has(keys, ['v2', 'camera-badges'])).toBe(false)
    }
  })

  it('a badge cap slice refreshes the badge aggregate, not the children', () => {
    for (const capName of ['battery', 'recording-archive', 'network-link']) {
      const keys = deviceStateInvalidationKeys({ data: { deviceId: 9, capName } })
      expect(has(keys, ['v2', 'camera-badges'])).toBe(true)
      expect(has(keys, ['v2', 'children-states'])).toBe(false)
    }
  })

  it('a sensor slice still reaches cap-status, accessories, linked devices and live fields', () => {
    const keys = deviceStateInvalidationKeys({ data: { deviceId: 9, capName: 'temperature-sensor' } })
    for (const key of [['v2', 'cap-status'], ['v2', 'accessories'], ['v2', 'linked-devices'], ['v2', 'device-live-fields']]) {
      expect(has(keys, key)).toBe(true)
    }
  })

  it('an event without a cap name keeps the old broad fan-out (unknown is not "irrelevant")', () => {
    const keys = deviceStateInvalidationKeys({ data: { deviceId: 9 } })
    expect(has(keys, ['v2', 'children-states'])).toBe(true)
    expect(has(keys, ['v2', 'camera-badges'])).toBe(true)
    expect(has(keys, ['v2', 'device-live-fields'])).toBe(true)
  })
})
