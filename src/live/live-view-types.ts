/**
 * Shared LiveView contract — the SINGLE source of truth for the props and the
 * imperative handle of the live player, imported by every implementation
 * (`LiveView.tsx`, `LiveViewWebView.tsx`, `LiveView.web.tsx`).
 *
 * Keeping these here (rather than in any one impl) avoids circular imports and
 * guarantees all variants expose an IDENTICAL contract, so consumers
 * (`CameraDetailScreen`, `GridTile`) compile unchanged regardless of which
 * implementation Metro selects.
 */
import type {
  ClipAudioReport,
  ClipDurationReport,
  ClipIncompleteReport,
  ServedProfileReport,
} from '../recording/recording-messages.js'
import type { StyleProp, ViewStyle } from 'react-native'
import type { FrameSnapshot } from './frame-snapshot-protocol.js'
import type { WebrtcTarget } from './signaling-types.js'
import type { PipStartResult } from './pip-request.js'
import type { GridHighlightEmbedConfig } from '../grid-embed/embed-config.js'
import type { PlaybackMode } from '../recording/playback-status.js'

/** The player's connection lifecycle, as the embed reports it. */
export type PlayerConnectionState = 'connecting' | 'playing' | 'error'

/**
 * A lifecycle transition together with WHY, when there is a why.
 *
 * State and reason travel as ONE object on purpose: forwarded separately they
 * arrive in separate renders, and a reason rendered against the wrong state
 * reads as a failure that is not happening.
 */
export interface PlayerStatus {
  readonly state: PlayerConnectionState
  /** Failure text as the embed reported it (or the host's own, for a surface
   *  that never loaded). Only meaningful with `state: 'error'`. */
  readonly reason?: string
}

export interface LiveViewProps {
  readonly deviceId: number
  readonly target?: WebrtcTarget
  /** When true, the remote audio is muted. Defaults to muted — surveillance
   *  live view starts silent until the user opts in. */
  readonly muted?: boolean
  /** Optional animated transform applied to the inner video (pinch-to-zoom).
   *  Owned by the parent (reanimated shared values). */
  readonly videoStyle?: StyleProp<ViewStyle>
  /** Show the WebView player's in-embed client-side stats overlay (option A).
   *  Ignored by the native player (it uses the getStats handle + overlay). */
  readonly showStats?: boolean
  /** Per-camera highlight config rendered INSIDE the WebView embed (a native
   *  border is occluded by the video's compositing layer on iOS). Ignored by the
   *  native player (it draws the border natively). */
  readonly highlight?: GridHighlightEmbedConfig
  /** Deep-link "go to this moment" (`?at=` → epoch ms), carried INSIDE the
   *  embed config: a NEW embed enters recorded at this instant the moment its
   *  control channel opens (no host round-trip). The host keeps its deferred
   *  RN-bridge seek as the fallback for an OLD embed that ignores the field —
   *  see CameraDetailScreen. Consumed at page load: pass `undefined` once the
   *  seek has settled so retries/remounts (e.g. Go-Live) never re-seek. */
  readonly initialSeekMs?: number
  /**
   * A CLIP the page must open on instead of live.
   *
   * Carried in the config rather than injected after mount because a held
   * camera has no player to inject into — and mounting one that dials live
   * would wake a sleeping camera, which is the whole reason the gate keeps it
   * down. With this the page enters the FILE on its first channel.
   */
  readonly initialClip?: {
    readonly clipId: string
    readonly provider: string
    readonly profile?: string
  }
  /** Recorded-playback state reported by the embed (page → host). Only the iOS
   *  WebView player drives this today; other variants never call it. */
  readonly onPlaybackState?: (mode: PlaybackMode) => void
  /**
   * LIVE connection lifecycle reported by the embed (page → host):
   * `connecting` until the first frame paints, then `playing`, and `error` with
   * a reason on a hard failure.
   *
   * The player already knew this and kept it to itself — it drew a discreet
   * CORNER spinner, deliberately moved out of the centre because the old
   * centred indicator sat underneath the on-video play/pause disc. Surfacing it
   * lets the host ring that disc instead, which is where an operator looks when
   * a stream is slow to start.
   *
   * A host that takes this callback OWNS both indicators: the player draws no
   * spinner and no error card of its own, because the camera-detail screen lays
   * a full-bleed gesture layer over the video and anything drawn under it is
   * visible but untouchable (the operator's "pulsante non cliccabile").
   */
  readonly onPlayerState?: (status: PlayerStatus) => void
  /** Recorded playhead position (epoch ms) reported by the embed (page → host). */
  readonly onPosition?: (epochMs: number) => void
  /**
   * Live capture failed before Stop (no MediaRecorder, no video element, …).
   * The host bar is already showing a recording state; this lets it drop it.
   */
  readonly onLiveCaptureError?: (message: string) => void
  /** The embed rendered the FIRST pushed scrub frame of the current drag
   *  (page → host). Lets the host drop its instant sprite placeholder once the
   *  WebRTC track is showing the requested footage. */
  readonly onScrubDrawn?: () => void
  /** The recorded tier the embed is really playing, next to the one it asked
   *  for (page → host). Null-free: the embed reports every change. */
  readonly onServedProfile?: (served: ServedProfileReport) => void
  /**
   * The REAL length of the clip the pointer is on (page → host), measured by
   * the broker from the file's own index and named by clip. While a clip holds
   * the pointer, `onPosition` reports FILE-RELATIVE milliseconds against this
   * length — the parameter is still called `epochMs` there, and the name lies.
   */
  readonly onClipDuration?: (report: ClipDurationReport) => void
  /**
   * Whether the clip the pointer is on is carrying SOUND, and why not when it
   * is not (page → host, D600/D621). Re-issued by the broker whenever the rate
   * crosses 1×, which is what lets the host tell a clip the SPEED silenced
   * from one whose stream broke — before D621 they were the same silence.
   */
  readonly onClipAudio?: (report: ClipAudioReport) => void
  /**
   * The clip the pointer is on was served SHORT, or not at all (page → host,
   * D623). One message, when the stream ENDS.
   *
   * NOT a failure of the player: the clip played, it was simply cut off by the
   * camera. A host that takes this draws the hub's sentence as chrome and
   * leaves the picture alone — moving the player to `error` would tear down a
   * surface that is showing perfectly good footage in order to complain about
   * it, and a retry would contend for the camera's single replay lane.
   */
  readonly onClipIncomplete?: (report: ClipIncompleteReport) => void
  /**
   * The host injected an in-place WebRTC reconnect (AppState foreground or a
   * network transition). Recorded playback must re-enter via `playRecorded` at
   * the machine playhead — the peer alone restores live, not the feeder.
   */
  readonly onPeerReconnect?: () => void
}

/** A snapshot of live-stream health for the on-screen stats overlay. Fields are
 *  optional because availability differs per player: the NATIVE WebRTC player
 *  reports the full set from `RTCPeerConnection.getStats()`; the WebView player
 *  can only read HTMLVideoElement playback quality (the embed's peer isn't
 *  exposed), so it fills `resolution`/`fps`/`dropped`/`total` and `source:'playback'`. */
export interface StreamStats {
  /** Where the numbers came from — drives which fields the overlay shows. */
  readonly source: 'webrtc' | 'playback'
  /** "1920x1080" (decoded frame size). */
  readonly resolution?: string
  /** Frames per second (decoded/rendered). */
  readonly fps?: number
  /** Receive bitrate in kbps (webrtc only). */
  readonly bitrateKbps?: number
  /** Cumulative packets lost (webrtc only). */
  readonly packetsLost?: number
  /** Jitter in ms (webrtc only). */
  readonly jitterMs?: number
  /** Negotiated/decoder codec, e.g. "H265" (webrtc only). */
  readonly codec?: string
  /** Dropped video frames (playback fallback). */
  readonly dropped?: number
  /** Total video frames seen (playback fallback). */
  readonly total?: number
}

/** Imperative handle exposed to the parent so it can drive native iOS PiP on the
 *  SAME single stream view (no second WebRTC session) and read live stats. */
export interface LiveViewHandle {
  /**
   * Start system Picture-in-Picture for the rendered stream view, and report
   * WHETHER IT CAME UP.
   *
   * The answer is not a formality: it is the only evidence a caller has that
   * the window came up, and the `live:pip` trail reads it against every later
   * presentation-mode change (the window closes on its own the moment this
   * surface stops being visible — `screens/camera-detail/pip-handoff.ts`).
   * `unavailable` is a definitive no (no surface, no video, no API, refused);
   * `unconfirmed` means the request is out and the platform has not answered.
   * See `pip-request.ts`.
   */
  startPip(): Promise<PipStartResult>
  /** Sample current stream health for the stats overlay, or null if unavailable
   *  (no active stream yet). Implemented per player. */
  getStats(): Promise<StreamStats | null>
  // ── Recorded-playback control (routed to the player embed control channel) ──
  /** Start recorded playback at `epochMs` for the given stream `profile`. */
  playRecorded(epochMs: number, profile: string): void
  /**
   * Move the playback pointer into a stored CLIP, `offsetMs` from its first
   * sample (D575).
   *
   * Not a second player. A clip is another position of the SAME recorded
   * source pointer — recorded frames already arrive on the live track — so
   * every call after this one (`seek`, `scrubTo`, `setRate`, `stepFrame`)
   * travels on the clip's file-relative axis unchanged, and `goLive` leaves it.
   *
   * `profile` only when the operator's row picked one: a stored file has no
   * broker session to resolve an adaptive tier against, so absent means the
   * provider's own default rather than a tier this side invented.
   */
  playClip(clipId: string, provider: string, offsetMs: number, profile?: string): void
  /** Seek recorded playback to `epochMs`. */
  seek(epochMs: number): void
  /** Begin a scrub drag (suspend background loading until the scrub settles).
   *  `dragId` names the gesture (`scrub-drag-id.ts`) — carried through to its
   *  commit so the hub and the app's own logs can be joined without depending
   *  on either clock. Optional: the hub behaves identically without it. */
  scrubStart(dragId?: string): void
  /** Preview a coarse keyframe at `epochMs` during an in-flight scrub.
   *  `m`/`v` = the px→time mapping hint (`drag-mapping.ts`): mode + velocity,
   *  both or neither — instrumentation the hub aggregates per drag. */
  scrubTo(epochMs: number, m?: 'fine' | 'coarse', v?: number): void
  /** End a scrub drag, settling on a coarse keyframe at `epochMs`. */
  scrubEnd(epochMs: number): void
  /** Commit the scrub target at `epochMs` (decode-accurate resume). `dragId` is
   *  the SAME id the drag's `scrubStart` carried — see there. */
  scrubCommit(epochMs: number, dragId?: string): void
  /** Set playback rate: 0 = paused; (0.25..4] = play at that speed (audio is
   *  dropped server-side at rates ≠ 1). */
  setRate(rate: number): void
  /** Step exactly one frame while paused (server-side AU-exact). */
  stepFrame(dir: 1 | -1): void
  /** Return to the live edge (leave recorded playback). */
  goLive(): void
  /** Pre-warm the server's scrub cache around `epochMs` (safe while live). */
  timelineWarm(epochMs: number): void
  /** Begin capturing the decoded live <video> from this moment. No lookback. */
  startLiveCapture(): void
  /** Stop the capture and return the encoded clip (base64). */
  stopLiveCapture(): Promise<{ mime: string; base64: string }>
  /**
   * The frame on screen — live or recorded — as a JPEG. Rejects when the page
   * has no picture to give, or does not answer (an older cached page).
   */
  captureSnapshot(): Promise<FrameSnapshot>
  /**
   * Rebuild the player surface NOW, resetting the auto-retry budget.
   *
   * The recovery affordance lives on the host's playback bar — outside the
   * video's gesture layer, which is the only place a button can actually be
   * pressed — so the host needs a way back into the player. The auto-retry loop
   * runs regardless; this only makes the next attempt sooner.
   */
  retry(): void
}

/** Method names of `LiveViewHandle`, used as a cheap compile/runtime contract so
 *  every variant exposes an IDENTICAL handle. */
export const LIVE_VIEW_HANDLE_METHODS = [
  'startPip',
  'getStats',
  'playRecorded',
  'playClip',
  'seek',
  'scrubStart',
  'scrubTo',
  'scrubEnd',
  'scrubCommit',
  'setRate',
  'stepFrame',
  'goLive',
  'timelineWarm',
  'retry',
  'startLiveCapture',
  'stopLiveCapture',
  'captureSnapshot',
] as const

/** Default WebRTC target when a consumer does not specify one (adaptive tier). */
export const DEFAULT_TARGET: WebrtcTarget = { kind: 'adaptive' }
