import { describe, it, expect } from 'vitest'
import {
  captureRecorderTracks,
  pickRecorderMime,
  splitBase64Chunks,
} from '../live-capture.js'

describe('pickRecorderMime', () => {
  it('returns the first type the recorder accepts', () => {
    const supported = new Set(['video/mp4;codecs=avc1.42E01E', 'video/webm'])
    expect(pickRecorderMime((type) => supported.has(type))).toBe('video/mp4;codecs=avc1.42E01E')
  })

  it('falls through to webm when mp4 is unavailable', () => {
    const supported = new Set(['video/webm'])
    expect(pickRecorderMime((type) => supported.has(type))).toBe('video/webm')
  })

  it('returns empty when nothing is supported (let MediaRecorder pick)', () => {
    expect(pickRecorderMime(() => false)).toBe('')
  })

  it('picks a mux that includes an audio codec when the capture has audio', () => {
    const supported = new Set([
      'video/mp4;codecs=avc1.42E01E',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ])
    expect(pickRecorderMime((type) => supported.has(type), { audio: true })).toBe(
      'video/webm;codecs=vp8,opus',
    )
  })
})

describe('captureRecorderTracks', () => {
  const video = { kind: 'video' as const, id: 'v', clone() { return this }, stop: () => {} }
  const clonedAudio = { kind: 'audio' as const, id: 'clone-a', clone() { return this }, stop: () => {} }
  const liveAudio = { kind: 'audio' as const, id: 'live-a', clone: () => clonedAudio, stop: () => {} }
  const silentCaptureAudio = { kind: 'audio' as const, id: 'silent', clone() { return this }, stop: () => {} }

  it('keeps decoded video and clones live srcObject audio (mute-safe)', () => {
    const decoded = {
      getVideoTracks: () => [video],
      getAudioTracks: () => [silentCaptureAudio],
    }
    const live = { getAudioTracks: () => [liveAudio] }
    const tracks = captureRecorderTracks(decoded, live)
    expect(tracks).toEqual([video, clonedAudio])
  })

  it('does not pull live VIDEO tracks (those may be HEVC)', () => {
    const liveVideo = { kind: 'video', id: 'hevc', clone: () => liveVideo, stop: () => {} }
    const decoded = {
      getVideoTracks: () => [video],
      getAudioTracks: () => [],
    }
    const live = {
      getAudioTracks: () => [liveAudio],
      getVideoTracks: () => [liveVideo],
    }
    // Extra `getVideoTracks` is the assertion: live VIDEO must be ignored.
    // Assigned first so the extra key is not an excess-property error.
    const tracks = captureRecorderTracks(decoded, live)
    expect(tracks.some((t) => t.id === 'hevc')).toBe(false)
    expect(tracks).toContain(clonedAudio)
  })

  it('falls back to captureStream audio when srcObject has none', () => {
    const decoded = {
      getVideoTracks: () => [video],
      getAudioTracks: () => [silentCaptureAudio],
    }
    expect(captureRecorderTracks(decoded, null)).toEqual([video, silentCaptureAudio])
  })

  it('re-enables the cloned audio so a muted player still records sound', () => {
    const clone = { kind: 'audio' as const, id: 'clone-a', enabled: false, clone() { return this }, stop: () => {} }
    const mutedLive = { kind: 'audio' as const, id: 'live-a', enabled: false, clone: () => clone, stop: () => {} }
    const decoded = {
      getVideoTracks: () => [video],
      getAudioTracks: () => [],
    }
    captureRecorderTracks(decoded, { getAudioTracks: () => [mutedLive] })
    expect(clone.enabled).toBe(true)
    expect(mutedLive.enabled).toBe(false)
  })
})

describe('splitBase64Chunks', () => {
  it('splits a payload the host can reassemble', () => {
    expect(splitBase64Chunks('abcdefgh', 3)).toEqual(['abc', 'def', 'gh'])
  })
})
