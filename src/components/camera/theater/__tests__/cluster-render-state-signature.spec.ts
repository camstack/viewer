import { describe, it, expect } from 'vitest'
import { clusterRenderStateSignature } from '../cluster-render-state-signature.js'

const BASE = {
  deviceId: 7,
  objectEvents: 12,
  objectEventRange: { first: '10:00:00', last: '11:00:00' },
  zone: null,
  clusters: 4,
  activity: { recording: 3, motion: 2, audio: 0 },
  dayWindow: { from: 1, to: 2 },
}

describe('cluster render state signature', () => {
  it('is identical across re-computes of the same data', () => {
    expect(clusterRenderStateSignature({ ...BASE })).toBe(
      clusterRenderStateSignature({ ...BASE, activity: { ...BASE.activity } }),
    )
  })

  it('changes when the data changes', () => {
    const base = clusterRenderStateSignature(BASE)
    expect(clusterRenderStateSignature({ ...BASE, objectEvents: 13 })).not.toBe(base)
    expect(clusterRenderStateSignature({ ...BASE, clusters: 5 })).not.toBe(base)
    expect(
      clusterRenderStateSignature({ ...BASE, activity: { ...BASE.activity, motion: 3 } }),
    ).not.toBe(base)
  })
})
