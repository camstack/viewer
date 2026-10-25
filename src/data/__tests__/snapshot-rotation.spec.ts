/**
 * The opening sweep: how the Cameras list gets one recent frame for every
 * camera when it is first opened, without asking the hub to capture the fleet.
 *
 * The rules that matter are about cost, coverage and termination — every camera
 * gets a turn, a couple at a time, and the sweep ENDS.
 */
import { describe, expect, it } from 'vitest'

import { nextSweepSlice, SWEEP_SLICE_SIZE } from '../snapshot-rotation.js'

const ALL = [1, 2, 3, 4, 5]
const NONE: ReadonlySet<number> = new Set()

describe('nextSweepSlice', () => {
  it('warms cameras that are not on screen, a slice at a time', () => {
    const { warm } = nextSweepSlice({ all: ALL, visible: [], covered: NONE, size: 2 })
    expect(warm).toEqual([1, 2])
  })

  it('treats what is on screen as already covered — it is already being captured', () => {
    const first = nextSweepSlice({ all: ALL, visible: [1, 2], covered: NONE, size: 2 })
    expect(first.warm).toEqual([3, 4])
    expect(first.covered.has(1)).toBe(true)
  })

  it('covers every camera and then STOPS', () => {
    let covered: ReadonlySet<number> = NONE
    const seen: number[] = []
    let done = false
    let ticks = 0
    while (!done && ticks < 20) {
      const next = nextSweepSlice({ all: ALL, visible: [], covered, size: 2 })
      seen.push(...next.warm)
      covered = next.covered
      done = next.done
      ticks++
    }
    expect(done).toBe(true)
    expect(seen.sort((a, b) => a - b)).toEqual(ALL)
    // Three ticks for five cameras at two a time — not four, and not forever.
    expect(ticks).toBe(3)
  })

  it('is done immediately when the whole list is on screen', () => {
    const next = nextSweepSlice({ all: [1, 2], visible: [1, 2], covered: NONE, size: 2 })
    expect(next.warm).toEqual([])
    expect(next.done).toBe(true)
  })

  it('never warms a camera twice', () => {
    const first = nextSweepSlice({ all: ALL, visible: [], covered: NONE, size: 2 })
    const second = nextSweepSlice({ all: ALL, visible: [], covered: first.covered, size: 2 })
    expect(second.warm.some((id) => first.warm.includes(id))).toBe(false)
  })

  it('extends rather than skips when the camera list grows mid-sweep', () => {
    // The hub answers late, or a camera is adopted while the sweep runs. A
    // `done` computed against the old list would leave the newcomer with the
    // stale tile this sweep exists to prevent.
    const first = nextSweepSlice({ all: [1, 2], visible: [], covered: NONE, size: 2 })
    expect(first.done).toBe(true)
    const grown = nextSweepSlice({ all: [1, 2, 3], visible: [], covered: first.covered, size: 2 })
    expect(grown.warm).toEqual([3])
    expect(grown.done).toBe(true)
  })

  it('is done on an empty list rather than ticking forever', () => {
    expect(nextSweepSlice({ all: [], visible: [], covered: NONE, size: 2 }).done).toBe(true)
  })

  it('never exceeds the slice, whatever the fleet size', () => {
    const many = Array.from({ length: 60 }, (_, i) => i + 1)
    const next = nextSweepSlice({ all: many, visible: [], covered: NONE, size: SWEEP_SLICE_SIZE })
    expect(next.warm).toHaveLength(SWEEP_SLICE_SIZE)
    expect(next.done).toBe(false)
  })
})
