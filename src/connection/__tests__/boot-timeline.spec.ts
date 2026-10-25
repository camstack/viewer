import { describe, it, expect } from 'vitest'
import { BootTimeline } from '../boot-timeline.js'

/** A clock the test drives by hand — no wallclock, no flake. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000
  return { now: () => t, advance: (ms) => { t += ms } }
}

describe('BootTimeline', () => {
  it('times each stage from the launch, and each link from the previous stage', () => {
    const clock = fakeClock()
    const tl = new BootTimeline(clock.now)

    tl.mark('appStart')
    clock.advance(40)
    tl.mark('serverRestored')
    clock.advance(1_200)
    const ready = tl.mark('transportReady')

    expect(ready).toEqual({ stage: 'transportReady', atMs: 1_240, sincePrevMs: 1_200 })
    expect(tl.summary()).toEqual({ appStart: 0, serverRestored: 40, transportReady: 1_240 })
  })

  it('keeps the FIRST observation of a stage', () => {
    // A remount must not rewrite the number that described the launch — the
    // whole point is that `firstFrame` means the first one.
    const clock = fakeClock()
    const tl = new BootTimeline(clock.now)
    tl.mark('firstFrame')
    clock.advance(5_000)
    expect(tl.mark('firstFrame')).toBeNull()
    expect(tl.summary()).toEqual({ firstFrame: 0 })
  })

  it('reports a stage that never happened by omitting it', () => {
    // An absent stage is a finding: no `routeSwitched` means the seeded route
    // already won, and no `firstFrame` means the launch never showed a picture.
    const tl = new BootTimeline(fakeClock().now)
    tl.mark('appStart')
    expect(tl.has('routeSwitched')).toBe(false)
    expect(Object.keys(tl.summary())).toEqual(['appStart'])
  })
})
