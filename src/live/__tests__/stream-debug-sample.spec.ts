/**
 * The sample crosses a WebView boundary as JSON, and the panel it feeds exists
 * to tell "nobody measured" apart from "measured nothing".
 *
 * That is the whole reason this parser is not a cast. A missing field coerced
 * to 0 would render as `0 frames decoded` — a stalled decoder — on a panel
 * opened one second before the stream connected. Every unreadable field is
 * `null`, and `null` draws as "not known".
 */
import { describe, expect, it } from 'vitest'
import { isPlaybackStatsReply, parseStreamDebugSample } from '../stream-debug-sample.js'

const FULL = {
  at: 1_000,
  verdict: 'decoder-stall',
  sessionId: 'abc123',
  serverWired: true,
  serverError: null,
  stats: {
    at: 990,
    width: 640,
    height: 360,
    fps: 25,
    framesDecoded: 1234,
    freezeCount: 2,
    totalFreezeMs: 1500,
    pliCount: 3,
    lossPercent: 0.25,
    rttMs: 12,
    jitterMs: 3.5,
    candidatePairType: 'srflx',
    candidateProtocol: 'udp',
    window: { framesDecoded: 0, kbps: 98, pliCount: 1 },
  },
  server: {
    alive: true,
    servedTier: 'mid',
    adaptive: false,
    camStreamId: 'native:slot-3',
    sourceKind: 'native',
    ingestNodeId: 'hub',
    egressLeg: 'copy',
    lastDecision: { cause: 'stall', tier: 'low' },
  },
}

describe('parseStreamDebugSample', () => {
  it('reads a complete sample', () => {
    const sample = parseStreamDebugSample(FULL)
    expect(sample?.verdict).toBe('decoder-stall')
    expect(sample?.stats?.framesDecoded).toBe(1234)
    expect(sample?.stats?.window?.kbps).toBe(98)
    expect(sample?.server?.servedTier).toBe('mid')
    expect(sample?.server?.lastDecision).toEqual({ cause: 'stall', causeDetail: null, tier: 'low' })
  })

  it('keeps a measured ZERO as zero — it is the finding, not a gap', () => {
    // Frames decoded not advancing over the window IS the decoder stall.
    expect(parseStreamDebugSample(FULL)?.stats?.window?.framesDecoded).toBe(0)
  })

  it('turns every unreadable field into null, never into 0', () => {
    const sample = parseStreamDebugSample({ at: 5, stats: { at: 5 }, server: {} })
    expect(sample?.stats?.framesDecoded).toBeNull()
    expect(sample?.stats?.fps).toBeNull()
    expect(sample?.stats?.window).toBeNull()
    expect(sample?.server?.servedTier).toBeNull()
  })

  it('refuses a payload with no clock — an undated sample cannot be aged', () => {
    expect(parseStreamDebugSample({ verdict: 'decoding' })).toBeNull()
    expect(parseStreamDebugSample(null)).toBeNull()
    expect(parseStreamDebugSample('nope')).toBeNull()
  })

  it('refuses a verdict it does not know, rather than rendering it', () => {
    expect(parseStreamDebugSample({ at: 1, verdict: 'excellent' })?.verdict).toBe('unknown')
  })

  it('treats an unknown source kind or leg as unknown, never as a guess', () => {
    const sample = parseStreamDebugSample({
      at: 1,
      server: { alive: true, sourceKind: 'maybe', egressLeg: 'something' },
    })
    expect(sample?.server?.sourceKind).toBe('unknown')
    expect(sample?.server?.egressLeg).toBe('unknown')
  })

  it('reads WHY the ladder is holding, so "held" never looks like "no ladder"', () => {
    const sample = parseStreamDebugSample({
      at: 1,
      server: {
        alive: true,
        lastDecision: null,
        climbHold: {
          code: 'capacity',
          nextTier: 'mid',
          summary: 'held: probe 1400 kbps, REMB 480 kbps < mid needs 2160 kbps (1800 × 1.2)',
        },
      },
    })
    expect(sample?.server?.climbHold).toEqual({
      code: 'capacity',
      summary: 'held: probe 1400 kbps, REMB 480 kbps < mid needs 2160 kbps (1800 × 1.2)',
    })
  })

  it('reads the finer cause of a move when the hub names one (a reverted try)', () => {
    const sample = parseStreamDebugSample({
      at: 1,
      server: { alive: true, lastDecision: { cause: 'loss', causeDetail: 'trial-revert', tier: 'low' } },
    })
    expect(sample?.server?.lastDecision).toEqual({ cause: 'loss', causeDetail: 'trial-revert', tier: 'low' })
  })

  it('an older hub that sends no hold reads as none, and an unknown code keeps its summary', () => {
    expect(parseStreamDebugSample({ at: 1, server: { alive: true } })?.server?.climbHold).toBeNull()
    expect(
      parseStreamDebugSample({ at: 1, server: { alive: true, climbHold: { code: 'future', summary: 'held: x' } } })
        ?.server?.climbHold,
    ).toEqual({ code: 'unknown', summary: 'held: x' })
  })

  it('a session the server could not confirm is not alive', () => {
    expect(parseStreamDebugSample({ at: 1, server: {} })?.server?.alive).toBe(false)
  })
})

/**
 * The sniff that ate every sample.
 *
 * `handleMessage` checks for the injected `getStats` reply before anything
 * else, and it used to do that with `raw.includes('"stats"')`. A stream-debug
 * sample carries a field called `stats`, so it matched, the handler returned,
 * and the status card reported "no measurement yet" — with the embed sending
 * one sample a second the whole time. The lesson is small and expensive: a
 * cheap sniff still has to be a sniff for the right thing.
 */
describe('isPlaybackStatsReply', () => {
  it('recognises the probe reply the injected script actually sends', () => {
    expect(isPlaybackStatsReply('{"type":"stats","w":640,"h":360,"total":120}')).toBe(true)
  })

  it('does NOT claim a stream-debug sample, which merely CONTAINS stats', () => {
    const sample = JSON.stringify({
      type: 'log',
      scope: 'stream-debug',
      msg: 'sample',
      data: { at: 1, stats: { at: 1, framesDecoded: 10 } },
    })
    expect(isPlaybackStatsReply(sample)).toBe(false)
  })

  it('ignores anything that is not a string', () => {
    expect(isPlaybackStatsReply(null)).toBe(false)
    expect(isPlaybackStatsReply({ type: 'stats' })).toBe(false)
  })
})
