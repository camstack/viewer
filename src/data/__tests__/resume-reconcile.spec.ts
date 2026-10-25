import { describe, it, expect } from 'vitest'
import {
  decideReconcile,
  reconcileLanded,
  INITIAL_RECONCILE_STATE,
  RECONCILE_MIN_GAP_MS,
  RECONCILE_RETRY_DELAYS_MS,
  RECONCILE_HEAD_KEY,
  RESUME_MIN_AWAY_MS,
  VOLATILE_QUERY_KEYS,
  type ReconcileState,
} from '../resume-reconcile.js'

const T0 = 1_000_000

describe('decideReconcile — foreground', () => {
  it('runs after a long absence while connected', () => {
    const d = decideReconcile(INITIAL_RECONCILE_STATE, {
      kind: 'foreground',
      awayMs: 8 * 3_600_000,
      connected: true,
      nowMs: T0,
    })
    expect(d.run).toBe(true)
    expect(d.reason).toBe('run')
    expect(d.state.lastRunAtMs).toBe(T0)
    expect(d.retryInMs).toBeNull()
  })

  it('skips a glance away shorter than the floor — the live channel covered it', () => {
    const d = decideReconcile(INITIAL_RECONCILE_STATE, {
      kind: 'foreground',
      awayMs: RESUME_MIN_AWAY_MS - 1,
      connected: true,
      nowMs: T0,
    })
    expect(d.run).toBe(false)
    expect(d.reason).toBe('brief-away')
    expect(d.state).toEqual(INITIAL_RECONCILE_STATE)
  })

  it('runs when the away time is unknown (no departure was recorded)', () => {
    const d = decideReconcile(INITIAL_RECONCILE_STATE, {
      kind: 'foreground',
      awayMs: null,
      connected: true,
      nowMs: T0,
    })
    expect(d.run).toBe(true)
  })

  it('DEFERS instead of running when the transport is not connected', () => {
    const d = decideReconcile(INITIAL_RECONCILE_STATE, {
      kind: 'foreground',
      awayMs: 60_000,
      connected: false,
      nowMs: T0,
    })
    expect(d.run).toBe(false)
    expect(d.reason).toBe('deferred')
    expect(d.state.pending).toBe(true)
    // Nothing ran, so the throttle clock must NOT have moved.
    expect(d.state.lastRunAtMs).toBe(0)
  })

  it('throttles a second foreground inside the minimum gap', () => {
    const ran: ReconcileState = { lastRunAtMs: T0, pending: false, attempt: 0 }
    const d = decideReconcile(ran, {
      kind: 'foreground',
      awayMs: 60_000,
      connected: true,
      nowMs: T0 + RECONCILE_MIN_GAP_MS - 1,
    })
    expect(d.run).toBe(false)
    expect(d.reason).toBe('throttled')
    expect(d.state.lastRunAtMs).toBe(T0)
  })

  it('runs again once the minimum gap has elapsed', () => {
    const ran: ReconcileState = { lastRunAtMs: T0, pending: false, attempt: 0 }
    const d = decideReconcile(ran, {
      kind: 'foreground',
      awayMs: 60_000,
      connected: true,
      nowMs: T0 + RECONCILE_MIN_GAP_MS,
    })
    expect(d.run).toBe(true)
  })
})

/** A pass that was dispatched and then reported back. */
function passWithOutcome(landed: boolean, atMs: number): ReconcileState {
  const ran = decideReconcile(INITIAL_RECONCILE_STATE, {
    kind: 'foreground',
    awayMs: 60_000,
    connected: true,
    nowMs: atMs,
  })
  expect(ran.run).toBe(true)
  return decideReconcile(ran.state, { kind: 'outcome', landed, nowMs: atMs + 500 }).state
}

describe('decideReconcile — reconnected', () => {
  it('flushes a deferred foreground, ignoring the throttle', () => {
    const deferred: ReconcileState = { lastRunAtMs: T0, pending: true, attempt: 0 }
    const d = decideReconcile(deferred, { kind: 'reconnected', nowMs: T0 + 100 })
    expect(d.run).toBe(true)
    expect(d.state.lastRunAtMs).toBe(T0 + 100)
    // Still owed: dispatching is not landing, and this pass is going out over a
    // socket that came up moments ago.
    expect(d.state.pending).toBe(true)
  })

  it('reconciles on a plain reconnection — events dropped during the gap are lost', () => {
    const d = decideReconcile(INITIAL_RECONCILE_STATE, { kind: 'reconnected', nowMs: T0 })
    expect(d.run).toBe(true)
    expect(d.reason).toBe('run')
  })

  it('does not re-run on a flapping socket inside the minimum gap', () => {
    const landed = passWithOutcome(true, T0)
    const d = decideReconcile(landed, { kind: 'reconnected', nowMs: T0 + 1_000 })
    expect(d.run).toBe(false)
    expect(d.reason).toBe('throttled')
  })

  it('is NOT throttled by a pass that failed — that failure is why we are here', () => {
    // The resume pass went out over the dying socket and did not land; the
    // throttle clock it moved must not now swallow the recovery.
    const failed = passWithOutcome(false, T0)
    expect(failed.attempt).toBe(1)
    const d = decideReconcile(failed, { kind: 'reconnected', nowMs: T0 + 1_500 })
    expect(d.run).toBe(true)
    expect(d.state.attempt).toBe(0)
  })

  it('is NOT throttled by a pass that is still IN FLIGHT (the 2026-08-19 report)', () => {
    // The exact stopwatch of a resume onto a socket that did not survive the
    // suspension: the pass is dispatched at once (the mirrored state still says
    // connected), the keep-alive notices the dead socket ~16 s later and the SDK
    // dials a new one — all BEFORE the doomed pass finishes failing on its
    // 12 s query deadline plus a retry. So the recovery arrives while `attempt`
    // is still 0, and reading that as "we just reconciled" is what left the
    // camera list stale until a manual pull-to-refresh.
    const dispatched = decideReconcile(INITIAL_RECONCILE_STATE, {
      kind: 'foreground',
      awayMs: 8 * 3_600_000,
      connected: true,
      nowMs: T0,
    })
    expect(dispatched.run).toBe(true)
    expect(dispatched.state.attempt).toBe(0)

    const recovery = decideReconcile(dispatched.state, {
      kind: 'reconnected',
      nowMs: T0 + 18_000,
    })
    expect(recovery.run).toBe(true)
    expect(recovery.reason).toBe('run')
  })

  it('is NOT throttled once the retry ladder is exhausted — it is still owed', () => {
    let state = decideReconcile(INITIAL_RECONCILE_STATE, {
      kind: 'foreground',
      awayMs: 60_000,
      connected: true,
      nowMs: T0,
    }).state
    let at = T0
    // Fail every attempt in the ladder, then one more to exhaust it.
    for (let i = 0; i <= RECONCILE_RETRY_DELAYS_MS.length; i += 1) {
      at += 1_000
      state = decideReconcile(state, { kind: 'outcome', landed: false, nowMs: at }).state
      if (i < RECONCILE_RETRY_DELAYS_MS.length) {
        at += RECONCILE_RETRY_DELAYS_MS[i] ?? 0
        state = decideReconcile(state, { kind: 'retry', nowMs: at }).state
      }
    }
    expect(state.attempt).toBe(0)

    const d = decideReconcile(state, { kind: 'reconnected', nowMs: at + 1_000 })
    expect(d.run).toBe(true)
    expect(d.reason).toBe('run')
  })

  it('a landed pass clears the debt — the next flap is throttled again', () => {
    const dispatched = decideReconcile(INITIAL_RECONCILE_STATE, {
      kind: 'reconnected',
      nowMs: T0,
    })
    const landed = decideReconcile(dispatched.state, {
      kind: 'outcome',
      landed: true,
      nowMs: T0 + 400,
    })
    expect(landed.state.pending).toBe(false)
    const flap = decideReconcile(landed.state, { kind: 'reconnected', nowMs: T0 + 900 })
    expect(flap.run).toBe(false)
    expect(flap.reason).toBe('throttled')
  })
})

describe('decideReconcile — first connect', () => {
  it('does not reconcile a cold launch — it arms the throttle instead', () => {
    const d = decideReconcile(INITIAL_RECONCILE_STATE, { kind: 'first-connect', nowMs: T0 })
    expect(d.run).toBe(false)
    expect(d.reason).toBe('cold-start')
    expect(d.state.lastRunAtMs).toBe(T0)
  })

  it('swallows the boot endpoint-race echo that follows it', () => {
    const cold = decideReconcile(INITIAL_RECONCILE_STATE, { kind: 'first-connect', nowMs: T0 })
    const echo = decideReconcile(cold.state, { kind: 'reconnected', nowMs: T0 + 1_500 })
    expect(echo.run).toBe(false)
    expect(echo.reason).toBe('throttled')
  })

  it('still honours a resume deferred before the app ever connected', () => {
    const deferred = decideReconcile(INITIAL_RECONCILE_STATE, {
      kind: 'foreground',
      awayMs: 60_000,
      connected: false,
      nowMs: T0,
    })
    const d = decideReconcile(deferred.state, { kind: 'first-connect', nowMs: T0 + 5_000 })
    expect(d.run).toBe(true)
    // Dispatched, not yet landed — the debt survives until the data moves.
    expect(d.state.pending).toBe(true)
  })
})

describe('decideReconcile — outcome and bounded retry', () => {
  it('clears the attempt counter AND the debt when the pass landed', () => {
    const after: ReconcileState = { lastRunAtMs: T0, pending: true, attempt: 2 }
    const d = decideReconcile(after, { kind: 'outcome', landed: true, nowMs: T0 + 500 })
    expect(d.run).toBe(false)
    expect(d.reason).toBe('landed')
    expect(d.retryInMs).toBeNull()
    expect(d.state.attempt).toBe(0)
    expect(d.state.pending).toBe(false)
  })

  it('a pass that ran out of retries stays OWED', () => {
    const exhausted: ReconcileState = {
      lastRunAtMs: T0,
      pending: true,
      attempt: RECONCILE_RETRY_DELAYS_MS.length,
    }
    const d = decideReconcile(exhausted, { kind: 'outcome', landed: false, nowMs: T0 + 500 })
    expect(d.reason).toBe('exhausted')
    expect(d.state.pending).toBe(true)
  })

  it('schedules the next retry delay when the pass did not land', () => {
    const after: ReconcileState = { lastRunAtMs: T0, pending: false, attempt: 0 }
    const first = decideReconcile(after, { kind: 'outcome', landed: false, nowMs: T0 + 500 })
    expect(first.run).toBe(false)
    expect(first.reason).toBe('retry')
    expect(first.retryInMs).toBe(RECONCILE_RETRY_DELAYS_MS[0])
    expect(first.state.attempt).toBe(1)

    const second = decideReconcile(first.state, {
      kind: 'outcome',
      landed: false,
      nowMs: T0 + 1_000,
    })
    expect(second.retryInMs).toBe(RECONCILE_RETRY_DELAYS_MS[1])
    expect(second.state.attempt).toBe(2)
  })

  it('gives up after the last bounded retry instead of looping forever', () => {
    const exhausted: ReconcileState = {
      lastRunAtMs: T0,
      pending: false,
      attempt: RECONCILE_RETRY_DELAYS_MS.length,
    }
    const d = decideReconcile(exhausted, { kind: 'outcome', landed: false, nowMs: T0 + 500 })
    expect(d.run).toBe(false)
    expect(d.reason).toBe('exhausted')
    expect(d.retryInMs).toBeNull()
    expect(d.state.attempt).toBe(0)
  })

  it('a retry always runs and keeps its place in the bounded sequence', () => {
    const retrying: ReconcileState = { lastRunAtMs: T0, pending: false, attempt: 1 }
    const d = decideReconcile(retrying, { kind: 'retry', nowMs: T0 + 2_000 })
    expect(d.run).toBe(true)
    expect(d.state.attempt).toBe(1)
    expect(d.state.lastRunAtMs).toBe(T0 + 2_000)
  })
})

describe('reconcileLanded', () => {
  it('is true when fresh data arrived after the pass started', () => {
    expect(reconcileLanded({ dataUpdatedAt: T0 + 10, startedAtMs: T0, observed: true })).toBe(true)
  })

  it('is false when the data is still the pre-pass copy (the refetch failed)', () => {
    expect(reconcileLanded({ dataUpdatedAt: T0 - 10, startedAtMs: T0, observed: true })).toBe(false)
  })

  it('is false when the query never produced data at all', () => {
    expect(reconcileLanded({ dataUpdatedAt: undefined, startedAtMs: T0, observed: true })).toBe(
      false,
    )
  })

  it('is true when nothing observes the query — there is no screen to correct', () => {
    expect(reconcileLanded({ dataUpdatedAt: T0 - 10, startedAtMs: T0, observed: false })).toBe(true)
  })
})

describe('VOLATILE_QUERY_KEYS', () => {
  it('carries the camera list — the surface the operator reported stale', () => {
    expect(VOLATILE_QUERY_KEYS).toContainEqual(['v2', 'cameras'])
  })

  it('leads with the head key BY IDENTITY, so a pass can dispatch it once', () => {
    // The hook skips this entry when fanning out the rest and awaits it
    // separately; a copy here would double-fetch the list on every pass.
    expect(VOLATILE_QUERY_KEYS[0]).toBe(RECONCILE_HEAD_KEY)
    expect(VOLATILE_QUERY_KEYS.filter((k) => k === RECONCILE_HEAD_KEY)).toHaveLength(1)
  })

  it('never invalidates the expensive history feeds a resume cannot have changed', () => {
    const flattened = VOLATILE_QUERY_KEYS.map((k) => k.join('/'))
    for (const forbidden of [
      'v2/tracks-feed',
      'v2/faces',
      'v2/identities',
      'v2/event-kinds',
      'v2/analytics',
      'v2/clips',
      'v2/recording',
    ]) {
      expect(flattened).not.toContain(forbidden)
    }
  })

  it('lists every key exactly once', () => {
    const flattened = VOLATILE_QUERY_KEYS.map((k) => k.join('/'))
    expect(new Set(flattened).size).toBe(flattened.length)
  })
})
