import { describe, it, expect } from 'vitest'
import { computeNetworkSample, type InboundWindow } from '../webrtc-live-session.js'
import { buildClientHints } from '../client-hints.js'

function win(partial: Partial<InboundWindow>): InboundWindow {
  return { lost: 0, recv: 0, bytes: 0, tsMs: 0, jitterMs: 0, rttMs: 0, ...partial }
}

describe('computeNetworkSample — window-delta derivation (reference: 80b3e7e0)', () => {
  it('returns null on the first window (no previous sample)', () => {
    expect(computeNetworkSample(null, win({ tsMs: 1000 }))).toBeNull()
  })

  it('returns null when the stats timestamp did not advance', () => {
    const prev = win({ tsMs: 1000, recv: 10 })
    expect(computeNetworkSample(prev, win({ tsMs: 1000, recv: 20 }))).toBeNull()
    expect(computeNetworkSample(prev, win({ tsMs: 900, recv: 20 }))).toBeNull()
  })

  it('derives packet-loss % as dLost/(dLost+dRecv) over the window', () => {
    const prev = win({ tsMs: 0, lost: 10, recv: 90 })
    const cur = win({ tsMs: 2000, lost: 15, recv: 185 }) // Δlost 5, Δrecv 95
    const s = computeNetworkSample(prev, cur)
    expect(s?.packetLossPercent).toBe(5)
  })

  it('reports 0 loss on a no-traffic window (never NaN)', () => {
    const prev = win({ tsMs: 0, lost: 3, recv: 100 })
    const s = computeNetworkSample(prev, win({ tsMs: 2000, lost: 3, recv: 100 }))
    expect(s?.packetLossPercent).toBe(0)
  })

  it('derives receive bandwidth in kbps from the byte delta', () => {
    // 250_000 bytes over 2000 ms → 250000*8/2000 = 1000 kbps.
    const prev = win({ tsMs: 0, bytes: 0, recv: 1 })
    const s = computeNetworkSample(prev, win({ tsMs: 2000, bytes: 250_000, recv: 2 }))
    expect(s?.estimatedBandwidthKbps).toBe(1000)
  })

  it('passes jitter/rtt through and clamps every field to the schema bounds', () => {
    const prev = win({ tsMs: 0 })
    const s = computeNetworkSample(
      prev,
      win({ tsMs: 1, lost: 1_000_000, recv: 0, bytes: 10 ** 12, jitterMs: 99_999, rttMs: 999_999 }),
    )
    expect(s).toEqual({
      rttMs: 60_000, // schema max
      jitterMs: 10_000, // schema max
      estimatedBandwidthKbps: 1_000_000, // schema max
      packetLossPercent: 100,
    })
  })

  it('never returns negative values on counter resets', () => {
    const prev = win({ tsMs: 0, lost: 50, recv: 500, bytes: 9_999 })
    const s = computeNetworkSample(prev, win({ tsMs: 1000, lost: 0, recv: 0, bytes: 0 }))
    expect(s?.packetLossPercent).toBe(0)
    expect(s?.estimatedBandwidthKbps).toBe(0)
  })
})

describe('buildClientHints — layout → createSession hints', () => {
  it('scales the layout size by the pixel ratio and rounds to ints', () => {
    expect(buildClientHints(393.5, 220.4, 3)).toEqual({
      viewportWidth: 1181,
      viewportHeight: 661,
      devicePixelRatio: 3,
    })
  })

  it('includes downlinkMbps only when provided and non-negative', () => {
    expect(buildClientHints(100, 100, 2, 12.5)).toEqual({
      viewportWidth: 200,
      viewportHeight: 200,
      devicePixelRatio: 2,
      downlinkMbps: 12.5,
    })
    expect(buildClientHints(100, 100, 2, -1)).toEqual({
      viewportWidth: 200,
      viewportHeight: 200,
      devicePixelRatio: 2,
    })
  })

  it('omits sizes when the layout is not yet measured (0 / negative / NaN)', () => {
    expect(buildClientHints(0, 100, 2)).toEqual({ devicePixelRatio: 2 })
    expect(buildClientHints(100, Number.NaN, 2)).toEqual({ devicePixelRatio: 2 })
  })

  it('defaults an invalid pixel ratio to 1', () => {
    expect(buildClientHints(100, 50, 0)).toEqual({
      viewportWidth: 100,
      viewportHeight: 50,
      devicePixelRatio: 1,
    })
  })
})
