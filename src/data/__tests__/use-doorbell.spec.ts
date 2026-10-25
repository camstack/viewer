import { describe, it, expect } from 'vitest'
import {
  DOORBELL_CATEGORY,
  RING_WINDOW_MS,
  parseDoorbellEvent,
  readDoorbellStatus,
  formatRingAgo,
} from '../use-doorbell.js'

describe('DOORBELL_CATEGORY', () => {
  // The subscription filters on the hub's EventCategory BUS value
  // (`EventCategory.DoorbellOnPressed = 'doorbell.onPressed'`). Unlike motion,
  // this enum value is camelCase — `subscribeEvent` forwards it verbatim, so the
  // viewer must use exactly this string or the live "ringing" flip never fires.
  it('is the hub enum bus value', () => {
    expect(DOORBELL_CATEGORY).toBe('doorbell.onPressed')
  })
})

describe('parseDoorbellEvent', () => {
  it('parses a well-formed doorbell.onPressed payload', () => {
    const parsed = parseDoorbellEvent({ deviceId: 8, timestamp: 1700000000000 })
    expect(parsed).toEqual({ deviceId: 8, timestamp: 1700000000000 })
  })

  it('returns null for malformed / mistyped payloads', () => {
    expect(parseDoorbellEvent(null)).toBeNull()
    expect(parseDoorbellEvent({})).toBeNull()
    expect(parseDoorbellEvent({ deviceId: '8', timestamp: 1 })).toBeNull() // wrong type
    expect(parseDoorbellEvent({ deviceId: 8 })).toBeNull() // missing timestamp
    expect(parseDoorbellEvent({ timestamp: 1 })).toBeNull() // missing deviceId
  })
})

describe('readDoorbellStatus', () => {
  it('narrows a well-formed getStatus result', () => {
    expect(readDoorbellStatus({ lastPressedAt: 1234, pressCountSinceStart: 3 })).toEqual({
      lastPressedAt: 1234,
      pressCount: 3,
    })
  })

  it('treats a never-pressed slice as null lastPressedAt', () => {
    expect(readDoorbellStatus({ lastPressedAt: null, pressCountSinceStart: 0 })).toEqual({
      lastPressedAt: null,
      pressCount: 0,
    })
  })

  it('defaults to "never rang" on unexpected shapes', () => {
    expect(readDoorbellStatus(null)).toEqual({ lastPressedAt: null, pressCount: 0 })
    expect(readDoorbellStatus({})).toEqual({ lastPressedAt: null, pressCount: 0 })
    expect(readDoorbellStatus({ lastPressedAt: 'x' })).toEqual({ lastPressedAt: null, pressCount: 0 })
  })
})

describe('formatRingAgo (pure, injectable clock)', () => {
  const base = 1_700_000_000_000

  it('returns null when there was never a ring (badge hidden)', () => {
    expect(formatRingAgo(null, base)).toBeNull()
  })

  it('says "now" within the last minute', () => {
    expect(formatRingAgo(base, base)).toBe('now')
    expect(formatRingAgo(base - 30_000, base)).toBe('now')
    expect(formatRingAgo(base - 59_000, base)).toBe('now')
  })

  it('formats minutes / hours / days compactly', () => {
    expect(formatRingAgo(base - 5 * 60_000, base)).toBe('5m')
    expect(formatRingAgo(base - 2 * 3_600_000, base)).toBe('2h')
    expect(formatRingAgo(base - 3 * 86_400_000, base)).toBe('3d')
  })

  it('clamps a future timestamp to "now" (no negative age)', () => {
    expect(formatRingAgo(base + 10_000, base)).toBe('now')
  })
})

describe('RING_WINDOW_MS', () => {
  // The transient "ringing now" highlight window. A press is a pulse (no
  // release), so ringingNow is set true on the event and auto-cleared after
  // this many ms; documented here so the constant is pinned.
  it('is a short presentational window', () => {
    expect(RING_WINDOW_MS).toBeGreaterThan(0)
    expect(RING_WINDOW_MS).toBeLessThanOrEqual(15_000)
  })
})
