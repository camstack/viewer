import { describe, it, expect } from 'vitest'
import { shouldRerace, isStaleSwitchClose, STALE_SWITCH_CLOSE_MS } from '../recheck-policy.js'

describe('shouldRerace', () => {
  it('re-races when transitioning into a connected state (recovery)', () => {
    expect(shouldRerace('connecting', 'connected')).toBe(true)
    expect(shouldRerace('disconnected', 'connected')).toBe(true)
  })

  it('does NOT re-race while staying connected', () => {
    expect(shouldRerace('connected', 'connected')).toBe(false)
  })

  it('does NOT re-race on going offline (nothing to race)', () => {
    expect(shouldRerace('connected', 'disconnected')).toBe(false)
    expect(shouldRerace('connected', 'connecting')).toBe(false)
  })
})

describe('isStaleSwitchClose', () => {
  it('is the previous socket closing a few hundred ms after a successful switch', () => {
    // TestFlight 1.0.375: connected at T+194ms, disconnected at T+318ms, no
    // connecting in between. Health was 3/3; tRPC queries still succeeded.
    expect(isStaleSwitchClose(1_000, 1_000 + 318)).toBe(true)
    expect(isStaleSwitchClose(1_000, 1_000 + STALE_SWITCH_CLOSE_MS - 1)).toBe(true)
  })

  it('is NOT a drop that happens after the previous socket would have closed', () => {
    expect(isStaleSwitchClose(1_000, 1_000 + STALE_SWITCH_CLOSE_MS)).toBe(false)
    expect(isStaleSwitchClose(null, 1_000)).toBe(false)
  })
})
