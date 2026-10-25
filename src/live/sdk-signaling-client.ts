/**
 * sdk-signaling-client — adapts the camstack SDK `System` to the orchestrator's
 * transport-agnostic `SignalingClient` seam.
 *
 * Delegates to the device-scoped `webrtcSession` cap (client-offer flow) and the
 * system-scoped `turnProvider` cap, both reached via `system.trpcClient`. The
 * cap input/output shapes are confirmed against the server cap definitions
 * (`webrtc-session.cap.ts`, `turn-provider.cap.ts`) and the admin-ui reference
 * hook (`use-device-webrtc.ts`) — the orchestrator's `IceServer` /
 * `IceCandidateInit` shapes already match structurally, so no field mapping is
 * needed beyond forwarding.
 */
import type { System } from '@camstack/sdk'
import type {
  SignalingClient,
  IceServer,
  IceCandidateInit,
  WebrtcTarget,
  ClientStreamHints,
  ClientNetworkSample,
} from './signaling-types.js'

/**
 * The SDK's `webrtcSession.handleOffer` target is the server's strict
 * discriminated union (`profile` is the `'high'|'mid'|'low'` enum;
 * `cam-stream` carries `camStreamId`). The orchestrator's seam `WebrtcTarget`
 * is intentionally looser (`profile?: string`, no `camStreamId`). This is the
 * one documented System-seam boundary: a typed, exhaustive mapper narrows the
 * seam target onto the SDK union so no `as` cast is needed.
 */
type SdkWebrtcTarget =
  | { kind: 'adaptive' }
  | { kind: 'profile'; profile: 'high' | 'mid' | 'low' }
  | { kind: 'cam-stream'; camStreamId: string }

function isCamProfile(value: string | undefined): value is 'high' | 'mid' | 'low' {
  return value === 'high' || value === 'mid' || value === 'low'
}

function toSdkTarget(target: WebrtcTarget): SdkWebrtcTarget {
  if (target.kind === 'profile') {
    if (!isCamProfile(target.profile)) {
      throw new Error(`Invalid profile target: ${String(target.profile)}`)
    }
    return { kind: 'profile', profile: target.profile }
  }
  // 'cam-stream' has no camStreamId on the seam target — it is never produced
  // by this client (LiveView uses 'adaptive'); treat any non-profile as adaptive.
  return { kind: 'adaptive' }
}

/** Build a `SignalingClient` backed by a live SDK `System`. */
export function createSdkSignalingClient(system: System): SignalingClient {
  // `webrtcSession` is the DEVICE-scoped cap; `turnProvider` is SYSTEM-scoped.
  // Both are reached structurally off the public `trpcClient` escape hatch.
  const webrtcSession = system.trpcClient.webrtcSession
  const turnProvider = system.trpcClient.turnProvider

  return {
    async getTurnServers(): Promise<readonly IceServer[]> {
      // `getTurnServers` takes no input (`z.void()`) and returns a readonly
      // array already shaped like `IceServer` ({ urls, username?, credential? }).
      const servers = await turnProvider.getTurnServers.query()
      return servers.map(
        (s): IceServer => ({
          urls: s.urls,
          ...(s.username !== undefined ? { username: s.username } : {}),
          ...(s.credential !== undefined ? { credential: s.credential } : {}),
        }),
      )
    },

    async handleOffer(input: {
      deviceId: number
      target: WebrtcTarget
      sdpOffer: string
      sessionId?: string
      hints?: ClientStreamHints
    }): Promise<{ sessionId: string; sdpAnswer: string }> {
      return webrtcSession.handleOffer.mutate({
        deviceId: input.deviceId,
        target: toSdkTarget(input.target),
        sdpOffer: input.sdpOffer,
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        // SERVER GAP (documented): `webrtc-session.cap.ts` declares `hints`
        // ONLY on `createSession` (the server-offer flow) — `handleOffer`
        // (this client-offer flow) has no `hints` field, so the hub's zod
        // parse silently STRIPS the value today and the adaptive selection
        // for client-offer viewers runs hint-less. Forwarding it here is
        // harmless (non-strict zod object; the typed input carries an index
        // signature) and becomes effective the moment the cap adds
        // `hints: webrtcClientHintsSchema.optional()` to `handleOffer`.
        ...(input.hints !== undefined ? { hints: input.hints } : {}),
      })
    },

    async reportClientStats(input: ClientNetworkSample & { deviceId: number }): Promise<void> {
      // Typed end-to-end: `networkQuality.reportClientStats` exists in the
      // pinned router types. Throws on failure — the SESSION's reporter tick
      // catches (best-effort), so a rejected report never disturbs playback.
      await system.trpcClient.networkQuality.reportClientStats.mutate({
        deviceId: input.deviceId,
        rttMs: input.rttMs,
        jitterMs: input.jitterMs,
        estimatedBandwidthKbps: input.estimatedBandwidthKbps,
        packetLossPercent: input.packetLossPercent,
      })
    },

    async addIceCandidate(input: {
      deviceId: number
      sessionId: string
      candidate: string
      sdpMid?: string | null
      sdpMLineIndex?: number | null
    }): Promise<void> {
      await webrtcSession.addIceCandidate.mutate({
        deviceId: input.deviceId,
        sessionId: input.sessionId,
        candidate: input.candidate,
        sdpMid: input.sdpMid ?? null,
        sdpMLineIndex: input.sdpMLineIndex ?? null,
      })
    },

    async getIceCandidates(input: {
      deviceId: number
      sessionId: string
    }): Promise<{ candidates: readonly IceCandidateInit[]; done: boolean }> {
      const res = await webrtcSession.getIceCandidates.query({
        deviceId: input.deviceId,
        sessionId: input.sessionId,
      })
      return { candidates: res.candidates, done: res.done }
    },

    async getSessionState(input: {
      deviceId: number
      sessionId: string
    }): Promise<{ pendingRenegotiation: { target: WebrtcTarget; epoch: number } | null }> {
      return webrtcSession.getSessionState.query({
        deviceId: input.deviceId,
        sessionId: input.sessionId,
      })
    },

    async closeSession(input: { deviceId: number; sessionId: string }): Promise<void> {
      await webrtcSession.closeSession.mutate({
        deviceId: input.deviceId,
        sessionId: input.sessionId,
      })
    },
  }
}
