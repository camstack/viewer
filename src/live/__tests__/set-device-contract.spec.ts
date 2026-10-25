/**
 * The in-place camera swap crosses a bundle boundary, and this is the test that
 * stops the two halves drifting (D483).
 *
 * The host builds the command (`live-control-map.ts`) and the EMBED validates
 * it (`embed/src/embed/set-device-command.ts`) — two files, two builds, one
 * wire shape. A writer and a reader declared separately have no test that
 * catches them diverging unless something feeds one into the other, so that is
 * exactly what this does: the host's real encoder output is parsed by the
 * embed's real schema.
 *
 * Both transports are covered, because they serialise differently: native
 * injects JavaScript source text, web posts an object.
 */
import { describe, it, expect } from 'vitest'
import {
  playbackCommandToMessage,
  playbackCommandToScript,
  setDeviceValue,
  type PlaybackCommand,
} from '../live-control-map.js'
import { parseSetDeviceCommand } from '../../../embed/src/embed/set-device-command.js'

const T = 1_700_000_000_000

/** Pull the JSON payload back out of the injected script — the only way to
 *  assert what the PAGE will actually receive on native. The host encodes with
 *  `JSON.stringify` so nested `target` keys stay valid JSON. */
function payloadFromScript(script: string): unknown {
  const match = /__camstackEmbedPage\.setDevice\((\{.*\})\)/.exec(script)
  if (match === null) return null
  return JSON.parse(match[1] ?? 'null')
}

describe('the swap the HOST sends is one the EMBED accepts', () => {
  it('web: a device-only swap parses, and means "open live"', () => {
    const cmd: PlaybackCommand = { kind: 'setDevice', deviceId: 101 }
    const message = playbackCommandToMessage(cmd)
    expect(message.kind).toBe('setDevice')
    const parsed = parseSetDeviceCommand(setDeviceValue(cmd))
    expect(parsed).toEqual({ deviceId: 101 })
    expect(parsed?.atMs).toBeUndefined()
  })

  it('web: a swap carrying an instant parses, with the instant intact', () => {
    const parsed = parseSetDeviceCommand(
      setDeviceValue({ kind: 'setDevice', deviceId: 101, atMs: T }),
    )
    expect(parsed).toEqual({ deviceId: 101, atMs: T })
  })

  it('native: the injected script carries a payload the schema accepts', () => {
    const script = playbackCommandToScript({ kind: 'setDevice', deviceId: 101, atMs: T })
    expect(script).toContain('__camstackEmbedPage.setDevice')
    expect(parseSetDeviceCommand(payloadFromScript(script))).toEqual({ deviceId: 101, atMs: T })
  })

  it('native: a device-only swap too', () => {
    const script = playbackCommandToScript({ kind: 'setDevice', deviceId: 7 })
    expect(parseSetDeviceCommand(payloadFromScript(script))).toEqual({ deviceId: 7 })
  })

  /** The two transports must describe the SAME swap. */
  it('both transports agree, field for field', () => {
    const cmd: PlaybackCommand = { kind: 'setDevice', deviceId: 101, atMs: T, muted: true }
    expect(parseSetDeviceCommand(payloadFromScript(playbackCommandToScript(cmd)))).toEqual(
      parseSetDeviceCommand(setDeviceValue(cmd)),
    )
  })
})

describe('absent fields are OMITTED, never sent as undefined', () => {
  /**
   * The schema reads ABSENT as "keep what the page booted with" — and for the
   * instant, as "open live". An explicit `undefined` survives the web
   * postMessage clone as a missing key but would serialise to `null` through
   * any JSON hop, and `null` fails validation: the whole swap is then dropped
   * and the camera silently does not change.
   */
  it('a device-only swap mentions no other field at all', () => {
    expect(Object.keys(setDeviceValue({ kind: 'setDevice', deviceId: 101 }))).toEqual(['deviceId'])
    expect(playbackCommandToScript({ kind: 'setDevice', deviceId: 101 })).not.toContain('atMs')
  })

  it('survives a JSON round trip, which is what a null would fail', () => {
    const value = setDeviceValue({ kind: 'setDevice', deviceId: 101 })
    expect(parseSetDeviceCommand(JSON.parse(JSON.stringify(value)))).toEqual({ deviceId: 101 })
  })
})

describe('the instant is rounded once, by the encoder', () => {
  it('a fractional epoch reaches the schema as an integer', () => {
    // `setDeviceCommandSchema` requires an int; an unrounded epoch from a
    // wall-clock subtraction would be rejected and the swap silently dropped.
    const parsed = parseSetDeviceCommand(
      setDeviceValue({ kind: 'setDevice', deviceId: 101, atMs: T + 0.4 }),
    )
    expect(parsed?.atMs).toBe(T)
  })
})

describe('the host can carry the live target across a swap', () => {
  it('a profile target survives both transports and the embed schema', () => {
    const cmd: PlaybackCommand = {
      kind: 'setDevice',
      deviceId: 101,
      target: { kind: 'profile', profile: 'high' },
    }
    expect(parseSetDeviceCommand(setDeviceValue(cmd))).toEqual({
      deviceId: 101,
      target: { kind: 'profile', profile: 'high' },
    })
    expect(parseSetDeviceCommand(payloadFromScript(playbackCommandToScript(cmd)))).toEqual({
      deviceId: 101,
      target: { kind: 'profile', profile: 'high' },
    })
  })

  it('an adaptive target is sent when the host asks for one', () => {
    const cmd: PlaybackCommand = {
      kind: 'setDevice',
      deviceId: 7,
      target: { kind: 'adaptive' },
    }
    expect(parseSetDeviceCommand(setDeviceValue(cmd))).toEqual({
      deviceId: 7,
      target: { kind: 'adaptive' },
    })
  })

  it('absent target stays omitted — the page keeps what it booted with', () => {
    expect(Object.keys(setDeviceValue({ kind: 'setDevice', deviceId: 101 }))).toEqual(['deviceId'])
    expect(playbackCommandToScript({ kind: 'setDevice', deviceId: 101 })).not.toContain('target')
  })
})
