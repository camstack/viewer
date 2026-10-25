/** ICE server descriptor (shape of `turnProvider.getTurnServers` elements). */
export interface IceServer {
  readonly urls: string | readonly string[]
  readonly username?: string
  readonly credential?: string
}

/** Which stream the broker should send. Mirrors the server `WebrtcTarget`. */
export interface WebrtcTarget {
  readonly kind: 'adaptive' | 'profile' | 'cam-stream'
  readonly profile?: string
}

/** Client hints sent at session creation so the server's ADAPTIVE selection can
 *  pick a fitting source tier. Mirrors the server `webrtcClientHintsSchema`
 *  (`viewportWidth`/`viewportHeight`/`devicePixelRatio`/`downlinkMbps`; the
 *  `prefersTier` override is intentionally not surfaced here — the viewer picks
 *  tiers via the `target` union instead). All fields optional. */
export interface ClientStreamHints {
  readonly viewportWidth?: number
  readonly viewportHeight?: number
  readonly devicePixelRatio?: number
  readonly downlinkMbps?: number
}

/** Client-observed network conditions, sampled from the live PeerConnection.
 *  Matches the `networkQuality.reportClientStats` mutation input (minus
 *  `deviceId`, which the reporter adds). Mirrors the ui-library reference
 *  (`camera-stream-player.tsx` — commit 80b3e7e0). */
export interface ClientNetworkSample {
  readonly rttMs: number
  readonly jitterMs: number
  readonly estimatedBandwidthKbps: number
  readonly packetLossPercent: number
}

export interface IceCandidateInit {
  readonly candidate: string
  readonly sdpMid?: string | null
  readonly sdpMLineIndex?: number | null
}

export interface SessionDescription {
  readonly type: string
  readonly sdp: string
}

export interface MediaStreamLike {
  readonly id: string
}

/** The subset of the camstack `webrtcSession` + `turnProvider` caps the
 *  orchestrator calls. Implemented in the app by an adapter over the SDK. */
export interface SignalingClient {
  getTurnServers(): Promise<readonly IceServer[]>
  handleOffer(input: {
    deviceId: number
    target: WebrtcTarget
    sdpOffer: string
    sessionId?: string
    /** Viewport/downlink hints for the server's adaptive source selection. */
    hints?: ClientStreamHints
  }): Promise<{ sessionId: string; sdpAnswer: string }>
  /** Report the client's live network conditions (drives the server ADAPTIVE
   *  ladder). Best-effort at the call site — the session catches failures. */
  reportClientStats(input: ClientNetworkSample & { deviceId: number }): Promise<void>
  addIceCandidate(input: {
    deviceId: number
    sessionId: string
    candidate: string
    sdpMid?: string | null
    sdpMLineIndex?: number | null
  }): Promise<void>
  getIceCandidates(input: {
    deviceId: number
    sessionId: string
  }): Promise<{ candidates: readonly IceCandidateInit[]; done: boolean }>
  getSessionState(input: {
    deviceId: number
    sessionId: string
  }): Promise<{ pendingRenegotiation: { target: WebrtcTarget; epoch: number } | null }>
  closeSession(input: { deviceId: number; sessionId: string }): Promise<void>
}

/** ICE connection lifecycle states the orchestrator surfaces for diagnostics.
 *  Mirrors the standard `RTCIceConnectionState` values. */
export type IceConnectionState =
  | 'new'
  | 'checking'
  | 'connected'
  | 'completed'
  | 'disconnected'
  | 'failed'
  | 'closed'

/** Structural subset of RTCPeerConnection used by the orchestrator — satisfied
 *  by `react-native-webrtc` (native) and the browser PC (web). */
export interface PeerConnectionLike {
  addTransceiver(kind: 'audio' | 'video', init: { direction: 'recvonly' }): void
  createOffer(): Promise<SessionDescription>
  setLocalDescription(desc: SessionDescription): Promise<void>
  setRemoteDescription(desc: SessionDescription): Promise<void>
  addIceCandidate(candidate: IceCandidateInit): Promise<void>
  close(): void
  /** WebRTC stats report (react-native-webrtc + browser both expose it).
   *  Optional on the seam so a minimal fake need not implement it; the
   *  stats overlay + the network-condition reporter degrade to no-ops. */
  getStats?(): Promise<unknown>
  onicecandidate: ((ev: { candidate: IceCandidateInit | null }) => void) | null
  ontrack: ((ev: { streams: readonly MediaStreamLike[] }) => void) | null
  /** Fires on every ICE connection-state transition. Optional on the seam so a
   *  minimal fake (and the browser PC) need not implement it; the orchestrator
   *  only reads it for diagnostics. */
  oniceconnectionstatechange?: ((state: IceConnectionState) => void) | null
}

export interface WebrtcLiveConfig {
  readonly deviceId: number
  readonly target: WebrtcTarget
  readonly client: SignalingClient
  readonly createPeerConnection: (iceServers: readonly IceServer[]) => PeerConnectionLike
  /** Optional: notified on every peer ICE-connection-state transition. Lets the
   *  caller drive self-healing (reconnect on `failed`/`disconnected`). */
  readonly onConnectionStateChange?: (state: IceConnectionState) => void
  /** Viewport/downlink hints forwarded with every offer (adaptive selection).
   *  Build via `buildClientHints` from the tile's layout size + PixelRatio. */
  readonly hints?: ClientStreamHints
  /** Enable the periodic client network-condition reporter (adaptive sessions).
   *  Interval in ms; omit to disable. The session owns the timer: started on a
   *  successful `connect()`, cleared in `close()`. */
  readonly reportNetworkMs?: number
}
