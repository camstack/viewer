/**
 * camera-local — the per-camera AUDIO memory that `last-selected` reads.
 *
 * The one thing that must not break: `false` ("left it silent") is a stored
 * answer, ABSENT ("never chosen here") is not. Every other optional field in
 * this store is copied under a truthiness test, which would drop `false` on the
 * floor and make a deliberately-silenced camera indistinguishable from one
 * nobody has ever listened to.
 */
import { describe, expect, it } from 'vitest'
import {
  parseCameraLocal,
  resetCameraLocalEntry,
  setCameraAudioOnEntry,
  setCameraQualityEntry,
} from '../camera-local-store.js'

const base = resetCameraLocalEntry()

describe('setCameraAudioOnEntry', () => {
  it('remembers "left it speaking"', () => {
    expect(setCameraAudioOnEntry(base, 101, true).byId[101]?.audioOn).toBe(true)
  })

  it('remembers "left it silent" — `false` is stored, not dropped', () => {
    // The truthiness-copy bug: `if (merged.audioOn)` would leave this absent,
    // and the camera would re-read as "never chosen".
    expect(setCameraAudioOnEntry(base, 101, false).byId[101]?.audioOn).toBe(false)
  })

  it('a camera nobody has chosen on carries no entry at all', () => {
    expect(base.byId[101]).toBeUndefined()
  })

  it('does not mutate its input', () => {
    const next = setCameraAudioOnEntry(base, 101, true)
    expect(next).not.toBe(base)
    expect(base.byId[101]).toBeUndefined()
  })

  it('is per camera, and sits beside the other per-camera memories', () => {
    const withQuality = setCameraQualityEntry(base, 101, 'high')
    const next = setCameraAudioOnEntry(withQuality, 101, false)
    expect(next.byId[101]).toEqual({ quality: 'high', audioOn: false })
    expect(next.byId[102]).toBeUndefined()
  })

  it('a later choice replaces the earlier one', () => {
    const next = setCameraAudioOnEntry(setCameraAudioOnEntry(base, 101, true), 101, false)
    expect(next.byId[101]?.audioOn).toBe(false)
  })
})

describe('persistence round trip', () => {
  it('survives a write/read cycle in BOTH directions', () => {
    for (const choice of [true, false]) {
      const stored = JSON.stringify(setCameraAudioOnEntry(base, 101, choice))
      expect(parseCameraLocal(stored).byId[101]?.audioOn).toBe(choice)
    }
  })

  it('a stored non-boolean reads as absence, never as a choice', () => {
    const parsed = parseCameraLocal(JSON.stringify({ byId: { 101: { audioOn: 'yes' } } }))
    expect(parsed.byId[101]?.audioOn).toBeUndefined()
  })

  it('a document written before this field existed reads as absence', () => {
    const parsed = parseCameraLocal(JSON.stringify({ byId: { 101: { quality: 'low' } } }))
    expect(parsed.byId[101]?.quality).toBe('low')
    expect(parsed.byId[101]?.audioOn).toBeUndefined()
  })
})
