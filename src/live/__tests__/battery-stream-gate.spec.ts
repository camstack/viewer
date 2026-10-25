import { describe, it, expect } from 'vitest'
import {
  resolveLivePaused,
  isBatteryHold,
  shouldMountLiveView,
  shouldDialLiveOnGoLive,
  tileOperatorChoice,
  heldTileIds,
  toggleTileTransport,
  type GridTransport,
  type LiveStreamGateInput,
  type LiveViewMountInput,
} from '../battery-stream-gate.js'

const gate = (patch: Partial<LiveStreamGateInput>): LiveStreamGateInput => ({
  operatorChoice: null,
  cameraKnown: true,
  batteryPowered: false,
  ...patch,
})

describe('resolveLivePaused — mounting is starting, so the gate decides before the mount', () => {
  it('a wired camera streams on arrival, exactly as before', () => {
    expect(resolveLivePaused(gate({}))).toBe(false)
  })

  it('a BATTERY camera opens paused — the whole requirement', () => {
    expect(resolveLivePaused(gate({ batteryPowered: true }))).toBe(true)
  })

  it('an unidentified camera HOLDS — the camera list is [] on a cold first render', () => {
    // Latching `useState(hasBattery)` on that frame latches false and dials a
    // sleeping camera. A stream that has started cannot be un-started.
    expect(resolveLivePaused(gate({ cameraKnown: false }))).toBe(true)
    expect(resolveLivePaused(gate({ cameraKnown: false, batteryPowered: true }))).toBe(true)
  })

  it('play wins over the battery rule — otherwise the button does nothing', () => {
    expect(resolveLivePaused(gate({ batteryPowered: true, operatorChoice: false }))).toBe(false)
  })

  it('play wins over the not-yet-identified hold too', () => {
    expect(resolveLivePaused(gate({ cameraKnown: false, operatorChoice: false }))).toBe(false)
  })

  it('pause wins on a wired camera — the ordinary transport still works', () => {
    expect(resolveLivePaused(gate({ operatorChoice: true }))).toBe(true)
  })
})

describe('isBatteryHold — only the state that has something honest to say', () => {
  it('is the battery hold, before any tap', () => {
    expect(isBatteryHold(gate({ batteryPowered: true }))).toBe(true)
  })

  it('is NOT an operator pause — they did that, it needs no explanation', () => {
    expect(isBatteryHold(gate({ batteryPowered: true, operatorChoice: true }))).toBe(false)
  })

  it('is NOT a started battery camera', () => {
    expect(isBatteryHold(gate({ batteryPowered: true, operatorChoice: false }))).toBe(false)
  })

  it('is NOT the unidentified hold — a mains camera must not be told it is on battery', () => {
    expect(isBatteryHold(gate({ cameraKnown: false, batteryPowered: true }))).toBe(false)
    expect(resolveLivePaused(gate({ cameraKnown: false }))).toBe(true)
  })

  it('is never true for a wired camera', () => {
    expect(isBatteryHold(gate({}))).toBe(false)
  })
})

// ── The GRID, where the wall owns the transport as two id sets ──────────────

const WIRED = { id: 1, batteryPowered: false }
const BATT = { id: 2, batteryPowered: true }
const WALL = [WIRED, BATT]
const empty: GridTransport = { pausedIds: new Set(), startedIds: new Set() }

describe('heldTileIds — what the embedded wall boots paused', () => {
  it('holds every battery tile and no wired one', () => {
    expect(heldTileIds(WALL, empty)).toEqual([2])
  })

  it('an explicitly paused wired tile is held too — the ordinary pause', () => {
    const t: GridTransport = { pausedIds: new Set([1]), startedIds: new Set() }
    expect(heldTileIds(WALL, t)).toEqual([1, 2])
  })

  it('a started battery tile streams', () => {
    const t: GridTransport = { pausedIds: new Set(), startedIds: new Set([2]) }
    expect(heldTileIds(WALL, t)).toEqual([])
  })

  it('a started battery tile the operator then paused is held again', () => {
    const t: GridTransport = { pausedIds: new Set([2]), startedIds: new Set([2]) }
    expect(tileOperatorChoice(t, 2)).toBe(true)
    expect(heldTileIds(WALL, t)).toEqual([2])
  })
})

describe('toggleTileTransport — one button, and the gate says which meaning', () => {
  it('the first press on a held battery tile STARTS it', () => {
    const next = toggleTileTransport(empty, 2, true)
    expect([...next.startedIds]).toEqual([2])
    expect([...next.pausedIds]).toEqual([])
    expect(heldTileIds(WALL, next)).toEqual([])
  })

  it('the first press on a wired tile pauses it, exactly as before', () => {
    const next = toggleTileTransport(empty, 1, false)
    expect([...next.pausedIds]).toEqual([1])
    expect([...next.startedIds]).toEqual([])
  })

  it('un-pausing a battery tile records a START — otherwise it falls back to held', () => {
    // The bug this asserts against: dropping it from `pausedIds` returns it to
    // its DEFAULT, which for a battery camera is stopped. The play button would
    // light up, do nothing visible, and read as broken.
    const paused: GridTransport = { pausedIds: new Set([2]), startedIds: new Set() }
    const next = toggleTileTransport(paused, 2, true)
    expect(heldTileIds(WALL, next)).toEqual([])
  })

  it('un-pausing a wired tile records nothing extra', () => {
    const paused: GridTransport = { pausedIds: new Set([1]), startedIds: new Set() }
    const next = toggleTileTransport(paused, 1, false)
    expect([...next.pausedIds]).toEqual([])
    expect([...next.startedIds]).toEqual([])
  })

  it('never mutates the transport it was handed', () => {
    const before: GridTransport = { pausedIds: new Set([1]), startedIds: new Set([2]) }
    toggleTileTransport(before, 2, true)
    expect([...before.pausedIds]).toEqual([1])
    expect([...before.startedIds]).toEqual([2])
  })
})

/**
 * THE SLEEPING-CAMERA SCRUB WAKE — 2026-08-23.
 *
 * Recorded playback rides the SAME WebRTC peer as live. Mounting `LiveView`
 * IS starting that peer, which wakes the firmware. The old mount rule was
 * `paused && !isRecorded`: the first scrub frame flips the machine to
 * `seeking` (so `isRecorded` is true) and the player mounts on the live
 * edge. A commit onto a gap then fails; auto-retry / goLive keep the live
 * session. The operator never pressed play.
 *
 * Play is the only live wake. A scrub into nothing stays on the poster.
 */
const held: LiveViewMountInput = {
  liveHeld: true,
  mode: 'live',
  playhead: null,
  recordedSeekMs: null,
  keepRecordedSession: false,
  initialClipId: null,
}

describe('shouldMountLiveView — a held camera is not dialled by a scrub into nothing', () => {
  it('a wired / started camera always mounts — live is what they asked for', () => {
    expect(shouldMountLiveView({ ...held, liveHeld: false })).toBe(true)
    expect(shouldMountLiveView({ ...held, liveHeld: false, mode: 'gap' })).toBe(true)
  })

  it('a held camera on the live edge stays on the poster', () => {
    expect(shouldMountLiveView(held)).toBe(false)
  })

  it('the first scrub (seeking, no playhead) does NOT mount', () => {
    expect(shouldMountLiveView({ ...held, mode: 'seeking' })).toBe(false)
  })

  it('a committed recording may mount so the NVR feeder can play', () => {
    expect(shouldMountLiveView({ ...held, mode: 'playback', playhead: 1_000 })).toBe(true)
  })

  it('a further scrub over an existing recording keeps the session', () => {
    expect(shouldMountLiveView({
      ...held,
      mode: 'seeking',
      playhead: 1_000,
      keepRecordedSession: true,
    })).toBe(true)
  })

  it('a leftover playhead after a gap does not remount live-first', () => {
    expect(shouldMountLiveView({
      ...held,
      mode: 'seeking',
      playhead: 1_000,
      keepRecordedSession: false,
      initialClipId: null,
    })).toBe(false)
  })

  it('a gap or failed recording unmounts — falling through to live is the wake', () => {
    expect(shouldMountLiveView({ ...held, mode: 'gap', playhead: 1_000 })).toBe(false)
    expect(shouldMountLiveView({ ...held, mode: 'error', playhead: 1_000 })).toBe(false)
    expect(shouldMountLiveView({ ...held, mode: 'gap', recordedSeekMs: 1_000 })).toBe(false)
  })

  it('a deep-link recorded seek may mount while the machine is still live', () => {
    expect(shouldMountLiveView({ ...held, recordedSeekMs: 1_000 })).toBe(true)
  })
})

describe('shouldDialLiveOnGoLive — go-live on a held camera is a timeline snap, not a wake', () => {
  it('does not remount the live peer while the operator has not pressed play', () => {
    expect(shouldDialLiveOnGoLive(true)).toBe(false)
  })

  it('remounts on a camera that is allowed to stream', () => {
    expect(shouldDialLiveOnGoLive(false)).toBe(true)
  })
})

/**
 * A clip opens on a held camera — including one that is asleep.
 *
 * The operator's clips never played on 3628, a battery camera at rest. The
 * chain reached the port with `hasPlayer: false`: the player is deliberately
 * not mounted on a held camera, and the clip command went to an optional call
 * that dropped it without a word.
 *
 * Mounting for a clip wakes nothing. The bytes are a file the hub serves; the
 * page enters it on its first channel and never dials live, exactly as
 * `recordedSeekMs` already guarantees for a deep-link seek.
 */
describe('shouldMountLiveView — an initial clip', () => {
  const held = {
    liveHeld: true,
    mode: 'live' as const,
    playhead: null,
    recordedSeekMs: null,
    keepRecordedSession: false,
  }

  it('mounts a held camera that has a clip to open', () => {
    expect(shouldMountLiveView({ ...held, initialClipId: 'native:reolink:onboard:0:abc' })).toBe(true)
  })

  it('mounts it even where every other rule says no', () => {
    // `gap` and `error` are the two hard refusals. A clip is not affected by
    // either: it is not the recording those verdicts are about.
    for (const mode of ['gap', 'error'] as const) {
      expect(shouldMountLiveView({ ...held, mode, initialClipId: 'c1' }), mode).toBe(true)
    }
  })

  it('changes nothing when there is no clip', () => {
    expect(shouldMountLiveView({ ...held, initialClipId: null })).toBe(false)
  })
})
