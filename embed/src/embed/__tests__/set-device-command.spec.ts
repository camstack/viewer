/**
 * set-device — the embed player's in-place camera swap.
 *
 * A fresh embed page per camera open pays the whole cold path again: page
 * boot, a second WebSocket, config handshake, TURN fetch. The `setDevice`
 * command lets a host swap the camera on the ALREADY-BOOTED page — the
 * system/WS/query client survive, only the player remounts (which is also
 * what guarantees the previous camera's last frame can never linger: the
 * video element is recreated). The command crosses a trust boundary (injected
 * JS on native, postMessage on web), so it is schema-validated here.
 */
import { describe, it, expect } from 'vitest'
import { parseSetDeviceCommand } from '../set-device-command'

describe('parseSetDeviceCommand', () => {
  it('accepts a minimal command (deviceId only)', () => {
    expect(parseSetDeviceCommand({ deviceId: 101 })).toEqual({ deviceId: 101 })
  })

  it('accepts the full shape', () => {
    const cmd = {
      deviceId: 102,
      target: { kind: 'profile', profile: 'low' },
      muted: true,
      stats: false,
      snapshot: 'data:image/jpeg;base64,abc',
    }
    expect(parseSetDeviceCommand(cmd)).toEqual(cmd)
  })

  it('accepts an adaptive target', () => {
    expect(parseSetDeviceCommand({ deviceId: 1, target: { kind: 'adaptive' } })).toEqual({
      deviceId: 1,
      target: { kind: 'adaptive' },
    })
  })

  /**
   * The instant a swap may carry (D483). Absent means the new camera opens
   * LIVE, which is what every swap meant before this field existed — so an old
   * host that never sends it keeps working unchanged, and a NEW host talking to
   * an old page is the case the app's capability fallback covers.
   */
  it('accepts an instant, and treats its absence as "open live"', () => {
    expect(parseSetDeviceCommand({ deviceId: 101, atMs: 1_700_000_000_000 })).toEqual({
      deviceId: 101,
      atMs: 1_700_000_000_000,
    })
    expect(parseSetDeviceCommand({ deviceId: 101 })?.atMs).toBeUndefined()
  })

  it('rejects an instant that could not be a timestamp', () => {
    expect(parseSetDeviceCommand({ deviceId: 101, atMs: 0 })).toBeNull()
    expect(parseSetDeviceCommand({ deviceId: 101, atMs: -1 })).toBeNull()
    expect(parseSetDeviceCommand({ deviceId: 101, atMs: 1.5 })).toBeNull()
    expect(parseSetDeviceCommand({ deviceId: 101, atMs: 'now' })).toBeNull()
  })

  it('rejects a negative or non-integer deviceId', () => {
    expect(parseSetDeviceCommand({ deviceId: -1 })).toBeNull()
    expect(parseSetDeviceCommand({ deviceId: 1.5 })).toBeNull()
  })

  it('rejects a malformed target', () => {
    expect(parseSetDeviceCommand({ deviceId: 1, target: { kind: 'cam-stream' } })).toBeNull()
    expect(parseSetDeviceCommand({ deviceId: 1, target: { kind: 'profile' } })).toBeNull()
  })

  it('rejects non-objects and garbage', () => {
    expect(parseSetDeviceCommand(null)).toBeNull()
    expect(parseSetDeviceCommand('101')).toBeNull()
    expect(parseSetDeviceCommand(undefined)).toBeNull()
    expect(parseSetDeviceCommand({})).toBeNull()
  })

  it('strips unknown fields rather than failing (forward compatibility)', () => {
    expect(parseSetDeviceCommand({ deviceId: 2, futureField: true })).toEqual({ deviceId: 2 })
  })
})
