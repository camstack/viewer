import { describe, it, expect } from 'vitest'
import {
  resolvePlayRecovery,
  resolveRecordedProfileForReconnect,
  shouldReassertRecordedOnReconnect,
} from '../reassert-recorded-on-reconnect.js'

describe('shouldReassertRecordedOnReconnect', () => {
  it('refuses live mode', () => {
    expect(
      shouldReassertRecordedOnReconnect({
        playbackMode: 'live',
        playheadEpoch: 1_700_000_000_000,
        clipHoldingFrame: null,
      }),
    ).toBe(false)
  })

  it('refuses when a clip holds the frame', () => {
    expect(
      shouldReassertRecordedOnReconnect({
        playbackMode: 'playback',
        playheadEpoch: 1_700_000_000_000,
        clipHoldingFrame: 'clip-1',
      }),
    ).toBe(false)
  })

  it('accepts recorded playback with a playhead', () => {
    expect(
      shouldReassertRecordedOnReconnect({
        playbackMode: 'playback',
        playheadEpoch: 1_700_000_000_000,
        clipHoldingFrame: null,
      }),
    ).toBe(true)
  })
})

describe('resolveRecordedProfileForReconnect', () => {
  it('prefers the tier that was actually serving', () => {
    expect(
      resolveRecordedProfileForReconnect({ kind: 'adaptive' }, 'mid'),
    ).toBe('mid')
  })

  it('falls back to entry profile from a pinned target', () => {
    expect(
      resolveRecordedProfileForReconnect({ kind: 'profile', profile: 'high' }, null),
    ).toBe('high')
  })

  it('falls back to low for adaptive when nothing was served yet', () => {
    expect(resolveRecordedProfileForReconnect({ kind: 'adaptive' }, null)).toBe('low')
  })
})

describe('resolvePlayRecovery', () => {
  const EPOCH = 1_700_000_000_000
  const NO_CLIP = { clip: null, embedFailed: false } as const

  it('re-enters at the kept playhead after an error', () => {
    expect(resolvePlayRecovery({ mode: 'error', playhead: EPOCH, ...NO_CLIP })).toEqual({
      kind: 'epoch',
      epochMs: EPOCH,
    })
  })

  it('is a plain resume in healthy playback, a gap, or live', () => {
    const none = { kind: 'none' }
    expect(resolvePlayRecovery({ mode: 'playback', playhead: EPOCH, ...NO_CLIP })).toEqual(none)
    expect(resolvePlayRecovery({ mode: 'gap', playhead: EPOCH, ...NO_CLIP })).toEqual(none)
    expect(resolvePlayRecovery({ mode: 'live', playhead: null, ...NO_CLIP })).toEqual(none)
  })

  it('a held clip recovers on its own file axis, never with an absolute epoch', () => {
    expect(
      resolvePlayRecovery({ mode: 'error', playhead: EPOCH, clip: { offsetMs: 12_000 }, embedFailed: false }),
    ).toEqual({ kind: 'clip', offsetMs: 12_000 })
    // The machine stays `live` under a clip (D570): the embed's error is the signal.
    expect(
      resolvePlayRecovery({ mode: 'live', playhead: null, clip: { offsetMs: 12_000 }, embedFailed: true }),
    ).toEqual({ kind: 'clip', offsetMs: 12_000 })
    expect(
      resolvePlayRecovery({ mode: 'live', playhead: null, clip: { offsetMs: null }, embedFailed: true }),
    ).toEqual({ kind: 'clip', offsetMs: 0 })
  })

  it('a healthy clip is a plain resume', () => {
    expect(
      resolvePlayRecovery({ mode: 'live', playhead: null, clip: { offsetMs: 5_000 }, embedFailed: false }),
    ).toEqual({ kind: 'none' })
  })
})
