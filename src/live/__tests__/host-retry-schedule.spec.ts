/**
 * The HOST-side auto-retry policy.
 *
 * There are two retry loops and they are not the same loop. The INNER one lives
 * in the embed's player: it rebuilds the WebRTC session behind a surface that
 * never went away. The OUTER one is this — it rebuilds the SURFACE (WebView /
 * iframe reload), which is the only thing that recovers a page that failed to
 * load, or an embed whose script is wedged and therefore cannot retry itself.
 *
 * The outer loop must never race the inner one: a reload throws away whatever
 * progress the inner loop had made, so the first outer delay is a multiple of
 * the inner cap, and the outer schedule climbs from there.
 *
 * Exhaustion is a RESULT, never a silent stop — the caller has to be able to
 * say "we gave up", which is the whole reason this returns an action instead of
 * a nullable delay.
 */
import { describe, it, expect } from 'vitest'
import {
  FAST_FIRST_DELAY_MS,
  HOST_RETRY_POLICY,
  nextHostRetry,
  type HostRetryAction,
} from '../host-retry-schedule'

/** Jitter pinned to the middle of the band, so a delay is exactly the base. */
const noJitter = (): number => 0.5

describe('host retry schedule', () => {
  it('tries ONCE quickly before the ladder', () => {
    // The ladder assumes the inner loop absorbs anything transient, and that
    // holds only for a failure the inner loop can see. A SIGNALLING failure
    // never creates a session for it to rebuild: measured on the live hub
    // 2026-08-08, `createSession` failed 2 of 34 with `No broker for stream
    // "614/adaptive"`, which produced an error card and then 13-19 s of
    // nothing. Attempt 0 is that missing first try.
    const first = nextHostRetry(0, noJitter)
    expect(first).toEqual({ kind: 'retry', attempt: 0, delayMs: FAST_FIRST_DELAY_MS })
  })

  it('is fast enough that a transient is never seen, slow enough not to spin', () => {
    expect(FAST_FIRST_DELAY_MS).toBeGreaterThanOrEqual(1_000)
    expect(FAST_FIRST_DELAY_MS).toBeLessThanOrEqual(3_000)
  })

  it('backs off exponentially from the base delay, starting at attempt 1', () => {
    const delays = [1, 2, 3, 4].map((attempt) => {
      const action = nextHostRetry(attempt, noJitter)
      return action.kind === 'retry' ? action.delayMs : -1
    })
    expect(delays).toEqual([
      HOST_RETRY_POLICY.baseDelayMs,
      HOST_RETRY_POLICY.baseDelayMs * 2,
      HOST_RETRY_POLICY.baseDelayMs * 4,
      HOST_RETRY_POLICY.baseDelayMs * 8,
    ])
  })

  it('never waits longer than the cap', () => {
    for (let attempt = 0; attempt < HOST_RETRY_POLICY.maxAttempts; attempt += 1) {
      const action = nextHostRetry(attempt, () => 1)
      if (action.kind !== 'retry') continue
      expect(action.delayMs).toBeLessThanOrEqual(HOST_RETRY_POLICY.maxDelayMs)
    }
  })

  it('does not jitter the ONE fast attempt — a single retry is not a herd', () => {
    expect(nextHostRetry(0, () => 0)).toEqual(nextHostRetry(0, () => 1))
  })

  it('jitters ±20% around the base so a grid of players does not stampede', () => {
    const low = nextHostRetry(1, () => 0)
    const high = nextHostRetry(1, () => 1)
    expect(low.kind).toBe('retry')
    expect(high.kind).toBe('retry')
    if (low.kind !== 'retry' || high.kind !== 'retry') return
    expect(low.delayMs).toBe(Math.round(HOST_RETRY_POLICY.baseDelayMs * 0.8))
    expect(high.delayMs).toBe(Math.round(HOST_RETRY_POLICY.baseDelayMs * 1.2))
  })

  it('does not race the in-embed loop: the first outer wait outlasts the inner cap', () => {
    // The embed's own reconnect caps at 15 s between attempts. A surface
    // reload sooner than that would keep destroying a session the inner loop
    // was already rebuilding.
    expect(HOST_RETRY_POLICY.baseDelayMs).toBeGreaterThanOrEqual(15_000)
  })

  it('reports exhaustion as an action — the loop is never allowed to just stop', () => {
    const action: HostRetryAction = nextHostRetry(HOST_RETRY_POLICY.maxAttempts, noJitter)
    expect(action).toEqual({ kind: 'exhausted', attempts: HOST_RETRY_POLICY.maxAttempts })
  })

  it('carries the attempt number on every retry, so a log line can be counted', () => {
    const action = nextHostRetry(3, noJitter)
    expect(action.kind === 'retry' ? action.attempt : -1).toBe(3)
  })
})
