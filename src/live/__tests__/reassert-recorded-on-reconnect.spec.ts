import { describe, it, expect } from 'vitest'
import {
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
