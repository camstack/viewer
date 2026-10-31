import { describe, expect, it } from 'vitest'

import { pickFromIds, resolveCameraScope, ticksFor } from '../camera-scope.js'

const FLEET = [3, 5, 8]

describe('camera scope', () => {
  it('null means every camera, in fleet order', () => {
    expect(resolveCameraScope(FLEET, null)).toEqual(FLEET)
    expect([...ticksFor(FLEET, null)]).toEqual(FLEET)
  })

  it('a pick keeps fleet order and drops ids the fleet no longer has', () => {
    expect(resolveCameraScope(FLEET, [8, 3, 99])).toEqual([3, 8])
  })

  it('ticking every camera returns to "all", so a camera that arrives later is included', () => {
    expect(pickFromIds(FLEET, [8, 5, 3])).toBeNull()
    expect(pickFromIds(FLEET, [5, 3])).toEqual([3, 5])
  })

  it('a camera joining while the pick is "all" is in the scope', () => {
    expect(resolveCameraScope([...FLEET, 11], null)).toEqual([3, 5, 8, 11])
  })
})
