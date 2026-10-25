/**
 * The embed's `{type:'log'}` messages, routed ONCE for both hosts.
 *
 * The player page reports two different things on the same message type:
 *
 *  - `scope: 'stream-debug'` — the 1 Hz STATE sample `CameraStreamPlayer`
 *    measures (bitrate, loss, codec, the hub's served tier). It feeds the
 *    camera's status card (`useStreamDebugStore`) and the stats read-out, and
 *    is never shipped as a log line: one a second would be 86 400 lines a day.
 *  - every other scope — embed diagnostics, forwarded to the app logger (and
 *    from there to the hub's clientlog) at the level `embedLogLevel` owns.
 *
 * This used to live inline in the native host (`LiveViewWebView.tsx`) only.
 * The web host (`LiveView.web.tsx`) received the very same messages over
 * `postMessage` and dropped every one of them, so on the PWA the status card
 * said "No measurement yet" for ever, the stats read-out stayed empty, and no
 * embed diagnostic from a browser ever reached the hub. One router, called by
 * both, is what keeps the two platforms from drifting apart again.
 */
import type { StreamStats } from './live-view-types.js'
import { embedLogLevel } from './embed-log-level.js'
import { parseStreamDebugSample, type StreamDebugSample } from './stream-debug-sample.js'

/** An embed log message, as both hosts' validators already narrow it. */
export interface EmbedLogMessage {
  readonly scope: string
  readonly msg: string
  readonly data?: unknown
}

/** The effects a routed message reaches, as the host supplies them. */
export interface EmbedLogPorts {
  /** A parsed stream-debug sample for this player's camera. */
  readonly reportSample: (sample: StreamDebugSample) => void
  readonly info: (scope: string, msg: string, data: unknown) => void
  readonly debug: (scope: string, msg: string, data: unknown) => void
  readonly nowMs: () => number
}

/** At most one recorded-playback census per this window on the hub pipe — a
 *  stale embed may still emit one a second. */
export const PLAYBACK_CENSUS_MIN_INTERVAL_MS = 5000

/** The scope the 1 Hz sample travels on. */
export const STREAM_DEBUG_SCOPE = 'stream-debug'

/**
 * One router per mounted player: the census throttle is per player, exactly as
 * it was when it was a ref inside the native host.
 */
export class EmbedLogRouter {
  private lastPlaybackCensusAt = Number.NEGATIVE_INFINITY

  constructor(private readonly ports: EmbedLogPorts) {}

  route(rec: EmbedLogMessage): void {
    if (rec.scope === STREAM_DEBUG_SCOPE) {
      // Parsed, not cast: it crossed a frame boundary as JSON, and the card's
      // whole job is telling "nobody measured" from "measured nothing". A
      // message on this scope that is not a sample (the watchdog's
      // `stall-recovery`) is a diagnostic and falls through to the logger.
      const sample = parseStreamDebugSample(rec.data)
      if (sample !== null) {
        this.ports.reportSample(sample)
        return
      }
    }
    if (embedLogLevel(rec.scope) === 'info') {
      if (rec.scope === 'playback' && rec.msg === 'stats') {
        const now = this.ports.nowMs()
        if (now - this.lastPlaybackCensusAt < PLAYBACK_CENSUS_MIN_INTERVAL_MS) return
        this.lastPlaybackCensusAt = now
      }
      this.ports.info(`embed:${rec.scope}`, rec.msg, rec.data)
      return
    }
    this.ports.debug(`embed:${rec.scope}`, rec.msg, rec.data)
  }
}

/** A sample older than this no longer describes the picture on screen. */
export const STREAM_STATS_STALE_MS = 5000

/**
 * The stats read-out's numbers, from the player's own last sample.
 *
 * These come from the embed's `RTCPeerConnection` (the sample's client half),
 * so the source is `webrtc` and the read-out gets the full set — not the
 * `playback` fallback the native host's injected `<video>` probe can offer.
 * `null` — "waiting" — when there is no sample, when it is stale, or when the
 * sample carries no client measurement at all; never a row of zeros.
 */
export function streamStatsFromSample(
  sample: StreamDebugSample | null,
  nowMs: number,
): StreamStats | null {
  if (sample === null || sample.stats === null) return null
  if (nowMs - sample.at > STREAM_STATS_STALE_MS) return null
  const s = sample.stats
  const kbps = s.window?.kbps ?? null
  return {
    source: 'webrtc',
    ...(s.width !== null && s.height !== null ? { resolution: `${s.width}x${s.height}` } : {}),
    ...(s.fps !== null ? { fps: Math.round(s.fps) } : {}),
    ...(kbps !== null ? { bitrateKbps: Math.round(kbps) } : {}),
    ...(s.packetsLost !== null ? { packetsLost: s.packetsLost } : {}),
    ...(s.jitterMs !== null ? { jitterMs: Math.round(s.jitterMs) } : {}),
    ...(s.codec !== null ? { codec: s.codec } : {}),
  }
}
