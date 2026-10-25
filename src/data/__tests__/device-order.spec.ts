/**
 * device-order — the ONE rule that turns a saved id order + the devices that
 * actually exist into the rendered list.
 *
 * The edge cases are the whole point: a saved order outlives the device set it
 * was written for. Cameras get removed on the hub, new ones appear, and a
 * locally-saved arrangement must never be the reason a device the operator owns
 * stops being listed.
 */
import { describe, expect, it } from 'vitest'
import { applySavedOrder } from '../device-order.js'

interface Row {
  readonly id: number
  readonly name: string
}

const row = (id: number): Row => ({ id, name: `cam-${id}` })
const ids = (rows: readonly Row[]): number[] => rows.map((r) => r.id)

describe('applySavedOrder', () => {
  it('keeps the input order when nothing is saved', () => {
    const input = [row(1), row(2), row(3)]
    expect(ids(applySavedOrder(input, []))).toEqual([1, 2, 3])
  })

  it('sorts the saved ids into the saved order', () => {
    const input = [row(1), row(2), row(3)]
    expect(ids(applySavedOrder(input, [3, 1, 2]))).toEqual([3, 1, 2])
  })

  it('never mutates its input', () => {
    const input = [row(1), row(2), row(3)]
    applySavedOrder(input, [3, 2, 1])
    expect(ids(input)).toEqual([1, 2, 3])
  })

  // ── Degradation: the device set moved under the saved order ────────────────

  it('a device the saved order never heard of goes to the END, in server order', () => {
    // 7 and 8 were added on the hub after the arrangement was saved.
    const input = [row(1), row(7), row(2), row(8), row(3)]
    expect(ids(applySavedOrder(input, [3, 1, 2]))).toEqual([3, 1, 2, 7, 8])
  })

  it('an id in the saved order whose device is gone is simply skipped', () => {
    // 2 was deleted on the hub; its rank must not leave a hole or drop 3.
    const input = [row(1), row(3)]
    expect(ids(applySavedOrder(input, [3, 2, 1]))).toEqual([3, 1])
  })

  it('a saved order NEVER removes a device — the output is a permutation', () => {
    const input = [row(1), row(2), row(3), row(9)]
    const out = applySavedOrder(input, [3, 1])
    expect(out).toHaveLength(input.length)
    expect([...ids(out)].sort((a, b) => a - b)).toEqual([1, 2, 3, 9])
  })

  it('a saved order that knows NONE of the devices changes nothing', () => {
    const input = [row(1), row(2), row(3)]
    expect(ids(applySavedOrder(input, [40, 41]))).toEqual([1, 2, 3])
  })

  it('unranked devices keep their relative server order among themselves', () => {
    const input = [row(5), row(4), row(1), row(6)]
    expect(ids(applySavedOrder(input, [1]))).toEqual([1, 5, 4, 6])
  })

  it('is stable for an empty list', () => {
    expect(applySavedOrder([], [1, 2])).toEqual([])
  })
})
