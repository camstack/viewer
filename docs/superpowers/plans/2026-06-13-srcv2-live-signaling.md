# srcV2 Live — WebRTC Signaling Orchestrator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A platform-agnostic, fully-tested `WebrtcLiveSession` orchestrator that drives camstack's `webrtcSession` cap (client-offer flow + trickle ICE + adaptive renegotiation) to receive a recvonly live stream — the core of the srcV2 live view.

**Architecture:** The orchestrator depends only on injected interfaces — a `SignalingClient` (the subset of `webrtcSession` + `turnProvider` cap methods) and a `createPeerConnection` factory returning a structural `PeerConnectionLike`. This keeps it pure-TS testable (vitest, hand-written fakes — NO `vi.mock`, NO timers) and reusable across `react-native-webrtc` (native) and browser `RTCPeerConnection` (web). Polling cadence (remote-ICE pull, renegotiation check) lives in the RN layer that calls the orchestrator's methods on an interval, not in the orchestrator.

**Tech Stack:** TypeScript, vitest. (RN adapter over `react-native-webrtc` + the SDK caps is a later glue task, outlined.)

**Spec:** `docs/superpowers/specs/2026-06-13-srcv2-camera-timeline-design.md` (§2 D4 live=WebRTC). Signaling contract confirmed via the server `packages/ui-library/src/hooks/use-device-webrtc.ts`.

---

## File Structure

- `srcV2/live/signaling-types.ts` — the injected interfaces (`SignalingClient`, `PeerConnectionLike`, `WebrtcTarget`, DTOs). One responsibility: the seam contract.
- `srcV2/live/webrtc-live-session.ts` — the `WebrtcLiveSession` orchestrator.
- Tests under `srcV2/live/__tests__/`.

---

### Task 1: Signaling seam types + connect handshake + outbound ICE

**Files:**
- Create: `srcV2/live/signaling-types.ts`
- Create: `srcV2/live/webrtc-live-session.ts`
- Test: `srcV2/live/__tests__/webrtc-live-session.spec.ts`

- [ ] **Step 1: Write the seam types** — create `srcV2/live/signaling-types.ts`:

```typescript
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
  }): Promise<{ sessionId: string; sdpAnswer: string }>
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

/** Structural subset of RTCPeerConnection used by the orchestrator — satisfied
 *  by `react-native-webrtc` (native) and the browser PC (web). */
export interface PeerConnectionLike {
  addTransceiver(kind: 'audio' | 'video', init: { direction: 'recvonly' }): void
  createOffer(): Promise<SessionDescription>
  setLocalDescription(desc: SessionDescription): Promise<void>
  setRemoteDescription(desc: SessionDescription): Promise<void>
  addIceCandidate(candidate: IceCandidateInit): Promise<void>
  close(): void
  onicecandidate: ((ev: { candidate: IceCandidateInit | null }) => void) | null
  ontrack: ((ev: { streams: readonly MediaStreamLike[] }) => void) | null
}

export interface WebrtcLiveConfig {
  readonly deviceId: number
  readonly target: WebrtcTarget
  readonly client: SignalingClient
  readonly createPeerConnection: (iceServers: readonly IceServer[]) => PeerConnectionLike
}
```

- [ ] **Step 2: Write the failing test** — create `srcV2/live/__tests__/webrtc-live-session.spec.ts`:

```typescript
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
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:v2 -- webrtc-live-session`
Expected: FAIL — cannot find module `../webrtc-live-session.js`.

- [ ] **Step 4: Write the implementation** — create `srcV2/live/webrtc-live-session.ts`:

```typescript
import type {
  WebrtcLiveConfig,
  PeerConnectionLike,
  MediaStreamLike,
} from './signaling-types.js'

/** Drives the camstack `webrtcSession` client-offer flow to receive a recvonly
 *  live stream. Transport-agnostic: all WebRTC + signaling are injected. The
 *  polling methods (`pollRemoteIce`, `checkRenegotiation`) are driven by the
 *  caller on an interval — the orchestrator holds no timers. */
export class WebrtcLiveSession {
  private pc: PeerConnectionLike | null = null
  private sessionId: string | null = null
  private remoteStream: MediaStreamLike | null = null

  constructor(private readonly config: WebrtcLiveConfig) {}

  get id(): string | null {
    return this.sessionId
  }

  get stream(): MediaStreamLike | null {
    return this.remoteStream
  }

  async connect(): Promise<void> {
    const { deviceId, target, client, createPeerConnection } = this.config
    const iceServers = await client.getTurnServers()
    const pc = createPeerConnection(iceServers)
    this.pc = pc

    pc.ontrack = (ev) => {
      if (ev.streams[0]) this.remoteStream = ev.streams[0]
    }
    pc.addTransceiver('video', { direction: 'recvonly' })
    pc.addTransceiver('audio', { direction: 'recvonly' })

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    const { sessionId, sdpAnswer } = await client.handleOffer({
      deviceId,
      target,
      sdpOffer: offer.sdp,
    })
    this.sessionId = sessionId

    pc.onicecandidate = (ev) => {
      const sid = this.sessionId
      if (ev.candidate && sid) {
        void client.addIceCandidate({
          deviceId,
          sessionId: sid,
          candidate: ev.candidate.candidate,
          sdpMid: ev.candidate.sdpMid,
          sdpMLineIndex: ev.candidate.sdpMLineIndex,
        })
      }
    }

    await pc.setRemoteDescription({ type: 'answer', sdp: sdpAnswer })
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:v2 -- webrtc-live-session`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add srcV2/live/signaling-types.ts srcV2/live/webrtc-live-session.ts srcV2/live/__tests__/webrtc-live-session.spec.ts
git commit -m "feat(srcV2): WebRTC live session — connect handshake + trickle ICE out"
```

---

### Task 2: Remote ICE pull, adaptive renegotiation, teardown

**Files:**
- Modify: `srcV2/live/webrtc-live-session.ts`
- Test: `srcV2/live/__tests__/webrtc-live-session.spec.ts` (append)

- [ ] **Step 1: Append failing tests** — add these `describe` blocks to the spec file (reuse the `FakePeerConnection`/`makeClient` helpers already in the file):

```typescript
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
```

- [ ] **Step 2: Run test to verify the new tests fail**

Run: `npm run test:v2 -- webrtc-live-session`
Expected: FAIL — `pollRemoteIce`/`checkRenegotiation`/`close` are not functions.

- [ ] **Step 3: Add the methods** — append these three methods inside the `WebrtcLiveSession` class (after `connect`):

```typescript
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
    })
    await pc.setRemoteDescription({ type: 'answer', sdp: sdpAnswer })
    return true
  }

  /** Best-effort teardown: close the signaling session (ignore failures), close
   *  the peer, and clear state. */
  async close(): Promise<void> {
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
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:v2 -- webrtc-live-session`
Expected: PASS (8 tests total in the file).

- [ ] **Step 5: Full suite + type-check gate**

Run: `npm run test:v2` — expect all green (39 prior + 8 new = 47).
Run: `npm run ts-check` — no new errors in any `srcV2/` path.

- [ ] **Step 6: Commit**

```bash
git add srcV2/live/webrtc-live-session.ts srcV2/live/__tests__/webrtc-live-session.spec.ts
git commit -m "feat(srcV2): WebRTC live session — remote ICE pull, renegotiation, teardown"
```

---

## Outline — RN glue (separate later tasks, ts-check only)

- **SDK SignalingClient adapter** — `srcV2/live/sdk-signaling-client.ts`: implement `SignalingClient` over the SDK `System` caps (`webrtcSession.handleOffer/addIceCandidate/getIceCandidates/getSessionState/closeSession`, `turnProvider.getTurnServers`). Thin mapping; ts-check.
- **react-native-webrtc factory** — `createPeerConnection(iceServers)` returning the lib's `RTCPeerConnection` (already a dep, v124). Wires `onicecandidate`/`ontrack` to the `PeerConnectionLike` shape.
- **LiveView component** — `srcV2/live/LiveView.tsx`: owns a `WebrtcLiveSession`, runs the poll intervals (remote-ICE until `done`, renegotiation check), renders the stream via `RTCView` (native) / `<video>` (web), camstack-styled overlay (mute, quality target switch via `target`), connection-state aware (pause when offline). ts-check.

## Self-Review

**Spec coverage:** D4 live = native WebRTC recvonly via camstack `webrtcSession` → Task 1 (connect handshake, recvonly transceivers, client-offer) + Task 2 (trickle both directions, adaptive renegotiation via `getSessionState`, teardown). ✓ RN rendering + SDK adapter are the outlined glue (gated only by being UI/IO, not by the spike). ✓

**Placeholder scan:** Tasks 1–2 show full type/impl/test code + commands + expected output. The RN glue is an explicit outline, not a placeholder inside an executable task. ✓

**Type consistency:** `SignalingClient`/`PeerConnectionLike`/`WebrtcTarget`/`IceServer`/`IceCandidateInit`/`SessionDescription`/`MediaStreamLike`/`WebrtcLiveConfig` defined in Task 1 `signaling-types.ts` and consumed unchanged by the orchestrator + tests. Method signatures match the server `webrtcSession`/`turnProvider` contract from `use-device-webrtc.ts`. Tests use hand-written fakes (no `vi.mock` hoisting trap, no timers). ✓
