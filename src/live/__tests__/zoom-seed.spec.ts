import { describe, expect, it } from 'vitest'
import { seedFromLive } from '../zoom-seed.js'

describe('seedFromLive', () => {
  it('starts from the live transform, not from a commitment the picture has not reached', () => {
    // A reset commits 1 at once while the picture is still animating at 2.3.
    const seed = seedFromLive({ scale: 2.3, tx: -40, ty: 12 }, 1, 4)
    expect(seed).toEqual({ startScale: 2.3, savedTx: -40, savedTy: 12 })
  })

  it('clamps to the zoom range', () => {
    expect(seedFromLive({ scale: 9, tx: 0, ty: 0 }, 1, 4).startScale).toBe(4)
    expect(seedFromLive({ scale: 0.2, tx: 0, ty: 0 }, 1, 4).startScale).toBe(1)
  })
})
