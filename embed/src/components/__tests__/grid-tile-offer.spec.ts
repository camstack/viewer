import { describe, it, expect } from 'vitest'
import type {
  ClientOfferResult,
  ClientStreamHints,
  PlayerWebrtcTarget,
  WebrtcTarget,
} from '@camstack/ui-library'
import { createTileOfferBridge, type TileHandleOffer } from '../grid-tile-offer'

interface Call {
  readonly target: WebrtcTarget | PlayerWebrtcTarget
  readonly sdpOffer: string
  readonly sessionId?: string
  readonly hints?: ClientStreamHints
}

function spy(): { calls: Call[]; fn: TileHandleOffer } {
  const calls: Call[] = []
  const fn: TileHandleOffer = async (target, sdpOffer, sessionId, hints) => {
    calls.push({ target, sdpOffer, sessionId, hints })
    const result: ClientOfferResult = { sessionId: 'sid-1', sdpAnswer: 'answer' }
    return result
  }
  return { calls, fn }
}

const HINTS: ClientStreamHints = {
  viewportWidth: 1290,
  viewportHeight: 726,
  devicePixelRatio: 3,
  downlinkMbps: 24,
}

describe('createTileOfferBridge — the tile must not swallow the player hints', () => {
  it('forwards the hints on the first offer', async () => {
    // The original bug: the tile's closure declared `(sdpOffer, sessionId)`,
    // which TypeScript happily accepts for a 3-arg callback, so the hints were
    // dropped at the call and every grid session reached the hub blind.
    const { calls, fn } = spy()
    const bridge = createTileOfferBridge(fn, { kind: 'adaptive' })
    await bridge.handleOffer('offer-sdp', undefined, HINTS)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.hints).toEqual(HINTS)
  })

  it('binds the tile target on the first offer', async () => {
    const { calls, fn } = spy()
    const bridge = createTileOfferBridge(fn, { kind: 'profile', profile: 'high' })
    await bridge.handleOffer('offer-sdp')
    expect(calls[0]?.target).toEqual({ kind: 'profile', profile: 'high' })
    expect(calls[0]?.sdpOffer).toBe('offer-sdp')
  })

  it('forwards the hints on an adaptive re-offer too', async () => {
    const { calls, fn } = spy()
    const bridge = createTileOfferBridge(fn, { kind: 'adaptive' })
    await bridge.reoffer('sid-9', 'reoffer-sdp', { kind: 'profile', profile: 'mid' }, HINTS)
    expect(calls[0]?.hints).toEqual(HINTS)
    expect(calls[0]?.sessionId).toBe('sid-9')
  })

  it('carries the SERVER-chosen target on a re-offer, not the tile target', async () => {
    // A re-offer must not close over the tile's own target — the broker's
    // downgrade/upgrade target is the whole point of the renegotiation.
    const { calls, fn } = spy()
    const bridge = createTileOfferBridge(fn, { kind: 'adaptive' })
    await bridge.reoffer('sid-9', 'reoffer-sdp', { kind: 'profile', profile: 'mid' })
    expect(calls[0]?.target).toEqual({ kind: 'profile', profile: 'mid' })
  })
})
