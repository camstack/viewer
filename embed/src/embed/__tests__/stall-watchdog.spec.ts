import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STALL_MS,
  isStalled,
  MAX_RECOVERY_ATTEMPTS,
  RECOVERY_BACKOFF_MS,
  recoveryBackoffMs,
} from '../use-stall-watchdog'

describe('isStalled', () => {
  const base = { stallMs: DEFAULT_STALL_MS, playing: true }

  it('frames still advancing → NOT a stall', () => {
    const now = 1_000_000
    expect(isStalled({ ...base, lastFrameAt: now - 500, nowMs: now })).toBe(false)
    expect(isStalled({ ...base, lastFrameAt: now - 9_000, nowMs: now })).toBe(false)
  })

  it('no frame for the whole window → a stall', () => {
    const now = 1_000_000
    expect(isStalled({ ...base, lastFrameAt: now - DEFAULT_STALL_MS, nowMs: now })).toBe(true)
    expect(isStalled({ ...base, lastFrameAt: now - 30_000, nowMs: now })).toBe(true)
  })

  it('a stream that NEVER started is not a stalled one', () => {
    // The gotchas file records a hysteresis field left at 0 reading as "healthy
    // since 1970". The mirror image would be fatal here: a watchdog that treats
    // "no frame yet" as "no frame for ages" reconnect-loops every tile the
    // instant it mounts. `null` is not a timestamp.
    expect(isStalled({ ...base, lastFrameAt: null, nowMs: 1_000_000 })).toBe(false)
  })

  it('does not fire while the player is not playing', () => {
    // Connecting, paused, errored — all have their own paths, and a watchdog
    // that fought them would rebuild sessions that were already being rebuilt.
    expect(isStalled({ ...base, playing: false, lastFrameAt: 0, nowMs: 10_000_000 })).toBe(false)
  })

  it('tolerates a 1 fps night sub-stream', () => {
    // A camera at one frame a second still ticks ten times inside the window.
    const now = 1_000_000
    expect(isStalled({ ...base, lastFrameAt: now - 1_000, nowMs: now })).toBe(false)
  })
})

describe('the threshold', () => {
  it('is long enough for low-fps and short enough to beat a human', () => {
    expect(DEFAULT_STALL_MS).toBeGreaterThanOrEqual(8_000)
    expect(DEFAULT_STALL_MS).toBeLessThanOrEqual(15_000)
  })
})

describe('recoveryBackoffMs', () => {
  it('retries the FIRST recovery immediately — a stall is already 10s old', () => {
    expect(recoveryBackoffMs(0)).toBe(0)
  })

  it('backs off, then clamps instead of growing forever', () => {
    expect(recoveryBackoffMs(1)).toBe(5_000)
    expect(recoveryBackoffMs(2)).toBe(15_000)
    expect(recoveryBackoffMs(3)).toBe(30_000)
    expect(recoveryBackoffMs(99)).toBe(RECOVERY_BACKOFF_MS[RECOVERY_BACKOFF_MS.length - 1])
  })

  it('is bounded — a tile that cannot be fixed stops being rebuilt', () => {
    expect(MAX_RECOVERY_ATTEMPTS).toBeLessThanOrEqual(5)
    expect(MAX_RECOVERY_ATTEMPTS).toBeGreaterThanOrEqual(2)
  })

  it('is total for a negative attempt', () => {
    expect(recoveryBackoffMs(-1)).toBe(0)
  })
})
