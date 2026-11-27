import { describe, it, expect } from 'vitest'
import {
  clockAt, clockPresented, clockReport, clockSeek, clockSetRate, clockSetPaused, initialClock, PRESENTED_FRESH_MS, takePresented,
} from '../playback-clock'

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

describe('playback clock — presented frame (planning#728 P2)', () => {
  it('follows the presented frame, not the 1 Hz send cursor that runs ahead of it', () => {
    const c = clockPresented(clockReport(initialClock, 50_000, W0), 49_800, W0 + 100)
    // the send cursor says 51 000 (ahead by the buffer); the shown frame wins
    const t = clockReport(c, 51_000, W0 + 600)
    expect(clockAt(t, W0 + 600)).toBe(49_800 + 500)
  })

  it('takes the cursor again once presented reports stop (no rvfc / stalled)', () => {
    const c = clockPresented(initialClock, 49_800, W0)
    const t = clockReport(c, 51_000, W0 + PRESENTED_FRESH_MS + 1)
    expect(clockAt(t, W0 + PRESENTED_FRESH_MS + 1)).toBe(51_000)
  })

  it('a seek re-anchors immediately and forgets the presented source', () => {
    const c = clockPresented(initialClock, 49_800, W0)
    const s = clockSeek(c, 900_000, W0 + 10)
    expect(clockAt(s, W0 + 10)).toBe(900_000)
    expect(s.presentedWall).toBeNull()
    // the first cursor report after the seek is accepted, not suppressed
    expect(clockAt(clockReport(s, 900_300, W0 + 310), W0 + 310)).toBe(900_300)
  })

  it('pause freezes on the presented frame and a rate change keeps it', () => {
    const c = clockPresented(initialClock, 49_800, W0)
    const p = clockSetPaused(c, true, W0 + 200)
    expect(clockAt(p, W0 + 5_000)).toBe(50_000)
    const r = clockSetRate(clockSetPaused(p, false, W0 + 5_000), 2, W0 + 5_000)
    expect(clockAt(r, W0 + 5_100)).toBe(50_200)
  })
})

describe('takePresented', () => {
  it('applies a report once, and drops one that lands while a seek awaits its anchor', () => {
    const base = clockReport(initialClock, 50_000, W0)
    const r = { epochMs: 49_700, atWall: W0 + 50 }
    const a = takePresented(base, r, null, false)
    expect(clockAt(a.clock, W0 + 50)).toBe(49_700)
    expect(takePresented(a.clock, r, a.lastAtWall, false).clock).toBe(a.clock)
    const stale = takePresented(base, { epochMs: 10, atWall: W0 + 60 }, null, true)
    expect(stale.clock).toBe(base)
    expect(stale.lastAtWall).toBe(W0 + 60)
  })
})
