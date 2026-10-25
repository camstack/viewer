import { describe, it, expect } from 'vitest'
import { decideThrottle } from '../refresh-throttle.js'

const THROTTLE = 5_000

describe('decideThrottle (pure leading+trailing throttle)', () => {
  it('fires immediately on the leading edge when the window has elapsed', () => {
    const d = decideThrottle(0, THROTTLE, THROTTLE, false)
    expect(d).toEqual({ fire: true, scheduleInMs: null })
  })

  it('fires immediately when never refreshed before (lastAt = 0, now large)', () => {
    const d = decideThrottle(0, 1_700_000_000_000, THROTTLE, false)
    expect(d.fire).toBe(true)
    expect(d.scheduleInMs).toBeNull()
  })

  it('schedules a trailing fire for the remaining window when inside the throttle', () => {
    // 2s into a 5s window → trailing fire in 3s.
    const d = decideThrottle(1_000, 3_000, THROTTLE, false)
    expect(d.fire).toBe(false)
    expect(d.scheduleInMs).toBe(3_000)
  })

  it('coalesces (no-op) when a trailing timer is already pending', () => {
    const d = decideThrottle(1_000, 3_000, THROTTLE, true)
    expect(d).toEqual({ fire: false, scheduleInMs: null })
  })

  it('fires exactly at the window boundary (elapsed === throttle)', () => {
    const d = decideThrottle(1_000, 1_000 + THROTTLE, THROTTLE, false)
    expect(d.fire).toBe(true)
  })

  it('a burst collapses to leading fire then one trailing schedule', () => {
    const last = 10_000 // last actual refresh at t=10s
    // t=15000: window elapsed → leading fire; the hook then sets lastAt=15000.
    const first = decideThrottle(last, 15_000, THROTTLE, false)
    expect(first.fire).toBe(true)
    // t=16000: 1s into the new window, no timer yet → schedule trailing (4s left).
    const second = decideThrottle(15_000, 16_000, THROTTLE, false)
    expect(second).toEqual({ fire: false, scheduleInMs: 4_000 })
    // t=17000: timer now pending → coalesced (no-op).
    const third = decideThrottle(15_000, 17_000, THROTTLE, true)
    expect(third).toEqual({ fire: false, scheduleInMs: null })
  })
})
