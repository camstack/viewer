import { describe, it, expect } from 'vitest'
import { StallRecorder } from '../boot-stall-probe.js'

describe('StallRecorder', () => {
  it('counts nothing when every tick is on time', () => {
    const r = new StallRecorder(0, 25, 50)
    for (let t = 25; t <= 250; t += 25) r.tick(t)
    expect(r.summary()).toEqual({ stalls: 0, worstMs: 0, blockedMs: 0, ticks: 10, lastStallEndMs: 0 })
  })

  it('ignores lateness under the threshold', () => {
    const r = new StallRecorder(0, 25, 50)
    r.tick(25 + 49)
    expect(r.summary().stalls).toBe(0)
  })

  it('counts one long stall once, and re-anchors afterwards', () => {
    const r = new StallRecorder(0, 25, 50)
    r.tick(25)
    r.tick(525) // expected 50, 475 late
    r.tick(550) // on time again after re-anchor
    expect(r.summary()).toEqual({ stalls: 1, worstMs: 475, blockedMs: 475, ticks: 3, lastStallEndMs: 525 })
  })

  it('sums several stalls and keeps the worst', () => {
    const r = new StallRecorder(1_000, 25, 50)
    r.tick(1_025 + 100) // 100 late
    r.tick(1_125 + 25 + 300) // 300 late
    expect(r.summary()).toMatchObject({ stalls: 2, worstMs: 300, blockedMs: 400, lastStallEndMs: 450 })
  })
})
