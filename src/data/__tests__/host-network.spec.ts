import { describe, expect, it } from 'vitest'
import { networkLabel, toHostNetwork } from '../host-network.js'
import { formatClock, msToNextMinute } from '../host-clock.js'

describe('toHostNetwork', () => {
  it('is null until the platform answers', () => {
    expect(toHostNetwork(null)).toBeNull()
  })
  it('reads offline from isConnected=false or type none', () => {
    expect(toHostNetwork({ isConnected: false, type: 'wifi' })?.kind).toBe('offline')
    expect(toHostNetwork({ isConnected: true, type: 'none' })?.kind).toBe('offline')
  })
  it('keeps wifi strength (Android) clamped, and null where absent (iOS)', () => {
    expect(toHostNetwork({ isConnected: true, type: 'wifi', details: { strength: 82 } })).toEqual({
      kind: 'wifi',
      strengthPct: 82,
      generation: null,
    })
    expect(toHostNetwork({ isConnected: true, type: 'wifi', details: { strength: 400 } })?.strengthPct).toBe(100)
    expect(toHostNetwork({ isConnected: true, type: 'wifi', details: null })?.strengthPct).toBeNull()
  })
  it('reads the cellular generation only when volunteered', () => {
    expect(
      toHostNetwork({ isConnected: true, type: 'cellular', details: { cellularGeneration: '5g' } })?.generation,
    ).toBe('5g')
    expect(toHostNetwork({ isConnected: true, type: 'cellular', details: {} })?.generation).toBeNull()
  })
  it('labels', () => {
    expect(networkLabel({ kind: 'wifi', strengthPct: 82, generation: null })).toBe('82%')
    expect(networkLabel({ kind: 'wifi', strengthPct: null, generation: null })).toBeNull()
    expect(networkLabel({ kind: 'cellular', strengthPct: null, generation: '4g' })).toBe('4G')
    expect(networkLabel({ kind: 'offline', strengthPct: null, generation: null })).toBeNull()
  })
})

describe('host clock', () => {
  it('formats hours and minutes in the given locale', () => {
    const d = new Date(2026, 9, 13, 7, 5)
    expect(formatClock(d, 'en-GB')).toBe('07:05')
  })
  it('waits for the next whole minute, never 0', () => {
    expect(msToNextMinute(60_000 * 5 + 15_000)).toBe(45_000)
    expect(msToNextMinute(60_000 * 5)).toBe(60_000)
  })
})
