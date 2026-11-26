import { describe, it, expect } from 'vitest'
import { clockAt, clockReport, clockSeek, clockSetRate, clockSetPaused, initialClock } from '../playback-clock'

const W0 = 1_000_000

describe('playback clock', () => {
  it('is unset before a first report', () => {
    expect(clockAt(initialClock, W0)).toBeNull()
  })

  it('interpolates between 1 Hz ticks at the rate', () => {
    const c = clockReport(initialClock, 50_000, W0)
    expect(clockAt(c, W0 + 400)).toBe(50_400)
    const fast = clockSetRate(c, 2, W0 + 400)
    expect(clockAt(fast, W0 + 900)).toBe(51_400)
  })

  it('freezes while paused and resumes from where it froze', () => {
    const c = clockSetPaused(clockReport(initialClock, 50_000, W0), true, W0 + 500)
    expect(clockAt(c, W0 + 5_000)).toBe(50_500)
    const r = clockSetPaused(c, false, W0 + 6_000)
    expect(clockAt(r, W0 + 6_200)).toBe(50_700)
  })

  it('a tick never moves the clock backwards by jitter', () => {
    const c = clockReport(initialClock, 50_000, W0)
    const t = clockReport(c, 50_800, W0 + 1_000) // projected 51 000, SEND cursor says 50 800
    expect(clockAt(t, W0 + 1_000)).toBe(51_000)
  })

  it('a tick far from the projection re-anchors (the cursor jumped)', () => {
    const c = clockReport(initialClock, 50_000, W0)
    const t = clockReport(c, 80_000, W0 + 1_000)
    expect(clockAt(t, W0 + 1_000)).toBe(80_000)
  })

  it('seek resets the anchor and drops the previous interpolation', () => {
    const c = clockSetRate(clockReport(initialClock, 50_000, W0), 4, W0)
    const s = clockSeek(c, 20_000, W0 + 300)
    expect(clockAt(s, W0 + 300)).toBe(20_000)
    expect(clockAt(s, W0 + 800)).toBe(22_000) // rate survives a seek, anchor does not
  })
})
