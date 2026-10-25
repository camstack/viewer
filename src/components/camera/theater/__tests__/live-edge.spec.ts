import { describe, it, expect } from 'vitest'
import { atLiveEdge, scrollIsHand } from '../live-edge.js'
import { memberSeekMs } from '../cluster-members.js'

/** 15s tolerance — matches LIVE_EDGE_TOLERANCE_MS in TheaterTimeline. */
const TOL = 15_000

describe('atLiveEdge (time-based predicate)', () => {
  it('is false when the pointed time is well behind the live edge', () => {
    // 10 minutes behind → recorded, regardless of zoom.
    expect(atLiveEdge(10 * 60_000, TOL)).toBe(false)
  })

  it('is true within the tolerance of the live edge', () => {
    expect(atLiveEdge(2_000, TOL)).toBe(true)
  })

  it('treats an over-scroll bounce ABOVE the edge (negative delta) as live', () => {
    expect(atLiveEdge(-500, TOL)).toBe(true)
  })

  it('treats a delta exactly at the tolerance as the live edge', () => {
    expect(atLiveEdge(TOL, TOL)).toBe(true)
  })

  it('treats a delta just past the tolerance as recorded (not live)', () => {
    expect(atLiveEdge(TOL + 1, TOL)).toBe(false)
  })

  it('treats the exact live edge (0 behind) as live', () => {
    expect(atLiveEdge(0, TOL)).toBe(true)
  })
})

describe('a tap on a recent event must not return to live', () => {
  it('seeks inside the live band: start - 2 s of an event younger than 17 s', () => {
    const now = 10_000_000
    const recent = { id: 'r', deviceId: 1, className: 'person', timestamp: now - 10_000, trackId: 't' }
    expect(atLiveEdge(now - memberSeekMs(recent), TOL)).toBe(true)
  })

  it('an unflagged report with no finger, momentum or scrub is not a hand (native)', () => {
    expect(scrollIsHand({ pointerDown: false, momentum: false, scrubActive: false, web: false })).toBe(false)
  })

  it('a finger, momentum, an active scrub or the web wheel is a hand', () => {
    const base = { pointerDown: false, momentum: false, scrubActive: false, web: false }
    expect(scrollIsHand({ ...base, pointerDown: true })).toBe(true)
    expect(scrollIsHand({ ...base, momentum: true })).toBe(true)
    expect(scrollIsHand({ ...base, scrubActive: true })).toBe(true)
    expect(scrollIsHand({ ...base, web: true })).toBe(true)
  })
})
