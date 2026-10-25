import { describe, expect, it } from 'vitest'
import {
  WALL_BACK_HIDE_MS,
  createWallBackTimer,
  createWallTouchRelay,
  type WallBackScheduler,
} from '../wall-back-visibility.js'
import { scrollBottomPadding } from '../../navigation/bottom-nav-inset.js'

function fakeScheduler() {
  const pending = new Map<number, { fn: () => void; ms: number }>()
  let next = 1
  const scheduler: WallBackScheduler = {
    set: (fn, ms) => {
      pending.set(next, { fn, ms })
      return next++
    },
    clear: (h) => {
      pending.delete(h as number)
    },
  }
  return { scheduler, pending, fire: () => [...pending.values()].forEach((p) => p.fn()) }
}

describe('wall back button timer', () => {
  it('shows on touch and hides once after the quiet time', () => {
    const f = fakeScheduler()
    const seen: boolean[] = []
    const timer = createWallBackTimer((v) => seen.push(v), f.scheduler)
    timer.touch()
    expect([...f.pending.values()][0]?.ms).toBe(WALL_BACK_HIDE_MS)
    f.fire()
    expect(seen).toEqual([true, false])
  })

  it('restarts the countdown on a second touch instead of stacking', () => {
    const f = fakeScheduler()
    const timer = createWallBackTimer(() => undefined, f.scheduler)
    timer.touch()
    timer.touch()
    expect(f.pending.size).toBe(1)
  })

  it('dispose cancels a pending hide', () => {
    const f = fakeScheduler()
    const seen: boolean[] = []
    const timer = createWallBackTimer((v) => seen.push(v), f.scheduler)
    timer.touch()
    timer.dispose()
    f.fire()
    expect(seen).toEqual([true])
  })

  it('relay reaches every subscriber until unsubscribed', () => {
    const relay = createWallTouchRelay()
    let n = 0
    const off = relay.subscribe(() => { n++ })
    relay.notify()
    off()
    relay.notify()
    expect(n).toBe(1)
  })
})

describe('events gallery bottom padding', () => {
  it('adds the glass bar inset to the base, so the last row clears it', () => {
    expect(scrollBottomPadding(64, 88)).toBe(152)
    expect(scrollBottomPadding(64, 0)).toBe(64)
  })
})
