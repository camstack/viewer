import { describe, it, expect } from 'vitest'

import {
  DETENT_INITIAL,
  DETENT_MIN_INTERVAL_MS,
  detentKeyForIds,
  resolveDetent,
  type DetentState,
} from '../scrub-detent.js'

/** Run a sequence of (key, now) steps and collect which ones ticked. */
function run(
  steps: readonly (readonly [string | null, number])[],
  start: DetentState = DETENT_INITIAL,
): readonly boolean[] {
  let state = start
  const ticks: boolean[] = []
  for (const [key, now] of steps) {
    const decision = resolveDetent(state, key, now)
    state = decision.state
    ticks.push(decision.tick)
  }
  return ticks
}

describe('resolveDetent — edge-triggered on the cluster under the cursor', () => {
  it('ticks ONCE on entering a cluster from empty track', () => {
    expect(run([[null, 0], ['a', 1000]])).toEqual([false, true])
  })

  it('does NOT tick while the cursor stays on the SAME cluster', () => {
    // The whole point: this runs on every scroll frame of a drag.
    const steps: (readonly [string | null, number])[] = [['a', 1000]]
    for (let i = 1; i <= 50; i++) steps.push(['a', 1000 + i * 100])
    const ticks = run(steps)
    expect(ticks[0]).toBe(true)
    expect(ticks.slice(1).every((t) => t === false)).toBe(true)
    expect(ticks.filter(Boolean)).toHaveLength(1)
  })

  it('ticks once per CROSSING across a run of clusters', () => {
    expect(
      run([
        ['a', 1000],
        ['a', 1100],
        ['b', 1200],
        ['b', 1300],
        ['c', 1400],
      ]),
    ).toEqual([true, false, true, false, true])
  })

  it('ticks again on RE-ENTRY after leaving to empty track', () => {
    expect(
      run([
        ['a', 1000],
        [null, 1100],
        ['a', 1200],
      ]),
    ).toEqual([true, false, true])
  })

  it('ticks again when returning to a cluster via another one (a → b → a)', () => {
    // Spaced by the FLOOR, not by an incidental 100 ms: this case is about the
    // crossing semantics, and it must not quietly turn into a rate-limit test
    // when the floor moves — which is exactly what happened when it went from
    // 80 ms to 200 ms.
    const step = DETENT_MIN_INTERVAL_MS
    expect(
      run([
        ['a', 1000],
        ['b', 1000 + step],
        ['a', 1000 + 2 * step],
      ]),
    ).toEqual([true, true, true])
  })

  it('holds the cadence to at most five pulses a second on a dense drag', () => {
    // The operator's report, twice: a drag across a dense hour used to fire
    // every 80 ms — 12.5 a second — which reads as one continuous buzz rather
    // than as detents. Simulate a 60 fps drag crossing a new cluster on every
    // single frame for one second.
    const steps: (readonly [string, number])[] = []
    for (let frame = 0; frame < 60; frame++) {
      steps.push([`c${frame}`, 1000 + Math.round((frame * 1000) / 60)])
    }
    const pulses = run(steps).filter(Boolean).length
    expect(pulses).toBeLessThanOrEqual(6)
    // And it must still pulse — silence is a different bug.
    expect(pulses).toBeGreaterThan(2)
  })

  it('never ticks for leaving a cluster — only for arriving at one', () => {
    expect(run([['a', 1000], [null, 1100], [null, 1200]])).toEqual([true, false, false])
  })
})

describe('resolveDetent — the rate limit', () => {
  it('suppresses crossings closer together than the minimum interval', () => {
    const ticks = run([
      ['a', 1000],
      ['b', 1000 + DETENT_MIN_INTERVAL_MS - 1],
      ['c', 1000 + DETENT_MIN_INTERVAL_MS - 1],
    ])
    expect(ticks).toEqual([true, false, false])
  })

  it('allows a crossing exactly AT the interval boundary', () => {
    expect(run([['a', 1000], ['b', 1000 + DETENT_MIN_INTERVAL_MS]])).toEqual([true, true])
  })

  it('still ADVANCES the key through a suppressed crossing', () => {
    // A fast flick a→b must not leave the state pointing at `a`: coming back to
    // `a` afterwards would then read as "no change" and swallow a real tick,
    // while sitting on `b` would tick late. Suppression drops the buzz, never
    // the bookkeeping.
    let state = DETENT_INITIAL
    state = resolveDetent(state, 'a', 1000).state
    const fast = resolveDetent(state, 'b', 1001)
    expect(fast.tick).toBe(false)
    expect(fast.state.key).toBe('b')
    // Long after, returning to `a` is a genuine crossing again.
    const back = resolveDetent(fast.state, 'a', 5000)
    expect(back.tick).toBe(true)
  })

  it('does not let a suppressed crossing push the rate-limit window forward', () => {
    let state = DETENT_INITIAL
    state = resolveDetent(state, 'a', 1000).state // ticks, lastTick = 1000
    state = resolveDetent(state, 'b', 1001).state // suppressed
    // 'c' at 1000 + interval is measured from the last REAL tick (1000).
    const at = resolveDetent(state, 'c', 1000 + DETENT_MIN_INTERVAL_MS)
    expect(at.tick).toBe(true)
  })

  it('seeding lastTickMs suppresses the first crossing — the scrub-begin case', () => {
    // A gesture starts with its own `hapticTap`; seeding the detent with that
    // moment stops the first frame from buzzing a second time on top of it.
    const seeded: DetentState = { key: null, lastTickMs: 1000 }
    expect(run([['a', 1010]], seeded)).toEqual([false])
    expect(run([['a', 1010], ['b', 2000]], seeded)).toEqual([false, true])
  })
})

describe('detentKeyForIds — the grid timeline key', () => {
  it('is null when nothing is under the cursor', () => {
    expect(detentKeyForIds([])).toBeNull()
    expect(detentKeyForIds(new Set<number>())).toBeNull()
  })

  it('is stable regardless of iteration ORDER', () => {
    // A `Set` built by walking lanes yields ids in encounter order, which
    // changes with the data. An unstable key would tick on every frame.
    expect(detentKeyForIds([3, 1, 2])).toBe(detentKeyForIds([1, 2, 3]))
    expect(detentKeyForIds(new Set([102, 101]))).toBe(detentKeyForIds(new Set([101, 102])))
  })

  it('distinguishes different device sets', () => {
    expect(detentKeyForIds([1, 2])).not.toBe(detentKeyForIds([1]))
    expect(detentKeyForIds([1])).not.toBe(detentKeyForIds([2]))
  })

  it('deduplicates repeated ids (two events on one camera are one lane)', () => {
    expect(detentKeyForIds([5, 5, 5])).toBe(detentKeyForIds([5]))
  })
})
