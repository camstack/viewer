import { describe, expect, it } from 'vitest'

import { pickFromIds, resolveCameraScope, ticksFor } from '../camera-scope.js'
import { toggleSelectAll } from '../../../components/camera/camera-scope-binding.js'

const FLEET = [3, 5, 8]

describe('camera scope', () => {
  it('an empty pick is no camera — the first visit', () => {
    expect(resolveCameraScope(FLEET, [])).toEqual([])
    expect([...ticksFor(FLEET, [])]).toEqual([])
  })

  it('a pick keeps fleet order and drops ids the fleet no longer has', () => {
    expect(resolveCameraScope(FLEET, [8, 3, 99])).toEqual([3, 8])
  })

  it('ticking cameras keeps the explicit list, including when every box is ticked', () => {
    expect(pickFromIds(FLEET, [8, 5, 3])).toEqual([3, 5, 8])
    expect(pickFromIds(FLEET, [5, 3])).toEqual([3, 5])
  })

  it('a camera that joins the fleet stays out of a stored pick', () => {
    expect(resolveCameraScope([...FLEET, 11], [3, 5, 8])).toEqual([3, 5, 8])
  })
})

describe('select all', () => {
  it('ticks every camera when any is unticked', () => {
    expect(toggleSelectAll(FLEET, new Set([3]))).toEqual(FLEET)
    expect(toggleSelectAll(FLEET, new Set())).toEqual(FLEET)
  })

  it('clears the selection when every camera is already ticked', () => {
    expect(toggleSelectAll(FLEET, new Set(FLEET))).toEqual([])
  })
})
