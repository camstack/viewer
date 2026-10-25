import type {
  WebrtcLiveConfig,
  PeerConnectionLike,
  MediaStreamLike,
  IceCandidateInit,
  ClientNetworkSample,
} from './signaling-types.js'
import type { StreamStats } from './live-view-types.js'

/** Previous inbound sample, kept to derive receive bitrate across getStats calls. */
interface BitrateSample {
  readonly bytes: number
  readonly tsMs: number
}

// ── Client network-condition sampling (drives the server ADAPTIVE ladder) ─────
// Port of the ui-library reference (`camera-stream-player.tsx`, 80b3e7e0):
// per-window deltas over inbound-video getStats() — packet-loss % =
// Δlost / (Δlost + Δreceived) — reported to `networkQuality.reportClientStats`
// so the broker's adaptive controller finally sees a real client loss signal.

/** One inbound-video stats window (cumulative counters + instantaneous vals). */
export interface InboundWindow {
  readonly lost: number
  readonly recv: number
  readonly bytes: number
  readonly tsMs: number
  readonly jitterMs: number
  readonly rttMs: number
}

/** Schema bounds of `networkQuality.reportClientStats` — clamp before send. */
const MAX_RTT_MS = 60_000
const MAX_JITTER_MS = 10_000
const MAX_BANDWIDTH_KBPS = 1_000_000

function clamp(v: number, max: number): number {
  return Math.min(max, Math.max(0, v))
}

/**
 * Derive one {@link ClientNetworkSample} from two consecutive stats windows.
 * Null on the first window or when the report timestamp did not advance (no
 * fresh data). Deltas are floored at 0 (counter resets) and every field is
 * clamped to the mutation's schema bounds. Pure — unit-tested in isolation.
 */
export function computeNetworkSample(
  prev: InboundWindow | null,
  cur: InboundWindow,
): ClientNetworkSample | null {
  if (!prev || cur.tsMs <= prev.tsMs) return null
  const dLost = Math.max(0, cur.lost - prev.lost)
  const dRecv = Math.max(0, cur.recv - prev.recv)
  const denom = dLost + dRecv
  const packetLossPercent = denom > 0 ? clamp((dLost / denom) * 100, 100) : 0
  const dBytes = Math.max(0, cur.bytes - prev.bytes)
  // bytes*8 = bits; / elapsed ms = kbits/s = kbps.
  const estimatedBandwidthKbps = clamp(Math.round((dBytes * 8) / (cur.tsMs - prev.tsMs)), MAX_BANDWIDTH_KBPS)
  return {
    rttMs: clamp(Math.round(cur.rttMs), MAX_RTT_MS),
    jitterMs: clamp(Math.round(cur.jitterMs), MAX_JITTER_MS),
    estimatedBandwidthKbps,
    packetLossPercent,
  }
}

/** Drives the camstack `webrtcSession` client-offer flow to receive a recvonly
 *  live stream. Transport-agnostic: all WebRTC + signaling are injected. The
 *  ICE/renegotiation polling methods are driven by the caller — the ONLY
 *  session-owned timer is the optional network-condition reporter
 *  (`reportNetworkMs`), started on connect and cleared in `close()`. */
export class WebrtcLiveSession {
  private pc: PeerConnectionLike | null = null
  private sessionId: string | null = null
  private remoteStream: MediaStreamLike | null = null
  /** Periodic client network-condition reporter (adaptive sessions). */
  private reportTimer: ReturnType<typeof setInterval> | null = null
  /** Previous inbound window for the reporter's delta derivation. */
  private netWindow: InboundWindow | null = null
  /** Local ICE candidates gathered BEFORE the answer (`sessionId`) arrives.
   *  setLocalDescription kicks off ICE gathering immediately, so on a fast link
   *  the first host/srflx candidates fire before `handleOffer` resolves. They
   *  must be buffered and flushed once the session id is known — otherwise the
   *  server never receives the client's candidates, ICE never pairs, and the
   *  remote video stays black. This was the live-black root cause. */
  private pendingLocalCandidates: IceCandidateInit[] = []
  /** Last inbound-rtp sample for bitrate derivation (getStats is delta-based). */
  private lastBitrateSample: BitrateSample | null = null

  constructor(private readonly config: WebrtcLiveConfig) {}

  get id(): string | null {
    return this.sessionId
  }

  get stream(): MediaStreamLike | null {
    return this.remoteStream
  }

  /** Push one gathered local candidate to the server. */
  private sendLocalCandidate(candidate: IceCandidateInit): void {
    const sid = this.sessionId
    if (!sid) return
    void this.config.client
      .addIceCandidate({
        deviceId: this.config.deviceId,
        sessionId: sid,
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
      })
      .catch(() => {
        // Best-effort trickle — a dropped candidate just means one fewer pair;
        // remaining candidates (and the poll loop) still converge.
      })
  }

  async connect(): Promise<void> {
    const { deviceId, target, client, createPeerConnection } = this.config
    const iceServers = await client.getTurnServers()
    const pc = createPeerConnection(iceServers)
    this.pc = pc

    pc.ontrack = (ev) => {
      if (ev.streams[0]) this.remoteStream = ev.streams[0]
    }

    // Surface ICE-connection-state transitions so the caller can self-heal
    // (reconnect on failed/disconnected). Optional on the peer seam.
    const onConnState = this.config.onConnectionStateChange
    if (onConnState && 'oniceconnectionstatechange' in pc) {
      pc.oniceconnectionstatechange = (state) => onConnState(state)
    }

    // CRITICAL ORDERING: register the candidate handler BEFORE createOffer /
    // setLocalDescription so no gathered candidate is missed. While `sessionId`
    // is still null (handshake in flight) we BUFFER; after `handleOffer` returns
    // we flush the buffer and forward subsequent candidates live.
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return // null = gathering complete
      if (this.sessionId) {
        this.sendLocalCandidate(ev.candidate)
      } else {
        this.pendingLocalCandidates.push(ev.candidate)
      }
    }

    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    const { sessionId, sdpAnswer } = await client.handleOffer({
      deviceId,
      target,
      sdpOffer: offer.sdp,
      // Viewport/downlink hints for the server's adaptive source selection
      // (server-side gap note: see sdk-signaling-client.handleOffer).
      ...(this.config.hints !== undefined ? { hints: this.config.hints } : {}),
    })
    this.sessionId = sessionId

    // Apply the answer first, then flush buffered candidates: a remote
    // description must exist before the peer can act on local ICE, and the
    // server now has a session id to receive them against.
    await pc.setRemoteDescription({ type: 'answer', sdp: sdpAnswer })

    const buffered = this.pendingLocalCandidates
    this.pendingLocalCandidates = []
    for (const c of buffered) this.sendLocalCandidate(c)

    this.startNetworkReporter()
  }

  /**
   * Start the periodic client network-condition reporter (see 80b3e7e0): every
   * `reportNetworkMs` the inbound-video getStats() window is sampled and the
   * delta-derived conditions are pushed to `networkQuality.reportClientStats`.
   * Gated to ADAPTIVE sessions (a pinned profile/cam-stream ignores the ladder)
   * and BEST-EFFORT throughout: a failed sample or a rejected mutation skips
   * the window and never disturbs playback.
   */
  private startNetworkReporter(): void {
    const intervalMs = this.config.reportNetworkMs
    if (intervalMs === undefined || intervalMs <= 0) return
    if (this.config.target.kind !== 'adaptive') return
    if (this.reportTimer !== null) return
    this.netWindow = null
    this.reportTimer = setInterval(() => {
      void this.reportNetworkTick()
    }, intervalMs)
  }

  /** One reporter tick: sample → delta → report. Never throws. */
  private async reportNetworkTick(): Promise<void> {
    try {
      const cur = await this.readInboundWindow()
      if (!cur) return
      const sample = computeNetworkSample(this.netWindow, cur)
      this.netWindow = cur
      if (!sample) return
      await this.config.client.reportClientStats({ deviceId: this.config.deviceId, ...sample })
    } catch {
      // Best-effort: a transient getStats/mutation failure skips this window.
    }
  }

  /** Read the current inbound-video counters (+ nominated-pair RTT) from the
   *  peer's stats report. Null when the peer/stats are unavailable. */
  private async readInboundWindow(): Promise<InboundWindow | null> {
    const rows = await this.statsRows()
    if (!rows) return null
    const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
    const inbound = rows.find(
      (s) => s.type === 'inbound-rtp' && (s.kind ?? s.mediaType) === 'video',
    )
    if (!inbound) return null
    const pair = rows.find(
      (s) => s.type === 'candidate-pair' && s.nominated === true && typeof s.currentRoundTripTime === 'number',
    )
    const jitterS = num(inbound.jitter) ?? 0
    const rttS = num(pair?.currentRoundTripTime) ?? 0
    return {
      lost: num(inbound.packetsLost) ?? 0,
      recv: num(inbound.packetsReceived) ?? 0,
      bytes: num(inbound.bytesReceived) ?? 0,
      tsMs: num(inbound.timestamp) ?? Date.now(),
      jitterMs: jitterS * 1000,
      rttMs: rttS * 1000,
    }
  }

  /** Collect the peer's stats report rows as plain records. Null when the peer
   *  seam has no getStats (minimal fakes) or the call fails. */
  private async statsRows(): Promise<Record<string, unknown>[] | null> {
    const pc = this.pc
    if (!pc || typeof pc.getStats !== 'function') return null
    let report: unknown
    try {
      report = await pc.getStats()
    } catch {
      return null
    }
    const rows: Record<string, unknown>[] = []
    if (report && typeof (report as { forEach?: unknown }).forEach === 'function') {
      ;(report as { forEach: (cb: (v: unknown) => void) => void }).forEach((v) => {
        if (v && typeof v === 'object') rows.push(v as Record<string, unknown>)
      })
    }
    return rows
  }

  /** Pull buffered remote ICE candidates and add them to the peer. Returns the
   *  server's `done` flag (caller stops polling once true). No-op before connect. */
  async pollRemoteIce(): Promise<boolean> {
    const pc = this.pc
    const sid = this.sessionId
    if (!pc || !sid) return true
    const { candidates, done } = await this.config.client.getIceCandidates({
      deviceId: this.config.deviceId,
      sessionId: sid,
    })
    for (const c of candidates) await pc.addIceCandidate(c)
    return done
  }

  /** If the broker asked for an adaptive renegotiation, re-offer on the same
   *  session with the new target. Returns whether a renegotiation happened. */
  async checkRenegotiation(): Promise<boolean> {
    const pc = this.pc
    const sid = this.sessionId
    if (!pc || !sid) return false
    const { pendingRenegotiation } = await this.config.client.getSessionState({
      deviceId: this.config.deviceId,
      sessionId: sid,
    })
    if (!pendingRenegotiation) return false
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    const { sdpAnswer } = await this.config.client.handleOffer({
      deviceId: this.config.deviceId,
      target: pendingRenegotiation.target,
      sdpOffer: offer.sdp,
      sessionId: sid,
      ...(this.config.hints !== undefined ? { hints: this.config.hints } : {}),
    })
    await pc.setRemoteDescription({ type: 'answer', sdp: sdpAnswer })
    return true
  }

  /** Sample inbound video stats from the peer for the on-screen overlay. Returns
   *  null before connect. Bitrate is derived from the delta vs the previous call. */
  async getStats(): Promise<StreamStats | null> {
    const rows = await this.statsRows()
    if (!rows) return null
    const inbound = rows.find((s) => s.type === 'inbound-rtp' && s.kind === 'video')
    if (!inbound) return { source: 'webrtc' }
    const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

    const bytes = num(inbound.bytesReceived)
    const nowMs = Date.now()
    let bitrateKbps: number | undefined
    if (bytes !== undefined) {
      const prev = this.lastBitrateSample
      if (prev && nowMs > prev.tsMs) {
        // bytes*8 = bits; / elapsed ms = kbits/s = kbps.
        bitrateKbps = Math.max(0, Math.round(((bytes - prev.bytes) * 8) / (nowMs - prev.tsMs)))
      }
      this.lastBitrateSample = { bytes, tsMs: nowMs }
    }

    const w = num(inbound.frameWidth)
    const h = num(inbound.frameHeight)
    const jitterS = num(inbound.jitter)
    let codec: string | undefined
    if (typeof inbound.codecId === 'string') {
      const c = rows.find((s) => s.type === 'codec' && s.id === inbound.codecId)
      const mime = c?.mimeType
      if (typeof mime === 'string') codec = mime.split('/')[1]?.toUpperCase()
    }
    return {
      source: 'webrtc',
      resolution: w && h ? `${w}x${h}` : undefined,
      fps: num(inbound.framesPerSecond),
      bitrateKbps,
      packetsLost: num(inbound.packetsLost),
      jitterMs: jitterS !== undefined ? Math.round(jitterS * 1000) : undefined,
      codec,
    }
  }

  /** Best-effort teardown: stop the network reporter, close the signaling
   *  session (ignore failures), close the peer, and clear state. */
  async close(): Promise<void> {
    if (this.reportTimer !== null) {
      clearInterval(this.reportTimer)
      this.reportTimer = null
    }
    this.netWindow = null
    const sid = this.sessionId
    if (sid) {
      try {
        await this.config.client.closeSession({ deviceId: this.config.deviceId, sessionId: sid })
      } catch {
        // best-effort — tear the peer down regardless
      }
    }
    this.pc?.close()
    this.pc = null
    this.sessionId = null
    this.remoteStream = null
    this.pendingLocalCandidates = []
    this.lastBitrateSample = null
  }
}
