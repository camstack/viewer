import { describe, it, expect } from 'vitest'
import {
  coerceRecordingHostMessage,
  parseRecordingHostMessage,
  recordingCommandScript,
} from '../recording-messages.js'

describe('parseRecordingHostMessage', () => {
  it('parses a state message', () => {
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'state', state: 'playing' }))).toEqual({
      type: 'state',
      state: 'playing',
    })
  })
  it('parses a state message with a detail message', () => {
    expect(
      parseRecordingHostMessage(JSON.stringify({ type: 'state', state: 'error', message: 'no footage' })),
    ).toEqual({ type: 'state', state: 'error', message: 'no footage' })
  })
  it('parses a position message', () => {
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'position', positionMs: 1234 }))).toEqual({
      type: 'position',
      positionMs: 1234,
    })
  })
  it('parses a scrubDrawn message', () => {
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'scrubDrawn' }))).toEqual({
      type: 'scrubDrawn',
    })
  })
  it('ignores extra fields on a scrubDrawn message (additive tolerance)', () => {
    // A newer embed may attach extra diagnostic fields; the host reads only the type.
    expect(
      parseRecordingHostMessage(JSON.stringify({ type: 'scrubDrawn', epochMs: 42, source: 'webrtc' })),
    ).toEqual({ type: 'scrubDrawn' })
  })
  it('returns null for junk / unknown / malformed', () => {
    expect(parseRecordingHostMessage('not json')).toBeNull()
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'nope' }))).toBeNull()
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'state', state: 'bogus' }))).toBeNull()
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'position' }))).toBeNull()
  })
  it('ignores an UNKNOWN newer message type gracefully (backward compat)', () => {
    // An OLD host must tolerate a NEWER embed emitting a type it does not know:
    // the parser returns null and the caller ignores it (no throw, no crash).
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'someFutureType', foo: 1 }))).toBeNull()
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'scrubPainted' }))).toBeNull()
  })
})

describe('recordingCommandScript', () => {
  it('serializes each command to a window.__camstackRecording call', () => {
    expect(recordingCommandScript({ kind: 'seekTo', epochMs: 1700000000000 })).toContain('window.__camstackRecording')
    expect(recordingCommandScript({ kind: 'seekTo', epochMs: 1700000000000 })).toContain('seekTo(1700000000000)')
    expect(recordingCommandScript({ kind: 'play' })).toContain('play()')
    expect(recordingCommandScript({ kind: 'pause' })).toContain('pause()')
    expect(recordingCommandScript({ kind: 'setRate', rate: 2 })).toContain('setRate(2)')
    expect(recordingCommandScript({ kind: 'fit', w: 800, h: 600 })).toContain('fit(800, 600)')
    expect(recordingCommandScript({ kind: 'scrubStart' })).toContain('scrubStart()')
    expect(recordingCommandScript({ kind: 'scrubTo', epochMs: 123 })).toContain('scrubTo(123)')
    expect(recordingCommandScript({ kind: 'scrubEnd', epochMs: 456 })).toContain('scrubEnd(456)')
  })

  it('guards the call (no throw if the API is not mounted yet) and ends with `true;`', () => {
    const s = recordingCommandScript({ kind: 'play' })
    expect(s).toMatch(/window\.__camstackRecording\s*&&/)
    expect(s.trim().endsWith('true;')).toBe(true)
  })

  it('parses servedProfile from the embed — the tier the player is really on', () => {
    expect(
      parseRecordingHostMessage(JSON.stringify({ type: 'servedProfile', profile: 'mid', requested: 'high' })),
    ).toEqual({ type: 'servedProfile', profile: 'mid', requested: 'high' })
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'servedProfile', profile: 7 }))).toBeNull()
  })
})

describe('parseRecordingHostMessage — the clip AUDIO report (D621)', () => {
  it('parses a rate silence, with the rate it is suppressed at', () => {
    expect(
      parseRecordingHostMessage(
        JSON.stringify({ type: 'clipAudio', clipId: 'c1', carried: false, reason: 'rate', rate: 8 }),
      ),
    ).toEqual({ type: 'clipAudio', clipId: 'c1', carried: false, reason: 'rate', rate: 8 })
  })

  it('parses a clip that IS carrying sound, with its codec', () => {
    expect(
      parseRecordingHostMessage(
        JSON.stringify({ type: 'clipAudio', clipId: 'c1', carried: true, codec: 'opus' }),
      ),
    ).toEqual({ type: 'clipAudio', clipId: 'c1', carried: true, codec: 'opus' })
  })

  it('keeps the other six reasons exactly as they are — none of them is a rate', () => {
    for (const reason of [
      'not-negotiated',
      'not-offered',
      'no-audio-track',
      'unsupported-codec',
      'codec-mismatch',
      'stream-failed',
    ]) {
      expect(
        parseRecordingHostMessage(JSON.stringify({ type: 'clipAudio', clipId: 'c1', carried: false, reason })),
      ).toEqual({ type: 'clipAudio', clipId: 'c1', carried: false, reason })
    }
  })

  it('DROPS a `rate` reason with no usable rate, and keeps the silence unnamed', () => {
    for (const rate of [undefined, 0, -2, Number.NaN, '8']) {
      expect(
        parseRecordingHostMessage(JSON.stringify({ type: 'clipAudio', clipId: 'c1', carried: false, reason: 'rate', rate })),
      ).toEqual({ type: 'clipAudio', clipId: 'c1', carried: false })
    }
  })

  it('DROPS a rate that rides any other reason — the pair is enforced both ways', () => {
    expect(
      parseRecordingHostMessage(
        JSON.stringify({ type: 'clipAudio', clipId: 'c1', carried: false, reason: 'stream-failed', rate: 8 }),
      ),
    ).toEqual({ type: 'clipAudio', clipId: 'c1', carried: false, reason: 'stream-failed' })
  })

  it('REFUSES a report with no clip to pin it on, or no carried flag', () => {
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'clipAudio', clipId: '', carried: false }))).toBeNull()
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'clipAudio', carried: false }))).toBeNull()
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'clipAudio', clipId: 'c1' }))).toBeNull()
  })

  it('coerces the same message from an already-parsed object (the web host path)', () => {
    expect(coerceRecordingHostMessage({ type: 'clipAudio', clipId: 'c1', carried: false, reason: 'rate', rate: 2 })).toEqual(
      { type: 'clipAudio', clipId: 'c1', carried: false, reason: 'rate', rate: 2 },
    )
  })
})

describe('parseRecordingHostMessage — the TRUNCATED serve (D623)', () => {
  const REASON =
    'the camera ended this replay early: 4.3 s of 45.0 s arrived, 40.7 s short.'

  it('parses a short serve, named by clip, with the hub sentence verbatim', () => {
    expect(
      parseRecordingHostMessage(
        JSON.stringify({ type: 'clipIncomplete', clipId: 'c1', code: 'stream-short', reason: REASON }),
      ),
    ).toEqual({ type: 'clipIncomplete', clipId: 'c1', code: 'stream-short', reason: REASON })
  })

  it('keeps an EMPTY serve its own code — a camera fault is not a short clip', () => {
    expect(
      parseRecordingHostMessage(
        JSON.stringify({ type: 'clipIncomplete', clipId: 'c1', code: 'stream-empty', reason: 'no video at all' }),
      ),
    ).toEqual({ type: 'clipIncomplete', clipId: 'c1', code: 'stream-empty', reason: 'no video at all' })
  })

  it('REFUSES `completeness-unverified` — "we could not check" is a provider diagnostic', () => {
    // The hub schema refuses it too (D623). Two refusals rather than one
    // because a diagnostic that reached a screen would read as a fault the
    // operator can act on, and there is nothing to act on.
    expect(
      parseRecordingHostMessage(
        JSON.stringify({
          type: 'clipIncomplete',
          clipId: 'c1',
          code: 'completeness-unverified',
          reason: 'could not measure',
        }),
      ),
    ).toBeNull()
  })

  it('REFUSES a report with no clip to pin it on, and one with no sentence', () => {
    expect(
      parseRecordingHostMessage(
        JSON.stringify({ type: 'clipIncomplete', clipId: '', code: 'stream-short', reason: REASON }),
      ),
    ).toBeNull()
    expect(
      parseRecordingHostMessage(
        JSON.stringify({ type: 'clipIncomplete', code: 'stream-short', reason: REASON }),
      ),
    ).toBeNull()
    // The sentence IS the message — there is no generic fallback string for
    // it anywhere in this app, so a report without one says nothing at all.
    expect(
      parseRecordingHostMessage(
        JSON.stringify({ type: 'clipIncomplete', clipId: 'c1', code: 'stream-short', reason: '' }),
      ),
    ).toBeNull()
  })

  it('coerces the same message from an already-parsed object (the web host path)', () => {
    expect(
      coerceRecordingHostMessage({
        type: 'clipIncomplete',
        clipId: 'c1',
        code: 'stream-empty',
        reason: 'no video at all',
      }),
    ).toEqual({ type: 'clipIncomplete', clipId: 'c1', code: 'stream-empty', reason: 'no video at all' })
  })
})

describe('parseRecordingHostMessage — the clip duration report', () => {
  it('parses a clipDuration named by clip', () => {
    expect(
      parseRecordingHostMessage(
        JSON.stringify({ type: 'clipDuration', clipId: 'native:reolink:onboard:0:abc=', durationMs: 16240 }),
      ),
    ).toEqual({ type: 'clipDuration', clipId: 'native:reolink:onboard:0:abc=', durationMs: 16240 })
  })

  it('IGNORES a clipTransport — the hub no longer sends it, and nothing here parses it', () => {
    // The message was removed on the hub with D612: it declared per clip what
    // cannot vary per clip, and the answer now comes from
    // `videoclips.getPlaybackOptions`, per camera and per provider. A parser
    // kept "just in case" reads as verification that the message still
    // exists, so the branch is gone and the payload falls through the
    // unknown-type arm like any other word this build does not know.
    expect(
      parseRecordingHostMessage(
        JSON.stringify({ type: 'clipTransport', clipId: 'c1', seek: 'forward', stepBack: false }),
      ),
    ).toBeNull()
  })
  it('REFUSES a zero, negative, non-finite or missing duration — a failed measure is never 0 (D393)', () => {
    for (const durationMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '16240', undefined]) {
      expect(
        parseRecordingHostMessage(JSON.stringify({ type: 'clipDuration', clipId: 'c', durationMs })),
      ).toBeNull()
    }
  })
  it('REFUSES a report with no clip to pin it on', () => {
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'clipDuration', clipId: '', durationMs: 5 }))).toBeNull()
    expect(parseRecordingHostMessage(JSON.stringify({ type: 'clipDuration', durationMs: 5 }))).toBeNull()
  })
  it('coerces the same message from an already-parsed object (the web host path)', () => {
    expect(coerceRecordingHostMessage({ type: 'clipDuration', clipId: 'c', durationMs: 5 })).toEqual({
      type: 'clipDuration',
      clipId: 'c',
      durationMs: 5,
    })
    expect(coerceRecordingHostMessage({ type: 'position', positionMs: 12 })).toEqual({ type: 'position', positionMs: 12 })
    expect(coerceRecordingHostMessage('not an object')).toBeNull()
    expect(coerceRecordingHostMessage(null)).toBeNull()
  })
})
