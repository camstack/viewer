/**
 * rn-peer-connection — react-native-webrtc factory satisfying the orchestrator's
 * `PeerConnectionLike` seam.
 *
 * Wraps a native `RTCPeerConnection` and bridges its `icecandidate` / `track`
 * events onto the orchestrator's `onicecandidate` / `ontrack` callback props.
 * The native module's globals are registered once at module load.
 */
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  MediaStream,
  type MediaStreamTrack,
  registerGlobals,
} from 'react-native-webrtc'
import type {
  PeerConnectionLike,
  IceServer,
  IceCandidateInit,
  SessionDescription,
  MediaStreamLike,
  IceConnectionState,
} from './signaling-types.js'

// Install WebRTC globals (RTCPeerConnection, navigator.mediaDevices, …) once.
registerGlobals()

/**
 * Narrow view of the native pc's `addEventListener` for the two events we
 * consume. react-native-webrtc's `RTCPeerConnection` extends an
 * `event-target-shim` `EventTarget` whose typed event map doesn't surface
 * `addEventListener` cleanly to consumers; this structural interface documents
 * the exact runtime surface (and event payload shapes) we rely on, keeping the
 * handlers fully typed instead of falling back to `any`.
 */
interface PcEventTarget {
  addEventListener(
    type: 'icecandidate',
    listener: (event: { candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } | null }) => void,
  ): void
  addEventListener(
    type: 'track',
    listener: (event: { track: MediaStreamTrack | null; streams: readonly MediaStreamLike[] }) => void,
  ): void
  addEventListener(type: 'iceconnectionstatechange', listener: () => void): void
  readonly iceConnectionState: string
}

const ICE_STATES: readonly IceConnectionState[] = [
  'new',
  'checking',
  'connected',
  'completed',
  'disconnected',
  'failed',
  'closed',
]

/** Narrow the native `iceConnectionState` string onto the seam union. Unknown
 *  values (shouldn't occur) fall back to 'new'. */
function toIceConnectionState(value: string): IceConnectionState {
  return ICE_STATES.find((s) => s === value) ?? 'new'
}

/** Map the orchestrator's `IceServer[]` to react-native-webrtc's `RTCIceServer`
 *  config. The shapes match (`urls`/`username`/`credential`); we normalise the
 *  readonly array of urls into a mutable one the native config expects. */
function toRtcIceServers(
  iceServers: readonly IceServer[],
): { urls: string | string[]; username?: string; credential?: string }[] {
  return iceServers.map((s) => ({
    urls: typeof s.urls === 'string' ? s.urls : [...s.urls],
    ...(s.username !== undefined ? { username: s.username } : {}),
    ...(s.credential !== undefined ? { credential: s.credential } : {}),
  }))
}

/** Construct a `PeerConnectionLike` over a native react-native-webrtc peer. */
export function createRnPeerConnection(
  iceServers: readonly IceServer[],
): PeerConnectionLike {
  const pc = new RTCPeerConnection({ iceServers: toRtcIceServers(iceServers) })
  // Documented type boundary: react-native-webrtc's `RTCPeerConnection` extends
  // an `event-target-shim` EventTarget whose `addEventListener` is present at
  // runtime but not surfaced through the published `.d.ts` (the class declares
  // its event MAP but leaves the EventTarget attribute param defaulted). We
  // view it through the narrow, fully-typed `PcEventTarget` so the listeners
  // stay type-checked. (Unavoidable third-party typing gap — the only boundary
  // assertion in this file.)
  const events = pc as unknown as PcEventTarget

  // The orchestrator sets `onicecandidate` / `ontrack` AFTER construction. We
  // register the native listeners once here and delegate to whatever handler is
  // currently assigned — so a late assignment still receives events.
  let onIceCandidate: PeerConnectionLike['onicecandidate'] = null
  let onTrack: PeerConnectionLike['ontrack'] = null
  let onIceConnectionStateChange: PeerConnectionLike['oniceconnectionstatechange'] = null

  // ONE MediaStream we own, accumulating every received track. The broker
  // sends video + audio as SEPARATE streams (distinct msid) and, with recvonly
  // transceivers, the native `event.streams` array is frequently empty — so
  // trusting `event.streams[0]` leaves the renderer with no stream and the
  // video stays black. We mirror the proven web client (camera-stream-player),
  // which builds its own `MediaStream` and `addTrack`s each incoming track.
  const combinedStream = new MediaStream()

  // react-native-webrtc fires `icecandidate` with `event.candidate` as an
  // `RTCIceCandidate | null` (null signals gathering complete). Map to the
  // seam's `{ candidate, sdpMid, sdpMLineIndex } | null`.
  events.addEventListener('icecandidate', (event) => {
    const handler = onIceCandidate
    if (!handler) return
    const c = event.candidate
    if (!c) {
      handler({ candidate: null })
      return
    }
    handler({
      candidate: {
        candidate: c.candidate,
        sdpMid: c.sdpMid ?? null,
        sdpMLineIndex: c.sdpMLineIndex ?? null,
      },
    })
  })

  // `track` fires once per received track. Add the track to our own combined
  // stream and surface THAT (never the unreliable native `event.streams[0]`),
  // so the orchestrator always gets a single stream carrying every track.
  events.addEventListener('track', (event) => {
    if (event.track) combinedStream.addTrack(event.track)
    const handler = onTrack
    if (!handler) return
    handler({ streams: [combinedStream] })
  })

  // `iceconnectionstatechange` carries no useful payload — the current state
  // lives on `pc.iceConnectionState`. Narrow the runtime string to the seam's
  // `IceConnectionState` union at this boundary (unknown values pass through as
  // 'new', a benign default).
  events.addEventListener('iceconnectionstatechange', () => {
    const handler = onIceConnectionStateChange
    if (!handler) return
    handler(toIceConnectionState(events.iceConnectionState))
  })

  return {
    addTransceiver(kind: 'audio' | 'video', init: { direction: 'recvonly' }): void {
      pc.addTransceiver(kind, init)
    },

    async createOffer(): Promise<SessionDescription> {
      const offer = await pc.createOffer({})
      return { type: 'offer', sdp: offer.sdp }
    },

    async setLocalDescription(desc: SessionDescription): Promise<void> {
      await pc.setLocalDescription(new RTCSessionDescription(desc))
    },

    async setRemoteDescription(desc: SessionDescription): Promise<void> {
      await pc.setRemoteDescription(new RTCSessionDescription(desc))
    },

    async addIceCandidate(candidate: IceCandidateInit): Promise<void> {
      await pc.addIceCandidate(
        new RTCIceCandidate({
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid ?? null,
          sdpMLineIndex: candidate.sdpMLineIndex ?? null,
        }),
      )
    },

    close(): void {
      pc.close()
    },

    get onicecandidate(): PeerConnectionLike['onicecandidate'] {
      return onIceCandidate
    },
    set onicecandidate(handler: PeerConnectionLike['onicecandidate']) {
      onIceCandidate = handler
    },

    get ontrack(): PeerConnectionLike['ontrack'] {
      return onTrack
    },
    set ontrack(handler: PeerConnectionLike['ontrack']) {
      onTrack = handler
    },

    get oniceconnectionstatechange(): PeerConnectionLike['oniceconnectionstatechange'] {
      return onIceConnectionStateChange
    },
    set oniceconnectionstatechange(handler: PeerConnectionLike['oniceconnectionstatechange']) {
      onIceConnectionStateChange = handler
    },
  }
}
