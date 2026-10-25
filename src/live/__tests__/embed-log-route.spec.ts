/**
 * The embed's `{type:'log'}` messages, routed once for both hosts.
 *
 * Operator report on the PWA (viewer 1.0.588): the stream info card always
 * said "No measurement yet" and the stats read-out showed nothing. The embed
 * posts its 1 Hz stream-debug sample to the parent frame exactly as it does to
 * the native WebView — the web host simply never routed it. These cases pin
 * the router, and the wiring block pins BOTH hosts to it, so a platform cannot
 * quietly fall off it again.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EmbedLogRouter,
  PLAYBACK_CENSUS_MIN_INTERVAL_MS,
  STREAM_STATS_STALE_MS,
  streamStatsFromSample,
  type EmbedLogPorts,
} from '../embed-log-route.js'
import { parseStreamDebugSample, type StreamDebugSample } from '../stream-debug-sample.js'

const RAW_SAMPLE = {
  at: 10_000,
  verdict: 'decoding',
  sessionId: 's-1',
  serverWired: true,
  serverError: null,
  stats: {
    at: 9_990,
    width: 1920,
    height: 1080,
    fps: 24.6,
    codec: 'H264',
    packetsLost: 3,
    jitterMs: 4.4,
    window: { kbps: 2048.7 },
  },
  server: null,
}

interface Recorded {
  readonly samples: StreamDebugSample[]
  readonly info: string[]
  readonly debug: string[]
}

function harness(now: { ms: number }): { router: EmbedLogRouter; out: Recorded } {
  const out: Recorded = { samples: [], info: [], debug: [] }
  const ports: EmbedLogPorts = {
    reportSample: (s) => out.samples.push(s),
    info: (scope, msg) => out.info.push(`${scope} ${msg}`),
    debug: (scope, msg) => out.debug.push(`${scope} ${msg}`),
    nowMs: () => now.ms,
  }
  return { router: new EmbedLogRouter(ports), out }
}

describe('the stream-debug sample', () => {
  it('reaches the store, and is never shipped as a log line', () => {
    const { router, out } = harness({ ms: 0 })
    router.route({ scope: 'stream-debug', msg: 'sample', data: RAW_SAMPLE })
    expect(out.samples).toHaveLength(1)
    expect(out.samples[0]?.sessionId).toBe('s-1')
    expect(out.info).toEqual([])
    expect(out.debug).toEqual([])
  })

  /** The watchdog's `stall-recovery` shares the scope and is NOT a sample: it is
   *  a diagnostic, and dropping it silently is how a recovery goes unseen. */
  it('a non-sample on the same scope is logged, not swallowed', () => {
    const { router, out } = harness({ ms: 0 })
    router.route({ scope: 'stream-debug', msg: 'stall-recovery', data: { reason: 'x' } })
    expect(out.samples).toEqual([])
    expect(out.debug).toEqual(['embed:stream-debug stall-recovery'])
  })
})

describe('embed diagnostics', () => {
  it('an info scope ships at info, anything else at debug', () => {
    const { router, out } = harness({ ms: 0 })
    router.route({ scope: 'webrtc-timing', msg: 'connected' })
    router.route({ scope: 'clip:play', msg: 'held clip' })
    expect(out.info).toEqual(['embed:webrtc-timing connected'])
    expect(out.debug).toEqual(['embed:clip:play held clip'])
  })

  it('keeps at most one playback census per window', () => {
    const now = { ms: 100_000 }
    const { router, out } = harness(now)
    router.route({ scope: 'playback', msg: 'stats' })
    now.ms += 1000
    router.route({ scope: 'playback', msg: 'stats' })
    now.ms += PLAYBACK_CENSUS_MIN_INTERVAL_MS
    router.route({ scope: 'playback', msg: 'stats' })
    expect(out.info).toEqual(['embed:playback stats', 'embed:playback stats'])
  })

  it('the FIRST census ships even on a clock near zero', () => {
    const { router, out } = harness({ ms: 10 })
    router.route({ scope: 'playback', msg: 'stats' })
    expect(out.info).toHaveLength(1)
  })
})

describe('the stats read-out, from the player\'s own sample', () => {
  const sample = parseStreamDebugSample(RAW_SAMPLE)

  it('carries the peer\'s numbers as webrtc stats', () => {
    expect(streamStatsFromSample(sample, 10_500)).toEqual({
      source: 'webrtc',
      resolution: '1920x1080',
      fps: 25,
      bitrateKbps: 2049,
      packetsLost: 3,
      jitterMs: 4,
      codec: 'H264',
    })
  })

  it('is WAITING, not zeros, when nobody measured', () => {
    expect(streamStatsFromSample(null, 10_500)).toBeNull()
    const unmeasured = parseStreamDebugSample({ ...RAW_SAMPLE, stats: null })
    expect(streamStatsFromSample(unmeasured, 10_500)).toBeNull()
  })

  it('a stale sample no longer describes the picture', () => {
    expect(streamStatsFromSample(sample, 10_000 + STREAM_STATS_STALE_MS + 1)).toBeNull()
  })

  it('omits a field that was not measured instead of inventing it', () => {
    const partial = parseStreamDebugSample({
      ...RAW_SAMPLE,
      stats: { at: 9_990, width: 640, height: null, fps: null },
    })
    expect(streamStatsFromSample(partial, 10_500)).toEqual({ source: 'webrtc' })
  })
})

describe('both hosts route through it', () => {
  const SRC = join(process.cwd(), 'src')
  const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

  it.each(['live/LiveView.web.tsx', 'live/LiveViewWebView.tsx'])('%s', (file) => {
    const src = read(file)
    expect(src).toContain('new EmbedLogRouter(')
    expect(src).toContain('useStreamDebugStore.getState().report(deviceId,')
    expect(src).toContain('useStreamDebugStore.getState().clear(deviceId)')
  })

  /** The PWA's read-out: the web host's getStats used to be a constant null. */
  it('the web host answers getStats from the sample, not with null', () => {
    const src = read('live/LiveView.web.tsx')
    expect(src).not.toContain('getStats: () => Promise.resolve(null)')
    expect(src).toContain('streamStatsFromSample(')
  })
})
