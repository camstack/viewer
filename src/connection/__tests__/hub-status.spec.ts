/**
 * The root hub-status overlay's decision core (operator, 2026-10-23: one root
 * overlay instead of two per-page states that showed on EVERY app open).
 */
import { describe, expect, it } from 'vitest'
import {
  HUB_STATUS_INITIAL,
  nextHubStatus,
  visibleHubStatus,
  type HubStatus,
  type HubStatusEvent,
} from '../hub-status.js'
import type { ConnState } from '../recheck-policy.js'

const conn = (state: ConnState, startingUp = false): HubStatusEvent => ({
  type: 'connection',
  state,
  startingUp,
})
const GRACE: HubStatusEvent = { type: 'graceElapsed' }
const RESTORED_DONE: HubStatusEvent = { type: 'restoredElapsed' }

function run(events: readonly HubStatusEvent[], from: HubStatus = HUB_STATUS_INITIAL): HubStatus {
  return events.reduce(nextHubStatus, from)
}

describe('hub status — the grace period', () => {
  it('a cold start that connects within the grace shows NOTHING, ever', () => {
    const s1 = run([conn('connecting', true)])
    expect(s1.phase).toBe('waiting')
    expect(visibleHubStatus(s1)).toBeNull()
    const s2 = run([conn('connected')], s1)
    expect(s2.phase).toBe('hidden')
    // No "Back online" for a loss the operator never saw.
    expect(visibleHubStatus(s2)).toBeNull()
  })

  it('a resume from the background that redials within the grace shows nothing', () => {
    const s = run([conn('connected'), conn('connecting'), conn('connected')])
    expect(visibleHubStatus(s)).toBeNull()
  })

  it('a loss that outlasts the grace says "connecting"', () => {
    expect(visibleHubStatus(run([conn('connecting'), GRACE]))).toBe('connecting')
  })

  it('a grace that elapses after the connection came back changes nothing', () => {
    expect(visibleHubStatus(run([conn('connecting'), conn('connected'), GRACE]))).toBeNull()
  })
})

describe('hub status — transitions', () => {
  it('connecting → offline once the drop is confirmed', () => {
    expect(visibleHubStatus(run([conn('connecting'), GRACE, conn('disconnected')]))).toBe('offline')
  })

  it('a confirmed drop during the cold-start race still reads as connecting', () => {
    expect(visibleHubStatus(run([conn('connecting', true), GRACE, conn('disconnected', true)]))).toBe(
      'connecting',
    )
  })

  it('a drop seen inside the grace surfaces as offline when the grace ends', () => {
    expect(visibleHubStatus(run([conn('disconnected'), GRACE]))).toBe('offline')
  })

  it('offline → connecting on a retry, → back online, → gone', () => {
    const offline = run([conn('connecting'), GRACE, conn('disconnected')])
    const retrying = run([conn('connecting')], offline)
    expect(visibleHubStatus(retrying)).toBe('connecting')
    const restored = run([conn('connected')], retrying)
    expect(visibleHubStatus(restored)).toBe('restored')
    expect(visibleHubStatus(run([RESTORED_DONE], restored))).toBeNull()
  })

  it('offline → back online directly', () => {
    expect(visibleHubStatus(run([conn('disconnected'), GRACE, conn('connected')]))).toBe('restored')
  })

  it('a drop during "Back online" waits out a fresh grace instead of flapping', () => {
    const restored = run([conn('connecting'), GRACE, conn('connected')])
    const again = run([conn('connecting')], restored)
    expect(again.phase).toBe('waiting')
    expect(visibleHubStatus(run([RESTORED_DONE], again))).toBeNull()
  })

  it('a stray restoredElapsed outside "Back online" changes nothing', () => {
    const shown = run([conn('connecting'), GRACE])
    expect(run([RESTORED_DONE], shown)).toEqual(shown)
  })
})
