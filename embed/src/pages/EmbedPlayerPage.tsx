/**
 * EmbedPlayerPage — login-bypassing, chrome-less live WebRTC player.
 *
 * Served with the Viewer at `/viewer/camstack/embed/index.html?mode=player`
 * (see `EmbedApp`), loaded inside a native iOS WKWebView: WebKit's WebRTC stack
 * decodes H.265, which the React-Native app's native libwebrtc cannot, so the
 * native app draws its own chrome and hosts this page purely as the video surface.
 *
 * Auth comes from a JWT injected by the WebView (NOT a login form): the native
 * side sets `window.__CAMSTACK_EMBED__` BEFORE the page loads. We build a fresh
 * `System` SDK from that `{ serverUrl, token }` and reuse the REAL ui-library
 * client-offer player (`CameraStreamPlayer` + `useDeviceWebrtc`); no hand-rolled
 * WebRTC signaling.
 *
 * Contract (fixed — the WebView side depends on it exactly):
 *   IN  (set before load / web handshake): window.__CAMSTACK_EMBED__ = { serverUrl, token, deviceId, target, muted }
 *   OUT (every state change): emitHost({ type:'state', state, message? }) — RN postMessage or parent.postMessage
 *   IN  (once mounted):     window.__camstackEmbed = { setMuted(b), setTarget(t), …, setMic(on) }
 */
import { useEffect, useMemo, useRef, useState} from 'react'
import { useStallWatchdog } from '../embed/use-stall-watchdog'
import { z } from 'zod'
import {
  SystemProvider,
  trpc,
  CameraStreamPlayer,
  useDeviceWebrtc,
  type ClientOfferResult,
  type AdaptiveHintsReport,
  type ClientStreamHints,
  type PlayerConnectionState,
  type PlayerWebrtcTarget,
  type WebrtcTarget,
} from '@camstack/ui-library'
import { createSystem, type System } from '@camstack/sdk'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  embedTargetSchema,
  parseSetDeviceCommand,
  type EmbedTarget,
  type SetDeviceCommand,
} from '../embed/set-device-command'
import { gridHighlightSchema, type GridHighlightConfig } from '../embed/embed-grid-config'
import { PaletteBridge } from '../embed/PaletteBridge'
import { highlightFallback, useTileHighlight } from '../embed/use-tile-highlight'
import { usePaletteView } from '../../../shared/palette'
import { THEME } from '../../../src/theme/tokens'
import {
  emitHost,
  onHostCommand,
  setLogDeviceTag,
  useEmbedConfig,
  type ConfigResult,
} from '../embed/host-bridge'
import { useExclusiveIntercom } from '../embed/use-exclusive-intercom'
import { RecordedTrackSession } from '../playback/recorded-track-session'
import { fireInitialSeek } from '../playback/initial-seek'
import { createLiveCaptureSession } from '../live/live-capture.js'
import { takeSnapshot } from '../live/frame-snapshot.js'
import {
  resolvePlaybackEntryProfile,
  resolvePlaybackUpgradeProfile,
} from '../playback/playback-profile.js'
import { useHostBox } from '../embed/use-host-box.js'

// ── Injected-config contract (validated at the boundary) ───────────────────

// WebRTC target the native app wants to view (`adaptive` | `profile`) —
// shared with the in-place camera-swap command so both entry points validate
// one contract. See set-device-command.ts.

const embedConfigSchema = z.object({
  serverUrl: z.string().min(1),
  token: z.string().min(1),
  deviceId: z.number().int().nonnegative(),
  target: embedTargetSchema,
  muted: z.boolean(),
  /** Show the live client-side stats overlay (host-toggleable via setStats). */
  stats: z.boolean().optional(),
  /** Per-camera highlight config (rendered IN the embed — a native border over
   *  the WebView is occluded by the video's compositing layer on iOS). */
  highlight: gridHighlightSchema.optional(),
  /** Last-known snapshot data URL — cold-start poster only (before the first
   *  frame). The live stream + retained frame take over once playing. */
  snapshot: z.string().optional(),
  /** Deep-link "go to this moment" (epoch ms): enter recorded playback at this
   *  instant the moment the control channel opens — no host round-trip. The
   *  host clears it from the config once settled, so a reload never re-seeks. */
  initialSeekMs: z.number().positive().optional(),
  /** A CLIP to open on, instead of live. Same contract as `initialSeekMs`:
   *  read AT LOAD only, and it means the page never dials the live edge —
   *  which is what lets a sleeping battery camera play a file (D575). */
  initialClipId: z.string().min(1).optional(),
  initialClipProvider: z.string().min(1).optional(),
  initialClipProfile: z.string().min(1).optional(),
})

type EmbedConfig = z.infer<typeof embedConfigSchema>

// ── Outbound state contract (page → WebView) ───────────────────────────────

type EmbedReportState = 'connecting' | 'playing' | 'error'

interface EmbedStateMessage {
  readonly type: 'state'
  readonly state: EmbedReportState
  readonly message?: string
  /**
   * What this page's command surface supports (D483).
   *
   * The host must be able to tell a page that can swap the camera in place
   * from one that cannot, and it cannot ask a WebView a synchronous question.
   * So the page ADVERTISES, on a message the host already receives, and the
   * host reads ABSENCE as "an older page" — capability detection rather than a
   * version number, which is the only form that stays correct when the app and
   * the hub-served embed are deployed independently (and they are: the app
   * ships OTA, this page ships with the orchestrator addon).
   */
  readonly caps?: readonly string[]
}

/**
 * The capabilities this page advertises. Names are matched literally by the
 * host — never renamed, only added to, because an older host looking for a
 * string that has moved would fall back forever without saying why.
 */
const PAGE_CAPABILITIES: readonly string[] = [
  /** `setDevice` swaps the camera on the booted page. */
  'setDevice',
  /** ...and accepts the instant to open at, so the swap is flash-free. */
  'setDevice.atMs',
  /**
   * Host pushes a renewed access token (D812). The host renews; the page
   * never holds a refresh token — two refreshers would race the rotation.
   */
  'setToken',
]

declare global {
  interface Window {
    __CAMSTACK_EMBED__?: unknown
    /** Page-level command surface — survives player remounts (the per-player
     *  `__camstackEmbed` below is torn down on every camera swap). */
    __camstackEmbedPage?: {
      /** In-place camera swap. Untrusted input — validated by
       *  `parseSetDeviceCommand`; malformed payloads no-op. */
      setDevice: (raw: unknown) => void
      /**
       * Apply a renewed access token without rebuilding the page. Empty /
       * non-string input is a no-op. Same token as the live one is a no-op
       * (avoids a reconnect flicker when the host re-asserts on mount).
       */
      setToken: (token: unknown) => void
    }
    __camstackEmbed?: {
      setMuted: (muted: boolean) => void
      setTarget: (target: EmbedTarget) => void
      setStats: (stats: boolean) => void
      setHighlight: (highlight: GridHighlightConfig) => void
      setSnapshot: (snapshot: string) => void
      setMic: (on: boolean) => void
      fit: (w: number, h: number) => void
      reconnect: () => void
      // Recorded-playback timeline control (D42): pointer moves on the
      // per-viewer session — recorded frames arrive on the SAME track as live.
      playRecorded: (deviceId: number, epochMs: number, profile: string) => void
      // Move the pointer into a stored CLIP (D575). A clip is another position
      // of the recorded source pointer: recorded frames already arrive on the
      // SAME track, so a file needs no player of its own and everything after
      // this call travels on the clip's file-relative axis unchanged.
      playClip: (
        deviceId: number,
        clipId: string,
        provider: string,
        offsetMs: number,
        profile?: string,
      ) => void
      seek: (epochMs: number) => void
      // `dragId` names the scrub gesture this call belongs to (optional — see
      // `RecordedTrackSession.begin`/`commit`): joins this page's own
      // diagnostic lines to the host's, and rides the wire on `scrubStart`/
      // `scrubCommit` for the hub's `scrub-feeder:*` lines to do the same.
      scrubCommit: (epochMs: number, dragId?: string) => void
      scrubStart: (dragId?: string) => void
      // `m`/`v` = the host's px→time mapping hint (drag-mapping.ts): mode and
      // velocity. Optional — a host without the mapping sends the bare epoch,
      // and the hub aggregate reports its ticks as `mapUnknown`.
      scrubTo: (epochMs: number, m?: 'fine' | 'coarse', v?: number) => void
      scrubEnd: (epochMs: number) => void
      // Pre-run locate + read + demux server-side around the instant the
      // timeline opened on (safe while live — pure cache fill).
      timelineWarm: (epochMs: number) => void
      setRate: (rate: number) => void
      stepFrame: (dir: number) => void
      goLive: () => void
      startLiveCapture: () => void
      stopLiveCapture: () => void
      /** Cut the frame on screen and post it back as `snapshot`. */
      snapshot: (id: string) => void
    }
    ReactNativeWebView?: {
      postMessage: (message: string) => void
    }
  }
}

/** Post a state transition to the host (RN WebView or browser iframe). */
function postState(state: EmbedReportState, message?: string): void {
  const payload: EmbedStateMessage =
    message !== undefined
      ? { type: 'state', state, message, caps: PAGE_CAPABILITIES }
      : { type: 'state', state, caps: PAGE_CAPABILITIES }
  emitHost(payload)
}

/**
 * Map the player's richer connection state onto the 3-state embed contract.
 * `disconnected` (a recoverable blip the player auto-reconnects from) and the
 * cold-start `idle` both surface as `connecting` so the native app shows a
 * spinner rather than a hard error during a transient drop.
 */
function toReportState(state: PlayerConnectionState): EmbedReportState {
  switch (state) {
    case 'playing':
      return 'playing'
    case 'error':
      return 'error'
    case 'connecting':
    case 'disconnected':
    case 'idle':
      return 'connecting'
  }
}

/** The profile recorded playback ENTERS at. Adaptive always starts on `low`
 *  so the first picture is the cheapest available; a bandwidth probe then
 *  climbs through mid/high. A PINNED profile is honoured exactly. */
function resolvePlaybackProfile(
  target: EmbedTarget,
  liveProfile: 'high' | 'mid' | 'low',
): string {
  return resolvePlaybackEntryProfile(target, liveProfile)
}

async function probePlaybackDownlinkMbps(): Promise<number | null> {
  if (typeof window === 'undefined') return null
  const origin = window.location.origin.replace(/\/+$/, '')
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 2500)
  const started = performance.now()
  try {
    const res = await fetch(`${origin}/adaptive-probe`, { signal: ctrl.signal })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const elapsedMs = Math.max(1, performance.now() - started)
    if (buf.byteLength < 1024) return null
    return (buf.byteLength * 8) / elapsedMs / 1000
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

function climbRecordedAfterProbe(
  session: RecordedTrackSession,
  deviceId: number,
  epochMs: number,
  target: EmbedTarget,
): void {
  if (target.kind !== 'adaptive') return
  void probePlaybackDownlinkMbps().then((mbps) => {
    if (mbps === null) return
    const next = resolvePlaybackUpgradeProfile(target, mbps)
    session.upgradePlayback(deviceId, epochMs, next)
  })
}

/** The embed target translated into the player/hook's `WebrtcTarget` union. */
function toWebrtcTarget(target: EmbedTarget): WebrtcTarget {
  return target.kind === 'adaptive'
    ? { kind: 'adaptive' }
    : { kind: 'profile', profile: target.profile }
}

/** Opaque player streamKey for a target — a change drives the player's SEAMLESS
 *  in-place switch (make-before-break); it is deliberately NOT a React `key`,
 *  because a remount tears the PeerConnection down and pays a full cold connect
 *  (~1s of black) on every profile change. */
function targetKey(target: EmbedTarget): string {
  return target.kind === 'adaptive' ? 'embed:adaptive' : `embed:profile:${target.profile}`
}

// ── Config parser ─────────────────────────────────────────────────────────────

/** Parse the injected/handshake config into a host-bridge ConfigResult. */
function parseEmbedConfig(raw: unknown): ConfigResult<EmbedConfig> {
  const parsed = embedConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; '),
    }
  }
  return { ok: true, config: parsed.data }
}

// ── Error state ──────────────────────────────────────────────────────────────

function EmbedError({ message }: { message: string }) {
  // Surface the error to the native app too — a missing/invalid config means
  // the player will never reach `connecting`, so without this the WebView
  // would hang on its own spinner forever.
  useEffect(() => {
    postState('error', message)
  }, [message])
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: THEME.dark.mediaBlack,
        color: THEME.dark.danger,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        padding: 16,
        textAlign: 'center',
      }}
    >
      Embed config error: {message}
    </div>
  )
}

// ── Player (inside the System/tRPC providers) ────────────────────────────────

interface EmbedPlayerProps {
  readonly system: System
  readonly deviceId: number
  readonly initialTarget: EmbedTarget
  readonly initialMuted: boolean
  readonly initialStats: boolean
  readonly initialHighlight?: GridHighlightConfig
  readonly initialSnapshot?: string
  /** Config-carried deep-link seek (epoch ms) — see `initialSeekMs` in the schema. */
  readonly initialSeekMs?: number
  /** Config-carried clip to open on — see `initialClipId` in the schema. */
  readonly initialClipId?: string
  readonly initialClipProvider?: string
  readonly initialClipProfile?: string
  /** The config's bearer, for `/adaptive-probe` only (D635): this page runs
   *  from `file://` in the native app, so no session cookie reaches the hub.
   *  Never logged. */
  readonly probeAuthToken: string
}

function EmbedPlayer({
  system,
  deviceId,
  initialTarget,
  initialMuted,
  initialStats,
  initialHighlight,
  initialSnapshot,
  initialSeekMs,
  initialClipId,
  initialClipProvider,
  initialClipProfile,
  probeAuthToken,
}: EmbedPlayerProps) {
  const [target, setTarget] = useState<EmbedTarget>(initialTarget)
  const kindPalette = usePaletteView()
  // Stamp the camera onto every outgoing log message (→ tags.deviceId on the hub).
  useEffect(() => setLogDeviceTag(deviceId), [deviceId])
  // The live profile selector's decision, read fresh inside the mount-once
  // command surface (which captures a stale `target` otherwise). Recorded
  // playback reuses it: a pinned profile is forced; adaptive enters at `low`
  // and a bandwidth probe climbs through mid/high. Recorded playback has no
  // live ladder of its own — the probe is the climb.
  const targetRef = useRef<EmbedTarget>(target)
  targetRef.current = target
  const [muted, setMuted] = useState(initialMuted)
  const [stats, setStats] = useState(initialStats)
  const [highlight, setHighlight] = useState<GridHighlightConfig | undefined>(initialHighlight)
  const [snapshot, setSnapshot] = useState<string | undefined>(initialSnapshot)
  // Host-driven fast reconnect: each reconnect() bump forwards a new
  // reconnectSignal to the player, which reconnects WITHOUT remounting (keeps
  // the last decoded frame). The native shell calls this on a NetInfo
  // connectivity change / foreground resume INSTEAD of reloading the WebView.
  const [reconnectNonce, setReconnectNonce] = useState(0)
  /**
   * The player's own view of its connection, kept because the stall watchdog
   * needs it. `onStateChange` used to forward straight to the host and keep
   * nothing — but a frozen stream reports `playing`, so the one fact that
   * distinguishes "stalled" from "still connecting" was being thrown away.
   */
  const [playerState, setPlayerState] = useState<PlayerConnectionState>('idle')
  // Host pushes the real WebView pixel frame (WKWebView innerHeight is stale on
  // rotation); fall back to the window until the first fit() arrives.
  const { box, fit: fitBox } = useHostBox()

  const highlightType = useTileHighlight(system, deviceId, highlight)

  // Single-camera intercom (talk-back) — reuses the grid's exclusive-intercom
  // controller driven by this one device. setMic(on) maps to setActiveMic.
  const intercom = useExclusiveIntercom()
  const setActiveMicRef = useRef(intercom.setActiveMic)
  setActiveMicRef.current = intercom.setActiveMic

  // Real client-offer signaling — the SAME hook the admin shell uses. No
  // hand-rolled WebRTC anywhere; the hook talks to the `webrtc-session` cap
  // over the token-authenticated tRPC client.
  const {
    handleOffer,
    getIceServers,
    addIceCandidate,
    getIceCandidates,
    closeSession,
    getSessionState,
    getSessionDebug,
    applyDownlinkProbe,
  } = useDeviceWebrtc(system.trpcClient, deviceId)

  const webrtcTarget = useMemo<WebrtcTarget>(() => toWebrtcTarget(target), [target])

  // Bind the selected target into the player's target-agnostic callbacks —
  // mirrors StreamPanel: the player ships only an SDP offer, we close over
  // the target. `reoffer` carries the SERVER-chosen downgrade target verbatim
  // (adaptive re-offer), so it does NOT close over `webrtcTarget`.
  const playerHandleOffer = useMemo(
    () =>
      (
        sdpOffer: string,
        sessionId?: string,
        hints?: ClientStreamHints,
      ): Promise<ClientOfferResult> =>
        handleOffer(webrtcTarget, sdpOffer, sessionId, hints),
    [handleOffer, webrtcTarget],
  )
  const playerReoffer = useMemo(
    () =>
      (
        sessionId: string,
        sdpOffer: string,
        reofferTarget: PlayerWebrtcTarget,
        hints?: ClientStreamHints,
      ): Promise<ClientOfferResult> =>
        handleOffer(reofferTarget, sdpOffer, sessionId, hints),
    [handleOffer],
  )

  /** THE recorded surface (D42): one session per PeerConnection, every intent
   *  a pointer-move message, every picture on the track already on screen.
   *  Rebuilt per reconnect (a fresh connection carries a fresh channel). */
  const recordedSessionRef = useRef<RecordedTrackSession | null>(null)
  /** The live player's <video> — the rvfc source for receiver-credit acks. */
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  /** The frame the player renders into — the stall watchdog's search root. */
  const surfaceRef = useRef<HTMLDivElement | null>(null)

  /**
   * A frozen single-camera view heals itself.
   *
   * `use-stall-watchdog` was written for exactly this and wired only into
   * `GridTilePlayer`; `?mode=player` — what the native app opens for one
   * camera — was left with error-keyed recovery only, and a freeze is not an
   * error. Reported 2026-09-20: the live view froze repeatedly with 0.00% loss
   * and the decoded-frame counter still advancing, and pause + play was the
   * only way out. That gesture works because the session CAN be rebuilt; what
   * was missing is anything that decides to.
   *
   * Recovery bumps the SAME `reconnectNonce` the host's `api.reconnect()`
   * drives, so a self-healing rebuild runs the manual path's code — reconnect
   * without remount, keeping the last decoded frame on screen.
   */
  useStallWatchdog({
    containerRef: surfaceRef,
    playing: playerState === 'playing',
    onRecover: () => {
      setReconnectNonce((n) => n + 1)
      emitHost({
        type: 'log',
        scope: 'stream-debug',
        msg: 'stall-recovery',
        data: { reason: 'no presented frame while playing' },
      })
    },
  })
  const liveProfileRef = useRef<'high' | 'mid' | 'low'>('low')
  const sessionGapReportedRef = useRef(false)
  /**
   * The last `playClip` that could not be sent because the control channel was
   * not open yet, kept so it can be asserted the moment one is.
   *
   * The host already re-asserts a held clip whenever a PLAYER appears
   * (`clip-assert-on-player.ts`), and that is the wrong readiness signal for
   * this command: a player is `playing` when the VIDEO track flows, while
   * `playClip` travels on the DATA CHANNEL, which is negotiated separately and
   * opens later. Measured on a battery camera, 2026-09-22: `mount→playing` and
   * `playClip NOT sent — no open session` one millisecond apart, and the
   * operator saw the live edge instead of the clip.
   *
   * The LAST one, never a queue: a clip on the pointer is a STATE, not an
   * event, so replaying an older one would put the pointer somewhere the
   * operator has already left.
   */
  const pendingClipRef = useRef<
    | {
        readonly deviceId: number
        readonly clipId: string
        readonly provider: string
        readonly offsetMs: number
        readonly profile?: string
      }
    | null
  >(null)

  // ── Adaptive-tier join (the app's half; the hub logs its own) ─────────────
  // Two independent halves arrive at different times: what this client SENT
  // (the player's `onAdaptiveHints`, already deduped per decision change) and
  // what it GOT (`liveProfile`, pushed by the broker over the control channel).
  // Neither alone answers "why is it stuck on low" — a hub line proves it
  // scored SOME hints but not whether this app sent any, and a profile alone
  // does not say what was asked for. Emit the pair, once per change of either.
  const adaptiveSentRef = useRef<AdaptiveHintsReport | null>(null)
  const adaptiveLineRef = useRef<string | null>(null)
  const emitAdaptiveLine = (): void => {
    const sent = adaptiveSentRef.current
    if (sent === null) return
    const got = liveProfileRef.current
    const line = `${sent.phase}|${sent.viewportWidth ?? '-'}x${sent.viewportHeight ?? '-'}|${sent.devicePixelRatio ?? '-'}|${sent.downlinkMbps ?? '-'}|${sent.prefersTier ?? '-'}|${sent.probeOrigin ?? 'unreachable'}|${got}`
    if (line === adaptiveLineRef.current) return
    adaptiveLineRef.current = line
    emitHost({
      type: 'log',
      scope: 'adaptive',
      msg: 'tier decision',
      data: {
        deviceId,
        requested: target.kind === 'adaptive' ? 'adaptive' : `pinned:${target.kind}`,
        phase: sent.phase,
        // What the app SENT — the exact inputs the hub scored.
        viewportWidth: sent.viewportWidth ?? null,
        viewportHeight: sent.viewportHeight ?? null,
        devicePixelRatio: sent.devicePixelRatio ?? null,
        downlinkMbps: sent.downlinkMbps ?? null,
        prefersTier: sent.prefersTier ?? null,
        // Null means the downlink probe had no reachable origin, so the hub
        // could never have seen a downlink no matter how fast the link is.
        probeOrigin: sent.probeOrigin,
        // What the app GOT — the broker's live profile on this connection.
        liveProfile: got,
      },
    })
  }
  /** The still-unfired config-carried initial seek. Consumed when actually
   *  SENT (a channel that dies before opening leaves it for the reconnect's
   *  channel); once fired, later reconnects must NOT yank playback back. */
  const initialSeekRef = useRef<number | null>(initialSeekMs ?? null)
  // The clip half of the same idea. Fired from the same place, once, and
  // cleared so a later reload cannot replay a stale file.
  const initialClipRef = useRef<{ clipId: string; provider: string; profile?: string } | null>(
    initialClipId === undefined || initialClipProvider === undefined
      ? null
      : {
          clipId: initialClipId,
          provider: initialClipProvider,
          ...(initialClipProfile === undefined ? {} : { profile: initialClipProfile }),
        },
  )

  // ── Recorded playback (D42: the track IS the surface) ─────────────────────
  // There is no client recorded engine any more: recorded playback and scrub
  // ride the SAME WebRTC track as live, with the broker's per-viewer
  // TimelineSession moving the source pointer. There is no client-side
  // byte-range reader, decoder or preview surface.

  // ENFORCER for "the element keeps un-muting itself". The element-state
  // diagnostic caught the element muted at one sample and UN-muted 4 s later
  // with the desired state unchanged — some actor re-enables it after the
  // player's own mute effect. Until that actor is named, this holds the line
  // while the operator WANTS silence; recorded audio now rides the same track
  // as live (D42), so the mute owner is the single `muted` flag and nothing
  // else may force-silence recorded playback.
  useEffect(() => {
    if (!muted) {
      // ── The sweep's INVERSE, and it is not optional ────────────────────
      // The sweep below sets `t.enabled = false`, which is silence at the
      // TRACK, not at the element. Nothing used to set it back, so the
      // silence outlived the request for it: the operator opened a clip with
      // the audio icon off, the sweep disabled the track, he turned the icon
      // on, `muted` went false — and he heard nothing, because un-muting a
      // <video> does not re-enable a disabled track. Measured on 1436,
      // 2026-09-23: `first audio RTP sent` (Opus, payload 111),
      // `clip-stream:first-audio lateMs 0 droppedLate 0` — every layer
      // delivered, and the app silenced it. It read as a codec fault for a
      // day. A destructive sweep with no inverse is the defect, not the sweep.
      let restored = 0
      for (const v of Array.from(document.querySelectorAll('video'))) {
        const s = v.srcObject
        if (s instanceof MediaStream) {
          for (const t of s.getAudioTracks()) {
            if (!t.enabled) {
              t.enabled = true
              restored++
            }
          }
        }
      }
      if (restored > 0) {
        emitHost({
          type: 'log',
          scope: 'live-audio',
          msg: 'un-muted',
          data: { restored },
        })
      }
      return
    }
    const id = setInterval(() => {
      let corrected = 0
      for (const v of Array.from(document.querySelectorAll('video'))) {
        if (!v.muted) {
          v.muted = true
          corrected++
        }
        const s = v.srcObject
        if (s instanceof MediaStream) {
          for (const t of s.getAudioTracks()) {
            if (t.enabled) {
              t.enabled = false
              corrected++
            }
          }
        }
      }
      if (corrected > 0) {
        emitHost({
          type: 'log',
          scope: 'live-audio',
          msg: 're-muted',
          data: { corrected },
        })
      }
    }, 1000)
    return () => clearInterval(id)
  }, [muted])

  useEffect(() => () => recordedSessionRef.current?.dispose(), [])

  // Expose the WebView → page control surface once mounted. `setTarget`
  // re-points the stream (the changed `streamKey` drives the player's SEAMLESS
  // make-before-break switch); `setMuted` toggles the <video> via the muted prop.
  useEffect(() => {
    // D42: ONE recorded surface — the track. Every handler below is a pointer
    // move on the session; a page with no open channel has no recorded surface
    // (the live connection is down too), so it reports the gap honestly
    // instead of pretending with a second engine.
    const session = (): RecordedTrackSession | null => {
      const current = recordedSessionRef.current
      if (!current?.isOpen()) return null
      return current
    }
    // Entry profile — see `resolvePlaybackProfile`.
    const playbackProfile = (): string =>
      resolvePlaybackProfile(targetRef.current, liveProfileRef.current)
    const climbAfterProbe = (session: RecordedTrackSession, epochMs: number): void => {
      climbRecordedAfterProbe(session, deviceId, epochMs, targetRef.current)
    }
    const noSession = (what: string): void => {
      if (sessionGapReportedRef.current) return
      sessionGapReportedRef.current = true
      emitHost({
        type: 'log',
        scope: 'recorded:session',
        msg: 'pointer move with no open session',
        data: { what },
      })
      emitHost({ type: 'recState', state: 'error' })
    }
    const withSession = (
      what: string,
      action: (session: RecordedTrackSession) => boolean,
    ): boolean => {
      const current = session()
      if (!current || !action(current)) {
        noSession(what)
        return false
      }
      sessionGapReportedRef.current = false
      return true
    }
    // Release a scrub drag at `epochMs`: land playback on `low` immediately
    // (same profile as the drag — often already in RAM). If auto/forced want
    // a higher tier, the session GOP-first upgrades after 5 s of playback.
    const releaseScrub = (epochMs: number, dragId?: string): void => {
      withSession('scrubCommit', (current) => {
        const ok = current.landFromScrub(deviceId, epochMs, playbackProfile(), dragId)
        if (ok) climbAfterProbe(current, epochMs)
        return ok
      })
    }
    const capture = createLiveCaptureSession({
      emit: emitHost,
      getVideo: () => videoElRef.current,
    })
    window.__camstackEmbed = {
      setMuted: (next) => setMuted(next),
      setTarget: (next) => {
        const parsed = embedTargetSchema.safeParse(next)
        if (parsed.success) setTarget(parsed.data)
      },
      setStats: (next) => setStats(next),
      setHighlight: (next) => setHighlight(next),
      setSnapshot: (next) => setSnapshot(next),
      setMic: (on: boolean) => setActiveMicRef.current(on ? deviceId : null),
      fit: fitBox,
      reconnect: () => setReconnectNonce((n) => n + 1),
      // Recorded-playback timeline control (D42): every command is a pointer
      // move on the per-viewer session — the track is the only surface.
      playRecorded: (devId, epochMs, profile) => {
        if (!Number.isFinite(epochMs)) return
        withSession('playRecorded', (current) =>
          current.playRecorded(devId, epochMs, profile),
        )
      },
      playClip: (devId, clipId, provider, offsetMs, profile) => {
        // Every outcome of this call is reported, including the two that used
        // to be silent. A clip that does not play is the operator's report of
        // 2026-09-21, and the app could not tell whether the command had even
        // ARRIVED here: the host injects it into `window.__camstackEmbed`, and
        // when the local embed does not start the app falls back to the hub's
        // copy, which may be a different build entirely.
        //
        // Defensive, exactly as the seek above: a malformed command is a
        // NO-OP, never a guess. An id is the only thing that addresses the
        // file, so an empty one has nothing to play.
        if (
          !Number.isFinite(offsetMs) ||
          typeof clipId !== 'string' ||
          clipId.length === 0 ||
          typeof provider !== 'string' ||
          provider.length === 0
        ) {
          emitHost({
            type: 'log',
            scope: 'clip:play',
            msg: 'playClip REFUSED — the command is malformed',
            data: { deviceId: devId, clipId: String(clipId).slice(0, 120), provider, offsetMs },
          })
          return
        }
        emitHost({
          type: 'log',
          scope: 'clip:play',
          msg: 'playClip arrived',
          data: { deviceId: devId, clipId: clipId.slice(0, 120), provider, offsetMs, profile: profile ?? null },
        })
        const sent = withSession('playClip', (current) =>
          current.playClip(devId, clipId, provider, offsetMs, profile),
        )
        // Held, not dropped: the channel opens a beat after the video track,
        // and a command lost in that gap leaves the operator on the live edge
        // with nothing to retry it.
        pendingClipRef.current = sent
          ? null
          : { deviceId: devId, clipId, provider, offsetMs, ...(profile !== undefined ? { profile } : {}) }
        emitHost({
          type: 'log',
          scope: 'clip:play',
          msg: sent ? 'playClip sent to the broker' : 'playClip HELD — no open session yet',
          data: { deviceId: devId, sent },
        })
      },
      seek: (epochMs) => {
        // Defensive: a malformed command (missing epoch) must be a NO-OP.
        if (!Number.isFinite(epochMs)) return
        // A bare seek (heatmap tap, date change) is "play from here": send it
        // as playRecorded so it carries the PLAYBACK profile — a plain seek
        // would inherit whatever the server profile last was (a scrub pinned
        // `low`), and the tap would play at thumbnail quality.
        withSession('seek', (current) => {
          // On a FILE the seek is the wire's own `seek`, file-relative, which
          // the broker routes to the clip feeder. `playRecorded` would LEAVE
          // the clip (that is the server's `leaveClip` message), and there is
          // no tier to climb to afterwards — the session refuses the climb
          // by name if asked.
          if (current.holdsClip()) return current.seek(epochMs)
          const ok = current.playRecorded(deviceId, epochMs, playbackProfile())
          if (ok) climbAfterProbe(current, epochMs)
          return ok
        })
      },
      scrubCommit: (epochMs, dragId) => {
        if (!Number.isFinite(epochMs)) return
        releaseScrub(epochMs, dragId)
      },
      // Drag: the server pushes the keyframe train on the visible WebRTC track.
      // Without an open session there is no alternate scrub engine.
      scrubStart: (dragId) => {
        emitHost({
          type: 'log',
          scope: 'recorded:scrub',
          msg: 'scrubStart',
          data: { dragId },
        })
        withSession('scrubStart', (current) => current.begin(dragId))
      },
      scrubTo: (epochMs, m, v) => {
        if (!Number.isFinite(epochMs)) return
        // Both halves or neither: a mode without its velocity would put a
        // guessed number into the hub's per-drag percentiles (the server
        // drops half-hints the same way).
        const hint =
          (m === 'fine' || m === 'coarse') && Number.isFinite(v)
            ? { mode: m, velocityPxPerS: v as number }
            : undefined
        withSession('scrubTo', (current) => {
          if (!current.isActive()) return false
          current.retarget(epochMs, hint)
          return true
        })
      },
      timelineWarm: (epochMs) => {
        if (!Number.isFinite(epochMs)) return
        // Fire-and-forget cache fill — deliberately NOT withSession: warming
        // must be silent when the session is not up yet (the timeline can
        // open before the data channel), never an error state.
        session()?.warm(epochMs)
      },
      scrubEnd: (epochMs) => {
        if (!Number.isFinite(epochMs)) return
        // Same as scrubCommit: one pointer move from drag to playback.
        releaseScrub(epochMs)
      },
      setRate: (rate) => {
        // Defensive: a malformed command (missing rate) must be a NO-OP.
        if (!Number.isFinite(rate)) return
        withSession('setRate', (current) => current.setRate(rate))
      },
      stepFrame: (dir) => {
        if (dir !== 1 && dir !== -1) return
        withSession('stepFrame', (current) => current.stepFrame(dir))
      },
      // Go-live: one pointer move — the broker ungates the live feed and
      // replays the GOP pre-buffer from its keyframe, so live resumes
      // decodable immediately on the SAME track.
      goLive: () => {
        // Leaving the clip un-holds it: a pending assert that fired after this
        // would drag the pointer back into a file the operator has left.
        pendingClipRef.current = null
        if (withSession('goLive', (current) => current.goLive())) {
          emitHost({ type: 'recState', state: 'live' })
        }
      },
      startLiveCapture: () => capture.start(),
      stopLiveCapture: () => capture.stop(),
      snapshot: (id) => takeSnapshot({ emit: emitHost, getVideo: () => videoElRef.current }, id),
    }
    return () => {
      capture.abort()
      if (window.__camstackEmbed) delete window.__camstackEmbed
    }
    // deviceId is stable for the lifetime of this player; fitBox is stable.
  }, [deviceId, fitBox])

  // Report the intercom (talk-back) state to the host whenever it changes.
  useEffect(() => {
    emitHost({ type: 'micState', state: intercom.micState })
  }, [intercom.micState])

  // Web (iframe) command channel: route `embed-command` messages to the SAME
  // handlers the native host drives via injected JS. Dormant on native (no
  // embed-command messages are posted there).
  useEffect(
    () =>
      onHostCommand((command) => {
        const api = window.__camstackEmbed
        if (!api) return
        const kind = command.kind as string
        switch (kind) {
          case 'setMuted':
            api.setMuted(command.value as boolean)
            break
          case 'setTarget':
            api.setTarget(command.value as Parameters<typeof api.setTarget>[0])
            break
          case 'setStats':
            api.setStats(command.value as boolean)
            break
          case 'setHighlight':
            api.setHighlight(command.value as Parameters<typeof api.setHighlight>[0])
            break
          case 'setSnapshot':
            api.setSnapshot(command.value as string)
            break
          case 'setMic':
            api.setMic(command.value as boolean)
            break
          case 'fit':
            api.fit(command.w as number, command.h as number)
            break
          case 'reconnect':
            api.reconnect()
            break
          case 'playRecorded':
            api.playRecorded(
              command.deviceId as number,
              command.epochMs as number,
              command.profile as string,
            )
            break
          // Epoch-carrying commands: the RN host injects `epochMs` (see
          // LiveViewWebView), NOT `value` — reading only `value` passed
          // `undefined` epochs through to the feeder, which then seeked to an
          // arbitrary point (live-diagnosed 2026-07-17: heatmap tap landing on
          // a completely different recording moment; scrub commits no-oping).
          // `value` is kept as a fallback for any legacy sender.
          case 'seek':
            api.seek((command.epochMs ?? command.value) as number)
            break
          case 'scrubCommit':
            api.scrubCommit(
              (command.epochMs ?? command.value) as number,
              command.dragId as string | undefined,
            )
            break
          case 'scrubStart':
            api.scrubStart(command.dragId as string | undefined)
            break
          case 'scrubTo':
            api.scrubTo(
              (command.epochMs ?? command.value) as number,
              command.m as 'fine' | 'coarse' | undefined,
              command.v as number | undefined,
            )
            break
          case 'scrubEnd':
            api.scrubEnd((command.epochMs ?? command.value) as number)
            break
          case 'timelineWarm':
            api.timelineWarm((command.epochMs ?? command.value) as number)
            break
          case 'setRate':
            api.setRate((command.rate ?? command.value) as number)
            break
          case 'stepFrame': {
            // Accept dir strictly as 1 | -1; anything else is a no-op.
            const dir = command.dir
            if (dir === 1 || dir === -1) api.stepFrame(dir)
            break
          }
          case 'goLive':
            api.goLive()
            break
          case 'startLiveCapture':
            api.startLiveCapture()
            break
          case 'stopLiveCapture':
            api.stopLiveCapture()
            break
          case 'snapshot':
            if (typeof command.id === 'string') api.snapshot(command.id)
            break
          default:
            break
        }
      }),
    [],
  )

  const key = targetKey(target)

  return (
    <div
      ref={surfaceRef}
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: box.w,
        height: box.h,
        background: THEME.dark.mediaBlack,
      }}
    >
      <CameraStreamPlayer
        serverUrl={system.serverUrl}
        applyDownlinkProbe={applyDownlinkProbe}
        streamKey={key}
        autoPlay
        // D42: recorded audio rides the SAME track as live (the feeder pushes
        // it on the shared audio sender), so the single mute owner covers
        // every mode — there is no second audio path to silence.
        muted={muted}
        // The native app draws its own chrome — no toolbar/overlay/controls.
        showControls={false}
        showStats={stats}
        // The numbers also travel OUT, once a second, to whoever hosts this
        // page. In the native app the overlay below cannot be opened at all —
        // the RN gesture layer owns the touches over this WebView — so the host
        // renders them in its own status card instead. On the web the overlay
        // is still the surface and this costs one postMessage a second.
        onDebugStats={(sample) =>
          emitHost({ type: 'log', scope: 'stream-debug', msg: 'sample', data: sample })
        }
        // Recorded playback census (getStats + video clock). Always shipped
        // via the host (`embed:playback`) — not gated on debug mode.
        onPlaybackStats={(data) => emitHost({ type: 'log', scope: 'playback', msg: 'stats', data })}
        // Cold-start phase breakdown → the host log (once per connect + once on
        // first decoded frame). This is the number the "stream takes ~10s"
        // investigation reads — without the bridge it dies in the WebView console.
        onConnectTiming={(timing) =>
          emitHost({
            type: 'log',
            scope: 'webrtc-timing',
            msg: 'connect',
            data: timing,
          })
        }
        // Report the client's live network conditions to the broker so the
        // ADAPTIVE ladder can downgrade "auto" under a poor link. Only relevant
        // for adaptive sessions (a pinned profile ignores the ladder).
        onClientNetworkSample={
          target.kind === 'adaptive'
            ? (sample) => {
                void system.trpcClient.networkQuality.reportClientStats
                  .mutate({ deviceId, ...sample })
                  .catch(() => {
                    /* best-effort telemetry — a dropped sample just delays a tier change */
                  })
              }
            : undefined
        }
        // D635: the downlink probe needs a session; a `file://` page has no
        // cookie, so the config's bearer rides along. Absent it, the probe
        // reads unknown and the live ladder never climbs past its try.
        probeAuthToken={probeAuthToken}
        className="w-full h-full"
        onAdaptiveHints={(report) => {
          adaptiveSentRef.current = report
          emitAdaptiveLine()
        }}
        handleOffer={playerHandleOffer}
        reoffer={playerReoffer}
        getSessionState={getSessionState}
        getSessionDebug={getSessionDebug}
        getIceServers={getIceServers}
        addIceCandidate={addIceCandidate}
        getIceCandidates={getIceCandidates}
        closeSession={closeSession}
        reconnectSignal={reconnectNonce}
        posterUrl={snapshot}
        onStateChange={(s) => {
          setPlayerState(s)
          postState(toReportState(s))
        }}
        onError={(message) => postState('error', message)}
        // Every auto-retry attempt (and the exhaustion edge) ships to the hub
        // log pipeline tagged with this camera (`setLogDeviceTag`) — a retry
        // loop nobody can see is how a camera stays dark while looking busy.
        onReconnectAttempt={(action) =>
          emitHost({
            type: 'log',
            scope: 'live:retry',
            msg: action.kind === 'retry' ? 'auto-retry scheduled' : 'auto-retry exhausted',
            data: action,
          })
        }
        // The push-scrub transport: the control channel on THIS PeerConnection
        // (client-created, so it is negotiated into the offer). Each reconnect
        // builds a fresh connection + channel — replace the session with it.
        onControlChannel={(channel) => {
          recordedSessionRef.current?.dispose()
          sessionGapReportedRef.current = false
          recordedSessionRef.current = new RecordedTrackSession({
            channel,
            video: () => videoElRef.current,
            // Server playback state + playhead ride the same channel — the
            // page just forwards them to the host chrome.
            onState: (state) => emitHost({ type: 'recState', state }),
            onPosition: (epochMs) => emitHost({ type: 'position', positionMs: epochMs }),
            onServedProfile: (served) =>
              emitHost({ type: 'servedProfile', profile: served.profile, requested: served.requested }),
            // The clip's REAL length, measured by the broker from the file's
            // own index and named by clip — the host draws its progress
            // against this, never against the camera's catalog row (which
            // freezes while a file is still growing).
            onClipDuration: (report) =>
              emitHost({ type: 'clipDuration', clipId: report.clipId, durationMs: report.durationMs }),
            // Whether the clip is carrying sound, and why not (D600, D621).
            // Re-sent by the broker whenever the rate crosses 1×, so the host
            // can tell a clip the SPEED silenced from one whose stream broke.
            onClipAudio: (report) => emitHost({ type: 'clipAudio', ...report }),
            // The camera cut this replay short (D623). One message, at the end
            // of the stream, relayed exactly as it arrived: the host names the
            // clip it is about and draws the hub's own sentence — there is no
            // retry, and nothing here re-words a measurement it did not make.
            onClipIncomplete: (report) => emitHost({ type: 'clipIncomplete', ...report }),
            onLiveProfile: (profile) => {
              liveProfileRef.current = profile
              emitAdaptiveLine()
            },
            onFirstFrame: () => emitHost({ type: 'scrubDrawn' }),
            onLog: (msg, data) =>
              emitHost({
                type: 'log',
                scope: msg.startsWith('playback:') ? 'playback' : 'scrub',
                msg,
                data,
              }),
          })
          /**
           * Put the pointer on the clip that is WAITING for a channel.
           *
           * Two can be waiting, for the same reason: a config-carried one
           * (deep link) and one the host asserted while the channel was still
           * negotiating. `playClip` rides the data channel, and this callback
           * fires right after `createDataChannel` — BEFORE the offer — so the
           * channel is `connecting` here, not open. The old comment claimed
           * this was "the channel's open edge"; it is the creation edge, and
           * that is exactly why the deep-link path had a
           * "NOT opened — no session yet" branch it could not recover from.
           *
           * So it is tried now (harmless, and correct on a reconnect where the
           * channel is already up) and again on the channel's real `open`.
           */
          const assertWaitingClip = (): void => {
            const session = recordedSessionRef.current
            if (session === null) return
            const initial = initialClipRef.current
            if (initial !== null) {
              const sent = session.playClip(deviceId, initial.clipId, initial.provider, 0, initial.profile)
              emitHost({
                type: 'log',
                scope: 'clip:play',
                msg: sent ? 'initial clip opened' : 'initial clip still waiting for the channel',
                data: { deviceId, clipId: initial.clipId.slice(0, 120), sent },
              })
              if (sent) initialClipRef.current = null
              return
            }
            const held = pendingClipRef.current
            if (held === null) return
            const sent = session.playClip(
              held.deviceId,
              held.clipId,
              held.provider,
              held.offsetMs,
              held.profile,
            )
            emitHost({
              type: 'log',
              scope: 'clip:play',
              msg: sent ? 'held clip asserted on the open channel' : 'held clip still waiting',
              data: { deviceId: held.deviceId, clipId: held.clipId.slice(0, 120), sent },
            })
            if (sent) pendingClipRef.current = null
          }
          // The channel's REAL open edge. Without it a clip tapped while the
          // player was coming up is lost: the video track reaches `playing`
          // first, the host asserts on that, and the command arrives with
          // nothing to carry it.
          channel.addEventListener('open', assertWaitingClip)
          assertWaitingClip()
          if (initialSeekRef.current !== null) {
            const fire = (): void => {
              const pending = initialSeekRef.current
              if (pending === null) return
              const profile = resolvePlaybackProfile(targetRef.current, liveProfileRef.current)
              if (fireInitialSeek(recordedSessionRef.current, deviceId, pending, profile)) {
                initialSeekRef.current = null
                if (recordedSessionRef.current) {
                  climbRecordedAfterProbe(
                    recordedSessionRef.current,
                    deviceId,
                    pending,
                    targetRef.current,
                  )
                }
                emitHost({
                  type: 'log',
                  scope: 'recorded:initial-seek',
                  msg: 'config-carried seek fired',
                  data: { epochMs: pending, profile },
                })
              }
            }
            if (channel.readyState === 'open') fire()
            else channel.addEventListener('open', fire, { once: true })
          }
        }}
        onVideoElement={(el) => {
          videoElRef.current = el
        }}
      />

      {highlightType &&
        (() => {
          const ap = highlight?.appearance
          const color =
            highlightType === 'motion'
              ? (ap?.motionColor ?? highlightFallback('motion', kindPalette))
              : highlightType === 'audio'
                ? (ap?.audioColor ?? highlightFallback('audio', kindPalette))
                : (ap?.detectionColor ?? highlightFallback('detection', kindPalette))
          const width = ap?.thickness ?? 3
          return (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                border: `${width}px solid ${color}`,
                boxShadow: `inset 0 0 12px ${color}`,
                pointerEvents: 'none',
                // GPU-promote so it composites ABOVE the WebKit video layer.
                transform: 'translateZ(0)',
              }}
            />
          )
        })()}
    </div>
  )
}

// ── Page entry ───────────────────────────────────────────────────────────────

export function EmbedPlayerPage() {
  // Config IN: native resolves synchronously from the injected global; web does
  // the `embed-ready`→`embed-config` handshake (null while in flight).
  const configResult = useEmbedConfig('player', () => window.__CAMSTACK_EMBED__, parseEmbedConfig)

  // In-place camera swap (`setDevice`): the host changes the camera on this
  // ALREADY-BOOTED page instead of loading a fresh one — the SDK system
  // (WebSocket), query client and TURN cache survive; only the player
  // component remounts (via `key`), which recreates the video element so the
  // previous camera's last frame can never linger across the swap.
  const [swap, setSwap] = useState<SetDeviceCommand | null>(null)
  // Live access token — boot config, then every host `setToken` push (D812).
  // Kept on the PAGE so a camera swap never reverts to the expired boot JWT.
  const [authToken, setAuthToken] = useState<string | null>(null)
  const systemRef = useRef<System | null>(null)
  const authTokenRef = useRef<string | null>(null)
  authTokenRef.current = authToken

  const applyToken = (raw: unknown): void => {
    if (typeof raw !== 'string' || raw.length === 0) return
    if (authTokenRef.current === raw) return
    const system = systemRef.current
    if (system === null) return
    system.setToken(raw)
    // WS connectionParams are sent once at handshake — without reconnect the
    // socket keeps the expired access token and dies at the 2 h mark.
    system.reconnect()
    setAuthToken(raw)
  }

  useEffect(() => {
    const applyDevice = (raw: unknown): void => {
      const cmd = parseSetDeviceCommand(raw)
      if (cmd) setSwap(cmd)
    }
    window.__camstackEmbedPage = { setDevice: applyDevice, setToken: applyToken }
    // Web (iframe) path: the same commands arrive as `embed-command`
    // messages. Dormant on native (commands are injected JS there).
    const offWeb = onHostCommand((command) => {
      if (command.kind === 'setDevice') {
        applyDevice(command.value)
        return
      }
      if (command.kind === 'setToken') {
        applyToken(command.value)
      }
    })
    return () => {
      if (window.__camstackEmbedPage) delete window.__camstackEmbedPage
      offWeb()
    }
  }, [])

  // Build the SDK + a dedicated React-Query client from the resolved token.
  // Torn down on unmount so the WebSocket doesn't leak when the WebView
  // navigates away.
  const built = useMemo(() => {
    if (configResult === null || !configResult.ok) return null
    const system = createSystem({
      serverUrl: configResult.config.serverUrl,
      token: configResult.config.token,
    })
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
      },
    })
    return { system, queryClient }
  }, [configResult])

  useEffect(() => {
    if (!built) {
      systemRef.current = null
      return
    }
    systemRef.current = built.system
    if (configResult !== null && configResult.ok) {
      setAuthToken(configResult.config.token)
    }
    return () => {
      built.system.close()
      systemRef.current = null
    }
  }, [built, configResult])

  // Web handshake in flight — render nothing (the host shows its own loader).
  // Native is non-null on first render (sync global), so this never shows there.
  if (configResult === null) return null
  if (!configResult.ok) {
    return <EmbedError message={configResult.error} />
  }
  if (!built) {
    return <EmbedError message="Failed to initialise the embed player" />
  }

  // Effective per-camera view: the boot config until a swap arrives, then the
  // swap's values (falling back to the boot config where the swap is silent).
  const effectiveDeviceId = swap?.deviceId ?? configResult.config.deviceId
  const effectiveTarget = swap?.target ?? configResult.config.target
  const effectiveMuted = swap?.muted ?? configResult.config.muted
  const effectiveStats = swap?.stats ?? configResult.config.stats ?? false
  const effectiveSnapshot = swap !== null ? swap.snapshot : configResult.config.snapshot
  const liveToken = authToken ?? configResult.config.token

  return (
    <SystemProvider system={built.system}>
      <QueryClientProvider client={built.queryClient}>
        <trpc.Provider client={built.system.trpcClient} queryClient={built.queryClient}>
          <PaletteBridge system={built.system} />
          <EmbedPlayer
            // The swap contract: a deviceId change REMOUNTS the player (fresh
            // video element — no stale frame) while everything above this line
            // (system/WS, query client) is reused.
            key={effectiveDeviceId}
            system={built.system}
            probeAuthToken={liveToken}
            deviceId={effectiveDeviceId}
            initialTarget={effectiveTarget}
            initialMuted={effectiveMuted}
            initialStats={effectiveStats}
            initialHighlight={configResult.config.highlight}
            initialSnapshot={effectiveSnapshot}
            // The instant comes from the BOOT CONFIG before any swap, and from
            // the SWAP COMMAND after one — never from the boot config once a
            // swap has happened.
            //
            // That last clause is the invariant this line has always carried:
            // the boot `initialSeekMs` was chosen for the camera the page was
            // OPENED for, and applying it to a different camera would seek B to
            // an instant meant for A. A swap used to open LIVE unconditionally
            // to guarantee that, and the guarantee survives unchanged — what
            // changed (2026-09-12, D483) is that the host may now pass an
            // instant WITH the swap, because the operator's gesture means
            // "camera B at the moment I am looking at". A leaked instant is
            // still the defect; an argued one is the feature. `swap.atMs` is
            // absent for a swap that means "just show me this camera", and then
            // the new camera opens live exactly as before.
            initialSeekMs={swap === null ? configResult.config.initialSeekMs : swap.atMs}
          />
        </trpc.Provider>
      </QueryClientProvider>
    </SystemProvider>
  )
}
