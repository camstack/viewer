import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WebrtcLiveSession } from '../webrtc-live-session.js'
import type {
  PeerConnectionLike,
  IceServer,
  IceCandidateInit,
  SessionDescription,
  MediaStreamLike,
} from '../signaling-types.js'

class FakePeerConnection implements PeerConnectionLike {
  transceivers: string[] = []
  localDescription: SessionDescription | null = null
  remoteDescription: SessionDescription | null = null
  addedCandidates: IceCandidateInit[] = []
  closed = false
  onicecandidate: ((ev: { candidate: IceCandidateInit | null }) => void) | null = null
  ontrack: ((ev: { streams: readonly MediaStreamLike[] }) => void) | null = null

  addTransceiver(kind: 'audio' | 'video'): void {
    this.transceivers.push(kind)
  }
  async createOffer(): Promise<SessionDescription> {
    return { type: 'offer', sdp: `offer-sdp-${this.transceivers.join('+')}` }
  }
  async setLocalDescription(desc: SessionDescription): Promise<void> {
    this.localDescription = desc
  }
  async setRemoteDescription(desc: SessionDescription): Promise<void> {
    this.remoteDescription = desc
  }
  async addIceCandidate(c: IceCandidateInit): Promise<void> {
    this.addedCandidates.push(c)
  }
  close(): void {
    this.closed = true
  }
}

function makeClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getTurnServers: vi.fn(async (): Promise<readonly IceServer[]> => [{ urls: 'stun:stun.local' }]),
    handleOffer: vi.fn(async () => ({ sessionId: 'sess-1', sdpAnswer: 'answer-sdp' })),
    addIceCandidate: vi.fn(async () => {}),
    getIceCandidates: vi.fn(async () => ({ candidates: [], done: true })),
    getSessionState: vi.fn(async () => ({ pendingRenegotiation: null })),
    closeSession: vi.fn(async () => {}),
    reportClientStats: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('WebrtcLiveSession.connect', () => {
  let pc: FakePeerConnection
  let createPeerConnection: (s: readonly IceServer[]) => PeerConnectionLike
  beforeEach(() => {
    pc = new FakePeerConnection()
    createPeerConnection = vi.fn(() => pc)
  })

  it('runs the client-offer handshake and wires recvonly transceivers', async () => {
    const client = makeClient()
    const s = new WebrtcLiveSession({ deviceId: 7, target: { kind: 'adaptive' }, client, createPeerConnection })
    await s.connect()

    expect(client.getTurnServers).toHaveBeenCalledTimes(1)
    expect(createPeerConnection).toHaveBeenCalledWith([{ urls: 'stun:stun.local' }])
    expect(pc.transceivers).toEqual(['video', 'audio'])
    expect(pc.localDescription).toEqual({ type: 'offer', sdp: 'offer-sdp-video+audio' })
    expect(client.handleOffer).toHaveBeenCalledWith({
      deviceId: 7,
      target: { kind: 'adaptive' },
      sdpOffer: 'offer-sdp-video+audio',
    })
    expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'answer-sdp' })
    expect(s.id).toBe('sess-1')
  })

  it('captures the remote stream from ontrack', async () => {
    const client = makeClient()
    const s = new WebrtcLiveSession({ deviceId: 7, target: { kind: 'adaptive' }, client, createPeerConnection })
    await s.connect()
    pc.ontrack?.({ streams: [{ id: 'remote-stream' }] })
    expect(s.stream).toEqual({ id: 'remote-stream' })
  })

  it('forwards local ICE candidates to the signaling client (trickle)', async () => {
    const client = makeClient()
    const s = new WebrtcLiveSession({ deviceId: 7, target: { kind: 'adaptive' }, client, createPeerConnection })
    await s.connect()
    pc.onicecandidate?.({ candidate: { candidate: 'cand-1', sdpMid: '0', sdpMLineIndex: 0 } })
    await Promise.resolve()
    expect(client.addIceCandidate).toHaveBeenCalledWith({
      deviceId: 7,
      sessionId: 'sess-1',
      candidate: 'cand-1',
      sdpMid: '0',
      sdpMLineIndex: 0,
    })
  })

  it('ignores a null end-of-candidates event', async () => {
    const client = makeClient()
    const s = new WebrtcLiveSession({ deviceId: 7, target: { kind: 'adaptive' }, client, createPeerConnection })
    await s.connect()
    pc.onicecandidate?.({ candidate: null })
    await Promise.resolve()
    expect(client.addIceCandidate).not.toHaveBeenCalled()
  })

  it('buffers local candidates gathered before the answer and flushes them once the session id is known', async () => {
    // Deferred `handleOffer` so we can simulate ICE candidates gathering while
    // the answer is still in flight (the live-black race). The candidate handler
    // is registered before createOffer, so firing it now exercises the buffer.
    let resolveOffer: (v: { sessionId: string; sdpAnswer: string }) => void = () => {}
    const offerPromise = new Promise<{ sessionId: string; sdpAnswer: string }>((res) => {
      resolveOffer = res
    })
    const client = makeClient({ handleOffer: vi.fn(() => offerPromise) })
    const s = new WebrtcLiveSession({ deviceId: 7, target: { kind: 'adaptive' }, client, createPeerConnection })

    const connectPromise = s.connect()
    // Let connect() reach the awaited handleOffer (offer created, handler set).
    await Promise.resolve()
    await Promise.resolve()

    // Candidates gather BEFORE the answer arrives — sessionId is still null.
    pc.onicecandidate?.({ candidate: { candidate: 'early-1', sdpMid: '0', sdpMLineIndex: 0 } })
    pc.onicecandidate?.({ candidate: { candidate: 'early-2', sdpMid: '0', sdpMLineIndex: 0 } })
    expect(client.addIceCandidate).not.toHaveBeenCalled() // buffered, not sent yet

    // Answer arrives → sessionId set → buffer flushed.
    resolveOffer({ sessionId: 'sess-1', sdpAnswer: 'answer-sdp' })
    await connectPromise

    expect(client.addIceCandidate).toHaveBeenCalledTimes(2)
    expect(client.addIceCandidate).toHaveBeenNthCalledWith(1, {
      deviceId: 7,
      sessionId: 'sess-1',
      candidate: 'early-1',
      sdpMid: '0',
      sdpMLineIndex: 0,
    })
    expect(client.addIceCandidate).toHaveBeenNthCalledWith(2, {
      deviceId: 7,
      sessionId: 'sess-1',
      candidate: 'early-2',
      sdpMid: '0',
      sdpMLineIndex: 0,
    })

    // And a candidate gathered AFTER the handshake is forwarded immediately.
    pc.onicecandidate?.({ candidate: { candidate: 'late-1', sdpMid: '0', sdpMLineIndex: 0 } })
    await Promise.resolve()
    expect(client.addIceCandidate).toHaveBeenCalledTimes(3)
    expect(client.addIceCandidate).toHaveBeenLastCalledWith({
      deviceId: 7,
      sessionId: 'sess-1',
      candidate: 'late-1',
      sdpMid: '0',
      sdpMLineIndex: 0,
    })
  })
})

describe('WebrtcLiveSession.pollRemoteIce', () => {
  it('adds each remote candidate to the peer and returns done', async () => {
    const pc = new FakePeerConnection()
    const client = makeClient({
      getIceCandidates: vi.fn(async () => ({
        candidates: [
          { candidate: 'r1', sdpMid: '0', sdpMLineIndex: 0 },
          { candidate: 'r2', sdpMid: '0', sdpMLineIndex: 0 },
        ],
        done: true,
      })),
    })
    const s = new WebrtcLiveSession({ deviceId: 7, target: { kind: 'adaptive' }, client, createPeerConnection: () => pc })
    await s.connect()
    const done = await s.pollRemoteIce()
    expect(done).toBe(true)
    expect(pc.addedCandidates).toEqual([
      { candidate: 'r1', sdpMid: '0', sdpMLineIndex: 0 },
      { candidate: 'r2', sdpMid: '0', sdpMLineIndex: 0 },
    ])
    expect(client.getIceCandidates).toHaveBeenCalledWith({ deviceId: 7, sessionId: 'sess-1' })
  })
})

describe('WebrtcLiveSession.checkRenegotiation', () => {
  it('re-offers on the same session when a renegotiation is pending', async () => {
    const pc = new FakePeerConnection()
    const client = makeClient({
      getSessionState: vi.fn(async () => ({
        pendingRenegotiation: { target: { kind: 'profile', profile: 'low' }, epoch: 2 },
      })),
      handleOffer: vi
        .fn()
        .mockResolvedValueOnce({ sessionId: 'sess-1', sdpAnswer: 'answer-1' })
        .mockResolvedValueOnce({ sessionId: 'sess-1', sdpAnswer: 'answer-2' }),
    })
    const s = new WebrtcLiveSession({ deviceId: 7, target: { kind: 'adaptive' }, client, createPeerConnection: () => pc })
    await s.connect()
    const renegotiated = await s.checkRenegotiation()
    expect(renegotiated).toBe(true)
    expect(client.handleOffer).toHaveBeenLastCalledWith({
      deviceId: 7,
      target: { kind: 'profile', profile: 'low' },
      sdpOffer: 'offer-sdp-video+audio',
      sessionId: 'sess-1',
    })
    expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'answer-2' })
  })

  it('does nothing and returns false when no renegotiation is pending', async () => {
    const pc = new FakePeerConnection()
    const client = makeClient()
    const s = new WebrtcLiveSession({ deviceId: 7, target: { kind: 'adaptive' }, client, createPeerConnection: () => pc })
    await s.connect()
    expect(await s.checkRenegotiation()).toBe(false)
  })
})

describe('WebrtcLiveSession.close', () => {
  it('closes the signaling session and the peer, and clears state', async () => {
    const pc = new FakePeerConnection()
    const client = makeClient()
    const s = new WebrtcLiveSession({ deviceId: 7, target: { kind: 'adaptive' }, client, createPeerConnection: () => pc })
    await s.connect()
    await s.close()
    expect(client.closeSession).toHaveBeenCalledWith({ deviceId: 7, sessionId: 'sess-1' })
    expect(pc.closed).toBe(true)
    expect(s.id).toBeNull()
    expect(s.stream).toBeNull()
  })

  it('still closes the peer when closeSession rejects (best-effort)', async () => {
    const pc = new FakePeerConnection()
    const client = makeClient({ closeSession: vi.fn(async () => { throw new Error('network') }) })
    const s = new WebrtcLiveSession({ deviceId: 7, target: { kind: 'adaptive' }, client, createPeerConnection: () => pc })
    await s.connect()
    await s.close()
    expect(pc.closed).toBe(true)
    expect(s.id).toBeNull()
  })
})

// ── Client hints + network-condition reporter (adaptive ladder feed) ─────────

/** Fake PC with a getStats() yielding a scripted sequence of inbound windows. */
class StatsPeerConnection extends FakePeerConnection {
  private call = 0
  constructor(private readonly windows: readonly Record<string, unknown>[][]) {
    super()
  }
  async getStats(): Promise<unknown> {
    const rows = this.windows[Math.min(this.call, this.windows.length - 1)] ?? []
    this.call += 1
    return {
      forEach: (cb: (v: unknown) => void) => {
        for (const row of rows) cb(row)
      },
    }
  }
}

function inboundRow(over: Record<string, unknown>): Record<string, unknown> {
  return { type: 'inbound-rtp', kind: 'video', packetsLost: 0, packetsReceived: 0, bytesReceived: 0, timestamp: 0, jitter: 0, ...over }
}

describe('WebrtcLiveSession — client hints', () => {
  it('forwards config.hints on the initial offer AND on renegotiation', async () => {
    const pc = new FakePeerConnection()
    const client = makeClient({
      getSessionState: vi.fn(async () => ({
        pendingRenegotiation: { target: { kind: 'profile', profile: 'low' }, epoch: 2 },
      })),
    })
    const hints = { viewportWidth: 1170, viewportHeight: 660, devicePixelRatio: 3 }
    const s = new WebrtcLiveSession({
      deviceId: 7, target: { kind: 'adaptive' }, client, createPeerConnection: () => pc, hints,
    })
    await s.connect()
    expect(client.handleOffer).toHaveBeenCalledWith(expect.objectContaining({ hints }))
    await s.checkRenegotiation()
    expect(client.handleOffer).toHaveBeenLastCalledWith(expect.objectContaining({ hints }))
  })

  it('omits the hints key entirely when not configured', async () => {
    const client = makeClient()
    const pc = new FakePeerConnection()
    const s = new WebrtcLiveSession({ deviceId: 7, target: { kind: 'adaptive' }, client, createPeerConnection: () => pc })
    await s.connect()
    const arg = (client.handleOffer as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Record<string, unknown>
    expect('hints' in arg).toBe(false)
  })
})

describe('WebrtcLiveSession — network-condition reporter', () => {
  it('samples every interval and reports the window-delta to the client (adaptive)', async () => {
    vi.useFakeTimers()
    try {
      const pc = new StatsPeerConnection([
        [inboundRow({ packetsLost: 0, packetsReceived: 100, bytesReceived: 0, timestamp: 0 })],
        [
          inboundRow({ packetsLost: 10, packetsReceived: 190, bytesReceived: 1_250_000, timestamp: 5_000, jitter: 0.02 }),
          { type: 'candidate-pair', nominated: true, currentRoundTripTime: 0.05 },
        ],
      ])
      const client = makeClient()
      const s = new WebrtcLiveSession({
        deviceId: 7, target: { kind: 'adaptive' }, client, createPeerConnection: () => pc, reportNetworkMs: 5_000,
      })
      await s.connect()

      // First tick seeds the window — nothing reported yet.
      await vi.advanceTimersByTimeAsync(5_000)
      expect(client.reportClientStats).not.toHaveBeenCalled()

      // Second tick derives the delta: Δlost 10, Δrecv 90 → 10%; 1.25MB/5s → 2000 kbps.
      await vi.advanceTimersByTimeAsync(5_000)
      expect(client.reportClientStats).toHaveBeenCalledWith({
        deviceId: 7,
        rttMs: 50,
        jitterMs: 20,
        estimatedBandwidthKbps: 2000,
        packetLossPercent: 10,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('never starts for a pinned (non-adaptive) target', async () => {
    vi.useFakeTimers()
    try {
      const pc = new StatsPeerConnection([[inboundRow({ timestamp: 0 })]])
      const client = makeClient()
      const s = new WebrtcLiveSession({
        deviceId: 7, target: { kind: 'profile', profile: 'high' }, client, createPeerConnection: () => pc, reportNetworkMs: 5_000,
      })
      await s.connect()
      await vi.advanceTimersByTimeAsync(20_000)
      expect(client.reportClientStats).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('survives a rejected report mutation (best-effort) and keeps sampling', async () => {
    vi.useFakeTimers()
    try {
      const pc = new StatsPeerConnection([
        [inboundRow({ packetsReceived: 10, timestamp: 0 })],
        [inboundRow({ packetsReceived: 20, timestamp: 5_000 })],
        [inboundRow({ packetsReceived: 30, timestamp: 10_000 })],
      ])
      const client = makeClient({
        reportClientStats: vi.fn(async () => {
          throw new Error('offline')
        }),
      })
      const s = new WebrtcLiveSession({
        deviceId: 7, target: { kind: 'adaptive' }, client, createPeerConnection: () => pc, reportNetworkMs: 5_000,
      })
      await s.connect()
      await vi.advanceTimersByTimeAsync(15_000)
      // Two delta windows attempted, both rejected — and nothing threw.
      expect(client.reportClientStats).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops reporting after close() (teardown clears the timer)', async () => {
    vi.useFakeTimers()
    try {
      const pc = new StatsPeerConnection([
        [inboundRow({ packetsReceived: 10, timestamp: 0 })],
        [inboundRow({ packetsReceived: 20, timestamp: 5_000 })],
      ])
      const client = makeClient()
      const s = new WebrtcLiveSession({
        deviceId: 7, target: { kind: 'adaptive' }, client, createPeerConnection: () => pc, reportNetworkMs: 5_000,
      })
      await s.connect()
      await s.close()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(client.reportClientStats).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
