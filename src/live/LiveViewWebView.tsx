/**
 * LiveViewWebView (iOS) — WebRTC live video via the OTA-bundled embed player
 * rendered inside a `WKWebView`.
 *
 * WHY a WebView on iOS: native `react-native-webrtc` (Google libwebrtc) ships no
 * HEVC/H.265 decoder, so H265 cameras render black. WebKit (WKWebView) *does*
 * decode H.265 over WebRTC. So on iOS we can delegate the live stream to a
 * web player loaded in a WebView.
 * This is the ONLY iOS player (the legacy native react-native-webrtc player was
 * removed); web keeps its stub (`LiveView.web.tsx`). `LiveView.tsx` renders this
 * directly — consumers import `LiveView` unchanged.
 *
 * The embed page implements a fixed contract (see EMBED_PATH + the injected
 * `window.__CAMSTACK_EMBED__` config and the `onMessage` state protocol below).
 *
 * TLS caveat: WKWebView enforces ATS and rejects untrusted (self-signed / local)
 * certificates. If `serverUrl` is plain `http://` the page loads fine; with
 * `https://` backed by an untrusted cert WebKit aborts the load and we surface a
 * themed error (we deliberately do NOT bypass cert validation — that would be an
 * insecure workaround). Operators must use a trusted cert or http for the embed.
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useMemo,
  useState,
} from 'react'
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  AppState,
  type AppStateStatus,
  type LayoutChangeEvent,
} from 'react-native'
import { useViewportSize } from '../hooks/use-viewport-size.js'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'
import { useTranslation } from 'react-i18next'
import { RotateCw } from '../lib/icons.js'
import { useServer } from '../app/ServerProvider.js'
import { useStreamDebugStore } from '../store/stream-debug-store.js'
import { isPlaybackStatsReply } from './stream-debug-sample.js'
import { EmbedLogRouter, streamStatsFromSample } from './embed-log-route.js'
import { useLiveHubUrl } from '../connection/use-live-hub-url.js'
import { useTheme } from '../theme/theme-provider.js'
import { StreamPoster } from '../components/camera/StreamPoster.js'
import { RADIUS, SPACING } from '../theme/tokens.js'
import {
  DEFAULT_TARGET,
  type LiveViewHandle,
  type LiveViewProps,
  type PlayerStatus,
  type StreamStats,
} from './live-view-types.js'
import { useHostAutoRetry } from './use-host-auto-retry.js'
import { buildPlayerEmbedConfig, type EmbedConfig } from './embed-player-config.js'
import { playbackCommandToScript, type PlaybackCommand } from './live-control-map.js'
import {
  PIP_REQUEST_SCRIPT,
  PIP_MODE_WATCH_SCRIPT,
  PIP_CONFIRM_TIMEOUT_MS,
  awaitPipConfirmation,
  parsePipModeReport,
  type PipConfirmation,
  type PipStartResult,
} from './pip-request.js'
import { parseRecordingHostMessage } from '../recording/recording-messages.js'
import { LiveCaptureAssembler, parseLiveCapturePayload } from './live-capture-protocol.js'
import { SnapshotBroker, parseSnapshotPayload } from './frame-snapshot-protocol.js'
import type { PlaybackMode } from '../recording/playback-status.js'
// ONE mapper for both hosts — and the one place `ended` stops being an error.
import { mapRecState } from './rec-state.js'
import { useSnapshotLink } from '../data/SnapshotOverviewProvider.js'
import { resolveSnapshotUri } from '../data/snapshot-media-url.js'
import { log } from '../lib/logger.js'
import { markBoot } from '../connection/boot-timeline.js'
import { useNativeEmbedSource } from './use-native-embed-source.js'

/** Cross-fade duration for the poster cover → live video handoff. Long enough
 *  to read as a dissolve, short enough not to delay the first live frame. */
const COVER_FADE_MS = 220

/** Player lifecycle states the embed page reports back over `onMessage`. */
type EmbedState = 'connecting' | 'playing' | 'error'

/** Message shape posted by the embed page (`postMessage`, JSON string). */
interface EmbedMessage {
  readonly type: 'state'
  readonly state: EmbedState
  readonly message?: string
  /** What the PAGE says it can do (D483). Absent ⇒ an older page that
   *  advertises nothing, and every optional capability is treated as missing. */
  readonly caps?: readonly string[]
}

/** Page capability names, matched literally against what the page advertises.
 *  Mirrors `PAGE_CAPABILITIES` in `EmbedPlayerPage`. */
export const PAGE_CAP_SET_DEVICE = 'setDevice'
export const PAGE_CAP_SET_DEVICE_AT = 'setDevice.atMs'
/** Host may push a renewed access token without rebuilding the surface (D812). */
export const PAGE_CAP_SET_TOKEN = 'setToken'

/** Narrow an untrusted parsed `onMessage` payload to a valid `EmbedMessage`. */
function parseEmbedMessage(raw: string): EmbedMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const obj = data as Record<string, unknown>
  if (obj.type !== 'state') return null
  const { state } = obj
  if (state !== 'connecting' && state !== 'playing' && state !== 'error') return null
  const message = typeof obj.message === 'string' ? obj.message : undefined
  const caps = Array.isArray(obj.caps)
    ? obj.caps.filter((c): c is string => typeof c === 'string')
    : undefined
  return { type: 'state', state, message, caps }
}

/** Parse a `{type:'stats'}` playback-quality reply into `StreamStats`, deriving
 *  fps from the totalVideoFrames delta vs the previous sample (`prevRef`). */
function parsePlaybackStats(
  raw: string,
  prevRef: React.MutableRefObject<{ total: number; tsMs: number } | null>,
): StreamStats {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { source: 'playback' }
  }
  if (typeof data !== 'object' || data === null) return { source: 'playback' }
  const o = data as Record<string, unknown>
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
  const w = num(o.w)
  const h = num(o.h)
  const total = num(o.total)
  let fps: number | undefined
  const nowMs = Date.now()
  if (total !== undefined) {
    const prev = prevRef.current
    if (prev && nowMs > prev.tsMs) {
      fps = Math.max(0, Math.round(((total - prev.total) * 1000) / (nowMs - prev.tsMs)))
    }
    prevRef.current = { total, tsMs: nowMs }
  }
  return {
    source: 'playback',
    resolution: w && h ? `${w}x${h}` : undefined,
    fps,
    dropped: num(o.dropped),
    total,
  }
}

/** Parse a `{type:'recState',state}` page→host message. Returns the mapped
 *  `PlaybackMode`, or null on any mismatch (so non-recState payloads fall through). */
function parseRecState(raw: string): PlaybackMode | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const o = data as Record<string, unknown>
  if (o.type !== 'recState' || typeof o.state !== 'string') return null
  return mapRecState(o.state)
}

/** Build the `injectedJavaScriptBeforeContentLoaded` snippet that seeds the
 *  embed config on `window` prior to the page's own scripts running. */
function buildBeforeContentScript(config: EmbedConfig): string {
  // JSON.stringify is safe to inline: it emits a valid JS object literal and
  // escapes any string content (token/serverUrl) inside the injected source.
  return `window.__CAMSTACK_EMBED__ = ${JSON.stringify(config)}; true;`
}

export const LiveViewWebView = forwardRef<LiveViewHandle, LiveViewProps>(function LiveViewWebView(
  {
    deviceId,
    target = DEFAULT_TARGET,
    muted = true,
    videoStyle,
    showStats = false,
    highlight,
    initialSeekMs,
    initialClip,
    onPlaybackState,
    onPlayerState,
    onPosition,
    onLiveCaptureError,
    onScrubDrawn,

    onServedProfile,
    onClipDuration,
    onClipAudio,
    onClipIncomplete,
    onPeerReconnect,
  },
  ref,
) {
  const { token } = useServer()
  const serverUrl = useLiveHubUrl()
  const { colors } = useTheme()
  const { t } = useTranslation()
  const webViewRef = useRef<WebView>(null)
  // State AND its reason as one value: forwarded separately they land in
  // separate renders, and a reason drawn against the wrong state describes a
  // failure that is not happening.
  const [status, setStatus] = useState<PlayerStatus>({ state: 'connecting' })
  const state = status.state
  // Mirror every transition to the host so it can render the indicator — and
  // now the FAILURE — where the operator is looking (see `onPlayerState`).
  // The mirror moved BELOW `shownStatus` — the host bar must be told what the
  // operator is being shown, not the raw state, or it would draw a danger ring
  // for a failure the picture is deliberately still hiding.
  // Once the embed has played once, a reconnect keeps the last frame inside the
  // WebView (the embed shows its own subtle chip) — so the host overlay must NOT
  // re-cover it with opaque black. The full overlay is for the cold start only.
  const [hasPlayed, setHasPlayed] = useState(false)
  // Cold-start phase timestamps (host side): mount → WebView loaded → embed
  // playing. Complements the in-embed [WebRTC timing] bridge — together they
  // attribute a slow start to WebView boot vs signaling/ICE vs decode.
  const mountTsRef = useRef(Date.now())
  // The player's death certificate — the counterpart of the cold-start line
  // above, and the one thing the log did NOT say.
  //
  // System PiP is anchored to THIS WKWebView: unmounting the player releases
  // the web view and, with it, the window. A PiP report can therefore only be
  // read if the moment of the teardown is in the log next to the moment the
  // page confirmed PiP. Written from the cleanup so it is the LAST line this
  // player emits; ships in normal mode (see `ALWAYS_SHIP_SCOPES`).
  useEffect(() => {
    const mountedAt = mountTsRef.current
    return () => {
      log.info('live:lifecycle', 'player torn down — WKWebView released', {
        deviceId,
        aliveMs: Date.now() - mountedAt,
      })
    }
  }, [deviceId])
  /** What the page advertised (D483). Empty until the first state report, and
   *  empty forever for a page too old to advertise — both mean "cannot". */
  const capsRef = useRef<readonly string[]>([])
  /**
   * The camera this WebView is currently SHOWING, which is not necessarily the
   * `deviceId` prop: between a swap being asked for and the page acknowledging
   * it, the two differ. Compared rather than kept in sync automatically,
   * because the whole point of the swap is that the prop can change without the
   * surface being rebuilt.
   */
  const shownDeviceRef = useRef(deviceId)

  const bootLoggedRef = useRef(false)
  // The embed's `{type:'log'}` messages — the SAME router the web host uses.
  const logRouter = useMemo(
    () =>
      new EmbedLogRouter({
        reportSample: (sample) => useStreamDebugStore.getState().report(deviceId, sample),
        info: (scope, msg, data) => log.info(scope, msg, data),
        debug: (scope, msg, data) => log.debug(scope, msg, data),
        nowMs: () => Date.now(),
      }),
    [deviceId],
  )

  // Stats request/response: getStats() injects a playback-quality probe and
  // resolves when the embed posts `{type:'stats'}` back (or times out). fps is
  // derived from the totalVideoFrames delta across calls.
  const statsResolverRef = useRef<((s: StreamStats | null) => void) | null>(null)
  /** The PiP request in flight, waiting for the page's own answer. */
  const pipConfirmRef = useRef<PipConfirmation | null>(null)
  const statsPrevRef = useRef<{ total: number; tsMs: number } | null>(null)
  const captureAssemblerRef = useRef(new LiveCaptureAssembler())
  const snapshotBrokerRef = useRef(new SnapshotBroker())
  const captureWaiterRef = useRef<{
    resolve: (v: { mime: string; base64: string }) => void
    reject: (err: Error) => void
  } | null>(null)

/** How long the injected `fit` keeps looking for the embed's API. */
const FIT_RETRY_MS = 100
const FIT_MAX_TRIES = 30

/**
 * Push a measured box into the embed, retrying until its API exists, and say
 * which happened.
 *
 * The retry lives IN the page rather than in the host because only the page can
 * see `window.__camstackEmbed` appear, and a host-side poll would have to
 * re-inject — one script per attempt — for the same answer.
 */
function fitScript(w: number, h: number): string {
  return `(function(){var t=0;function go(){var a=window.__camstackEmbed;
if(a&&a.fit){a.fit(${w},${h});post({type:'fit-ack',w:${w},h:${h},tries:t});return;}
if(++t>${FIT_MAX_TRIES}){post({type:'fit-unconfirmed',w:${w},h:${h},tries:t});return;}
setTimeout(go,${FIT_RETRY_MS});}
function post(m){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m));}catch(e){}}
go();})(); true;`
}

  // RN-measured WebView frame (authoritative — WKWebView's window.innerHeight is
  // stale on rotation). We push these exact pixels into the embed to size the
  // <video>; kept in a ref so we can re-apply after (re)load / state changes.
  const frameRef = useRef<{ w: number; h: number } | null>(null)
  const containerRef = useRef<View | null>(null)
  const applyFrame = useCallback((): void => {
    const f = frameRef.current
    if (!f) return
    // Size the embed via its own fit() (sets the root box) — NOT a DOM hack that
    // lifts the bare <video> to a max z-index (that occluded the embed's own
    // overlays: stats / highlight border).
    //
    // It used to be one line: `window.__camstackEmbed && …fit(w,h)`. When the
    // page's API was not installed YET — an ordinary race on a slow device, and
    // this runs on `onLoadEnd` — the expression was simply false, nothing
    // happened, and nobody found out: `adoptFrame` dedupes on (w,h), so the box
    // was never pushed again. The embed then rendered against whatever box it
    // had, which is video in the top of the frame with black beneath it, or an
    // image cropped wider than the view. A branch that accepts work and
    // produces nothing is the shape this repo forbids.
    //
    // So the script RETRIES inside the page and REPORTS, and the host acts on
    // the report below.
    webViewRef.current?.injectJavaScript(fitScript(f.w, f.h))
  }, [])
  /**
   * Adopt a measured frame and push it into the embed. Deduped — the same box
   * measured twice must not re-inject.
   */
  const adoptFrame = useCallback(
    (w: number, h: number, why: string): void => {
      if (w <= 0 || h <= 0) return
      const prev = frameRef.current
      if (prev && prev.w === w && prev.h === h) return
      frameRef.current = { w, h }
      // The embed sizes its <video> from these EXACT pixels — `window.innerWidth`
      // inside a WKWebView is stale after a rotation, which is the whole reason
      // `fit()` exists. Keep this line: it is what proved the container was
      // never re-measured on rotation (last fit 430x242, portrait, while the
      // screen already reported a 932pt-wide landscape window).
      log.debug('live', 'webview frame → fit', {
        why,
        w,
        h,
        prevW: prev?.w ?? -1,
        prevH: prev?.h ?? -1,
      })
      applyFrame()
    },
    [applyFrame],
  )

  /**
   * Re-measure on a WINDOW change, because `onLayout` does not fire here.
   *
   * Measured, not assumed: on rotation the screen reported a 932x430 landscape
   * window and `fill: true`, and the LAST `fit` this container ever pushed was
   * 430x242 — the portrait 16:9 box, sent 2.8 s EARLIER. No layout callback
   * arrived in between, so the embed kept sizing its <video> to a portrait box
   * and the picture rotated without expanding.
   *
   * The reason is the box above: in fill mode its height comes from a reanimated
   * style, applied on the UI thread, and a descendant's `onLayout` is not
   * guaranteed to fire for a resize driven that way. Relying on the callback
   * alone is therefore a coin flip. An explicit `measureInWindow` is not.
   *
   * Three probes rather than one: a rotation animates for roughly a third of a
   * second, so measuring immediately reads the OLD frame. The dedupe in
   * `adoptFrame` makes the extra probes free when they agree.
   *
   * `measure`, NOT `measureInWindow`. The zoom transform lives on an ancestor
   * of this container, and `measureInWindow` reports the frame WITH ancestor
   * transforms applied: rotating while zoomed 1.91x measured 1279x719 on a
   * 932pt-wide screen and pushed that into the embed, which resized its video
   * far beyond the surface and stalled the stream for seconds. `measure`
   * reports the view's own layout box, which is what `fit()` wants.
   */
  const { width: winW, height: winH } = useViewportSize()
  useEffect(() => {
    const timers = [0, 180, 420, 900].map((delay) =>
      setTimeout(() => {
        containerRef.current?.measure((_x, _y, w, h) => {
          // Belt and braces: whatever the measurement API does, the player can
          // never be larger than the window. A frame that claims otherwise is a
          // transform that leaked into the measurement, and acting on it is the
          // failure above — so refuse it, and SAY so rather than dropping it in
          // silence.
          if (w > winW + 1 || h > winH + 1) {
            log.debug('live', 'webview frame REFUSED — larger than the window', {
              w: Math.round(w),
              h: Math.round(h),
              winW,
              winH,
            })
            return
          }
          adoptFrame(Math.round(w), Math.round(h), 'window')
        })
      }, delay),
    )
    return () => {
      for (const t of timers) clearTimeout(t)
    }
  }, [winW, winH, adoptFrame])

  const handleLayout = useCallback(
    (e: LayoutChangeEvent): void => {
      adoptFrame(
        Math.round(e.nativeEvent.layout.width),
        Math.round(e.nativeEvent.layout.height),
        'layout',
      )
    },
    [adoptFrame],
  )

  // Cold-start poster for the WebView embed player. The link is signed, so the
  // injected `<img src>` needs no Authorization header — JPEG bytes travel HTTP,
  // not tRPC. Demand is the same `getSnapshotLinks` poll every visible surface
  // already holds (D108); this does not add a second capture trigger.
  //
  // COLD START only. Once the embed has played, a reconnect keeps the last
  // decoded frame rather than reverting to a snapshot.
  const snapshotLink = useSnapshotLink(deviceId, undefined, !hasPlayed)
  const snapshot =
    serverUrl && snapshotLink.row?.url
      ? resolveSnapshotUri({
          serverUrl,
          deviceId,
          lastCapturedAt: snapshotLink.row.capturedAt,
          identityKnown: snapshotLink.row.capturedAt !== null,
          fallbackTick: 0,
          refreshEpoch: 0,
          link: snapshotLink.row.url,
        })
      : null

  // Raced origin (LAN HTTP at home), not the configured tunnel.
  // Single-camera player = the local stream-broker embed in `?mode=player`.
  // Auth always rides in the injected body config, never in the local asset URI.
  const { source, readAccessUri, reportLoadFailure, reportEmbedAlive } = useNativeEmbedSource(serverUrl, 'player')

  const injectedBefore = serverUrl
    ? buildBeforeContentScript(
        buildPlayerEmbedConfig({
          serverUrl,
          token: token ?? '',
          deviceId,
          target,
          muted,
          stats: showStats,
          highlight,
          // Seed the poster only when known at load; later hydration is pushed via
          // setSnapshot below so the injected payload stays small when absent.
          ...(snapshot ? { snapshot } : {}),
          // Deep-link go-to-moment: read by the embed AT LOAD only (like the
          // whole injected config) — the host clears it once settled, so a
          // later reload never re-seeks to a stale instant.
          ...(initialSeekMs !== undefined ? { initialSeekMs } : {}),
          // The clip twin of the line above, and the reason a sleeping camera
          // can play one at all: the page opens ON the file and never dials
          // live. Read at load only, like the rest of this payload.
          ...(initialClip === undefined
            ? {}
            : {
                initialClipId: initialClip.clipId,
                initialClipProvider: initialClip.provider,
                ...(initialClip.profile === undefined ? {} : { initialClipProfile: initialClip.profile }),
              }),
        }),
      )
    : undefined

  // Route a recorded-playback command to the embed's control channel by injecting
  // the guarded script (no-op until the page mounts `window.__camstackEmbed`).
  const inject = useCallback((cmd: PlaybackCommand): void => {
    webViewRef.current?.injectJavaScript(playbackCommandToScript(cmd))
  }, [])

  /** Rebuild the SURFACE: a full WebView reload (fresh page → fresh embed →
   *  fresh session). Heavier than the embed's own in-page reconnect, and the
   *  only cure for a page that failed to load or a script that wedged — the two
   *  failures the in-embed retry loop can never recover from. */
  const rebuildSurface = useCallback((): void => {
    setStatus({ state: 'connecting' })
    webViewRef.current?.reload()
  }, [])

  /**
   * The in-place camera SWAP (D483).
   *
   * The page has been able to do this since before the host could ask
   * (`embed/src/embed/set-device-command.ts`); what was missing is this call.
   * Without it a `deviceId` prop change moved nothing at all — the embed config
   * rides `injectedJavaScriptBeforeContentLoaded` and is read ONCE, at page
   * load — so every camera change had to rebuild the whole surface: a second
   * page boot, WebSocket, auth handshake, config handshake and TURN fetch.
   *
   * The instant rides the command rather than being seeked afterwards, which is
   * what makes the swap flash-free. A swap-then-seek would be exactly the "host
   * round-trip, live-first flash" that config-carried seeking exists to remove
   * (`embed/src/playback/initial-seek.ts`).
   *
   * ## The fallback, and why it is loud
   *
   * A page that does not advertise what this swap needs gets the OLD behaviour:
   * rebuild the surface, whose fresh injected config carries the new camera and
   * the new instant. That is a visible reload, so it is degradation — and a
   * branch that degrades silently is one nobody notices has stopped degrading.
   * It logs at `warn`, which always ships.
   *
   * Note the capability asked for depends on the swap: a swap with no instant
   * only needs `setDevice`, so a page that supports the swap but not the
   * instant still swaps in place for every live→live camera change.
   */
  useEffect(() => {
    if (shownDeviceRef.current === deviceId) return
    const from = shownDeviceRef.current
    shownDeviceRef.current = deviceId
    const needed = initialSeekMs === undefined ? PAGE_CAP_SET_DEVICE : PAGE_CAP_SET_DEVICE_AT
    if (!capsRef.current.includes(needed)) {
      log.warn('live:lifecycle', 'in-place swap unavailable — rebuilding the player', {
        tags: { deviceId },
        from,
        needed,
        advertised: capsRef.current.length,
      })
      rebuildSurface()
      return
    }
    log.info('live:lifecycle', 'camera swapped in place', {
      tags: { deviceId },
      from,
      atMs: initialSeekMs ?? 'live',
    })
    inject({
      kind: 'setDevice',
      deviceId,
      ...(initialSeekMs === undefined ? {} : { atMs: initialSeekMs }),
      muted,
      // The page remounts its player on swap; without `target` it keeps the
      // boot-time adaptive dial and the quality chip lies about the tier.
      target:
        target.kind === 'profile' && target.profile !== undefined
          ? { kind: 'profile', profile: target.profile }
          : { kind: 'adaptive' },
    })
    // The page rebuilds its player for the new camera, so the host's own view
    // of the stream starts over too.
    setStatus({ state: 'connecting' })
  }, [deviceId, initialSeekMs, muted, target, inject, rebuildSurface])


  // Auto-retry in EVERY case, backing off. The manual affordance (now on the
  // host's playback bar) only makes the next attempt sooner.
  const autoRetry = useHostAutoRetry({
    deviceId,
    state,
    reason: status.reason,
    rebuild: rebuildSurface,
  })
  // What the OPERATOR sees. A failure in its first fast retry is presented as
  // connecting: it is about to be retried in two seconds and most of them come
  // back, so a red card would be a question the operator did not need to be
  // asked. A second failure shows through unchanged.
  const shownState = state === 'error' && autoRetry.settling ? 'connecting' : state
  const shownStatus: PlayerStatus = useMemo(
    () => (shownState === status.state ? status : { state: shownState }),
    [shownState, status],
  )
  useEffect(() => {
    onPlayerState?.(shownStatus)
  }, [shownStatus, onPlayerState])
  const handleRetry = autoRetry.retryNow

  useImperativeHandle(
    ref,
    () => ({
      startPip(): Promise<PipStartResult> {
        // System PiP on the embed's <video>. iOS: WebKit presentation mode.
        // Android WebView: standard requestPictureInPicture.
        //
        // The page CONFIRMS it (`PIP_REQUEST_SCRIPT` posts back once the
        // platform has answered) because the caller may be about to unmount
        // this player. No surface to inject into is a definitive no — answered
        // here rather than waited out, or a swipe on an unmounted player would
        // hang for the whole bound and then do nothing.
        const surface = webViewRef.current
        if (!surface) return Promise.resolve('unavailable')
        // Arm the PERSISTENT presentation-mode reporter before asking. The
        // confirmation below answers "did it come up" once and stops
        // listening; this one keeps answering "is it still up", which is the
        // only way a window that came up and then DIED can name its killer —
        // a page-side exit posts `inline`, a host-side teardown posts nothing.
        // Idempotent, so a second swipe does not stack listeners.
        surface.injectJavaScript(PIP_MODE_WATCH_SCRIPT)
        return new Promise<PipStartResult>((resolve) => {
          const confirmation = awaitPipConfirmation((result) => {
            if (pipConfirmRef.current === confirmation) pipConfirmRef.current = null
            resolve(result)
          })
          pipConfirmRef.current = confirmation
          surface.injectJavaScript(PIP_REQUEST_SCRIPT)
          setTimeout(() => confirmation.expire(), PIP_CONFIRM_TIMEOUT_MS)
        })
      },
      getStats(): Promise<StreamStats | null> {
        // The embed measures its own RTCPeerConnection once a second and ships
        // the sample (the status card reads it from `useStreamDebugStore`).
        // A fresh one is the FULL webrtc set — the read-out the operator placed.
        const sampled = streamStatsFromSample(
          useStreamDebugStore.getState().sampleOf(deviceId),
          Date.now(),
        )
        if (sampled !== null) return Promise.resolve(sampled)
        // No usable sample yet (page still booting, or an older embed): fall
        // back to HTMLVideo playback quality (resolution + dropped/total
        // frames). One request → one `{type:'stats'}` reply; times out to null
        // if the video isn't ready.
        return new Promise((resolve) => {
          statsResolverRef.current = resolve
          webViewRef.current?.injectJavaScript(
            `(function(){var v=document.querySelector('video');var o={type:'stats'};` +
              `if(v){o.w=v.videoWidth;o.h=v.videoHeight;` +
              `if(typeof v.getVideoPlaybackQuality==='function'){var q=v.getVideoPlaybackQuality();` +
              `o.dropped=q.droppedVideoFrames;o.total=q.totalVideoFrames;}}` +
              `window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(o));})(); true;`,
          )
          setTimeout(() => {
            if (statsResolverRef.current === resolve) {
              statsResolverRef.current = null
              resolve(null)
            }
          }, 700)
        })
      },
      playRecorded: (epochMs: number, profile: string): void =>
        inject({ kind: 'playRecorded', deviceId, epochMs, profile }),
      playClip: (clipId: string, provider: string, offsetMs: number, profile?: string): void => {
        // The last app-side hop before the page. The embed reports its own
        // side (`clip:play`); this line is what tells the two apart when the
        // command is injected and nothing answers — which is the case the
        // operator has been hitting.
        log.info('clips', 'open: inject', { deviceId, clipId, provider, offsetMs, profile: profile ?? null })
        inject({
          kind: 'playClip',
          deviceId,
          clipId,
          provider,
          offsetMs,
          ...(profile === undefined ? {} : { profile }),
        })
      },
      seek: (epochMs: number): void => inject({ kind: 'seek', epochMs }),
      scrubStart: (dragId?: string): void => inject({ kind: 'scrubStart', dragId }),
      scrubTo: (epochMs: number, m?: 'fine' | 'coarse', v?: number): void =>
        inject({ kind: 'scrubTo', epochMs, m, v }),
      scrubEnd: (epochMs: number): void => inject({ kind: 'scrubEnd', epochMs }),
      scrubCommit: (epochMs: number, dragId?: string): void =>
        inject({ kind: 'scrubCommit', epochMs, dragId }),
      setRate: (rate: number): void => inject({ kind: 'setRate', rate }),
      stepFrame: (dir: 1 | -1): void => inject({ kind: 'stepFrame', dir }),
      goLive: (): void => inject({ kind: 'goLive' }),
      timelineWarm: (epochMs: number): void => inject({ kind: 'timelineWarm', epochMs }),
      startLiveCapture: (): void => inject({ kind: 'startLiveCapture' }),
      stopLiveCapture: (): Promise<{ mime: string; base64: string }> =>
        new Promise((resolve, reject) => {
          captureWaiterRef.current = { resolve, reject }
          inject({ kind: 'stopLiveCapture' })
          setTimeout(() => {
            if (captureWaiterRef.current?.reject === reject) {
              captureWaiterRef.current = null
              reject(new Error('capture timeout'))
            }
          }, 15_000)
        }),
      captureSnapshot: () =>
        snapshotBrokerRef.current.request((id) => inject({ kind: 'snapshot', id })),
      // The host bar's recovery control — see `LiveViewHandle.retry`.
      retry: handleRetry,
    }),
    [inject, deviceId, handleRetry],
  )

  // Fast reconnect WITHOUT reloading the WebView: the embed bumps the player's
  // reconnectSignal, so it tears down + reconnects while KEEPING its last
  // decoded frame on screen (no black flash, no full-cover loader). A reload
  // would blank the <video> + re-boot the embed SPA — reserved for manual retry.
  const reconnect = useCallback((): void => {
    log.debug('live:reconnect', 'inject reconnect()')
    webViewRef.current?.injectJavaScript(
      `window.__camstackEmbed && window.__camstackEmbed.reconnect && window.__camstackEmbed.reconnect(); true;`,
    )
  }, [])

  // Self-heal after backgrounding: iOS suspends the WKWebView (and kills its
  // WebRTC peer) while in the background; on return the embed page's JS resumes
  // but its peer is dead. Reconnect (keep the last frame) rather than reload
  // (blank) — the embed SPA survived the suspend; only the peer needs rebuilding.
  const appStateRef = useRef<AppStateStatus>(AppState.currentState)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appStateRef.current
      appStateRef.current = next
      if (next === 'active' && (prev === 'background' || prev === 'inactive')) {
        log.info('live', 'foreground → reconnect', { prev })
        reconnect()
        onPeerReconnect?.()
      }
    })
    return () => sub.remove()
  }, [reconnect, onPeerReconnect])

  // Self-heal on a network transition (Wi-Fi↔cellular, or offline→online): the
  // old ICE path is dead once the interface changes, so trigger a fast
  // reconnect (keep the last frame). Act only on a MEANINGFUL transition —
  // becoming reachable, or the transport type changing — so steady-state
  // NetInfo chatter (signal strength etc.) doesn't churn the peer.
  const netRef = useRef<{ isConnected: boolean | null; type: string } | null>(null)
  useEffect(() => {
    const onChange = (s: NetInfoState): void => {
      const prev = netRef.current
      const cur = { isConnected: s.isConnected, type: s.type }
      netRef.current = cur
      if (!prev) return // seed the baseline on the first emission; don't reconnect
      const becameReachable = prev.isConnected !== true && cur.isConnected === true
      const transportChanged = cur.isConnected === true && prev.type !== cur.type
      if (becameReachable || transportChanged) {
        log.info('live', 'net transition → reconnect', { becameReachable, transportChanged, from: prev.type, to: cur.type })
        reconnect()
      }
    }
    const sub = NetInfo.addEventListener(onChange)
    return () => sub()
  }, [reconnect])

  // Push a renewed access token into the ALREADY-BOOTED page (D812). The
  // injected-before-content config is read ONCE at load — without this, a
  // session that slides past 2 h leaves the embed on an expired JWT while the
  // host keeps working. Seed the ref from the boot token so the first effect
  // does not reconnect on mount.
  const pushedTokenRef = useRef<string | null>(null)
  useEffect(() => {
    if (token === null || token.length === 0) return
    if (pushedTokenRef.current === null) {
      pushedTokenRef.current = token
      return
    }
    if (pushedTokenRef.current === token) return
    pushedTokenRef.current = token
    webViewRef.current?.injectJavaScript(
      `window.__camstackEmbedPage&&window.__camstackEmbedPage.setToken&&window.__camstackEmbedPage.setToken(${JSON.stringify(token)}); true;`,
    )
  }, [token])

  // React to `muted` changes without reloading the page. TWO layers, and BOTH
  // are load-bearing:
  //  - the direct `v.muted` write silences the CURRENT live <video> immediately
  //    (on unmute it also re-issues play() — WebKit may have started the stream
  //    muted under its autoplay policy, and play() right after clearing muted is
  //    the best chance to get audio without an in-webview user gesture);
  //  - `__camstackEmbed.setMuted` hands the value to the embed page's own muted
  //    state — the single embed-side OWNER of mute. That state renders any
  //    REPLACEMENT <video> muted and arms the embed's 1 s re-mute enforcer;
  //    recorded audio rides that same WebRTC element.
  // An earlier comment here claimed the embed "does not implement setMuted" —
  // long stale (EmbedPlayerPage exposes it), and it read as licence to treat
  // the DOM write as the whole fix. It is not: see below for the path a DOM
  // write can never reach.
  useEffect(() => {
    const m = muted ? 'true' : 'false'
    webViewRef.current?.injectJavaScript(
      `(function(){var v=document.querySelector('video');if(v){v.muted=${m};v.defaultMuted=${m};` +
        `if(!${m}){v.volume=1;try{var p=v.play&&v.play();if(p&&p.catch)p.catch(function(){});}catch(e){}}}` +
        `window.__camstackEmbed&&window.__camstackEmbed.setMuted&&window.__camstackEmbed.setMuted(${m});})(); true;`,
    )
  }, [muted, target, state])

  // ^ `target` and `state` are in the deps ON PURPOSE: imperative state written
  // into a DOM node must be re-asserted whenever the node can be replaced, and
  // the live <video> IS replaced across target switches (the embed's
  // make-before-break stream swap) and connection-state transitions. A fresh
  // <video> is born UNMUTED — the HTML default — so with `muted` alone in the
  // deps nothing re-asserted the silence after a swap. Re-injecting when
  // nothing changed is harmless: the script is idempotent.
  //
  // What these deps can NOT cover — learned when the bug came back: entering
  // recorded playback does not replace the live element at all. Recorded video
  // is a canvas over the (kept-running, embed-force-muted) live player, and
  // recorded AUDIO is PCM scheduled into an AudioContext — there is no <video>
  // on that path for this script to write to. Muting it belongs to the embed's
  // muted state, which `setMuted` above feeds and which the embed stamps onto
  // its recorded audio pipeline (EmbedPlayerPage → WebcodecsPlaybackTier →
  // AudioPipeline gain). A second mute call injected from here could only race
  // that owner. Guard: src/live/__tests__/mute-ownership-wiring.spec.ts.

  // React to `target` changes without reloading the page.
  useEffect(() => {
    webViewRef.current?.injectJavaScript(
      `window.__camstackEmbed && window.__camstackEmbed.setTarget(${JSON.stringify(target)}); true;`,
    )
  }, [target])

  // Toggle the embed's client-side stats overlay (option A).
  useEffect(() => {
    webViewRef.current?.injectJavaScript(
      `window.__camstackEmbed && window.__camstackEmbed.setStats && window.__camstackEmbed.setStats(${showStats ? 'true' : 'false'}); true;`,
    )
  }, [showStats])

  // The numbers this player reported stop being true the moment it goes away:
  // a card opened afterwards must say "no measurement yet", not show the last
  // bitrate of a stream that ended.
  useEffect(() => {
    return () => {
      useStreamDebugStore.getState().clear(deviceId)
    }
  }, [deviceId])

  // Push the cold-start poster when it hydrates AFTER the page has loaded (the
  // persisted read is async, so it may arrive after the injected config). Only
  // matters before the first frame; harmless after.
  useEffect(() => {
    if (!snapshot) return
    webViewRef.current?.injectJavaScript(
      `window.__camstackEmbed && window.__camstackEmbed.setSnapshot && window.__camstackEmbed.setSnapshot(${JSON.stringify(snapshot)}); true;`,
    )
  }, [snapshot])

  // Push the per-camera highlight config (rendered inside the embed).
  const highlightKey = JSON.stringify(highlight ?? null)
  useEffect(() => {
    if (highlight) {
      webViewRef.current?.injectJavaScript(
        `window.__camstackEmbed && window.__camstackEmbed.setHighlight && window.__camstackEmbed.setHighlight(${JSON.stringify(highlight)}); true;`,
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightKey])

  const handleMessage = useCallback((event: WebViewMessageEvent): void => {
    // Any message is proof the page's own script is running — the only
    // evidence there is when a WebView declines a load without reporting it.
    reportEmbedAlive()
    const raw = event.nativeEvent.data
    // Stats reply (from getStats's injected probe) → resolve the pending promise.
    //
    // Matched on the TYPE, not on the word. The sniff used to be
    // `raw.includes('"stats"')`, which claims any message with a field called
    // `stats` anywhere in it — and the stream-debug sample has one, so every
    // sample was swallowed here and the status card said "no measurement yet"
    // for ever. A cheap sniff still has to be a sniff for the right thing.
    if (isPlaybackStatsReply(raw)) {
      const resolve = statsResolverRef.current
      statsResolverRef.current = null
      if (resolve) resolve(parsePlaybackStats(raw, statsPrevRef))
      return
    }
    // The injected `fit` reporting whether it reached the embed's API.
    //
    // `fit-unconfirmed` is the case that used to be silent, and it is not just
    // logged: the measured frame is FORGOTTEN so `adoptFrame`'s dedupe cannot
    // keep refusing to push the same box again. Without that, one lost fit
    // lasted the life of the page.
    if (typeof raw === 'string' && raw.includes('"fit-')) {
      const acked = raw.includes('"fit-ack"')
      if (acked) {
        log.debug('live', 'embed confirmed the fit', { deviceId, report: raw })
      } else {
        frameRef.current = null
        log.warn('live', 'the embed never took the fit — the box it draws in is NOT the measured one', {
          deviceId,
          report: raw,
        })
      }
      return
    }
    // The page's answer to a PiP request (`{type:'pip'}`) — it settles the
    // promise `startPip()` handed the host (the PiP disc and the downward
    // fling both wait on it and both keep this player mounted).
    if (typeof raw === 'string' && pipConfirmRef.current?.report(raw) === true) {
      pipConfirmRef.current = null
      log.info('live:pip', 'system PiP request answered', { deviceId, report: raw })
      return
    }
    // Every LATER presentation-mode change on the same element. Not consumed by
    // anything — it exists so the log can say whether the page left PiP before
    // the player was torn down (see `PIP_MODE_WATCH_SCRIPT`).
    // Cheap sniff before the parse, like the stats reply above: this handler
    // runs on every page→host message (position ticks included), and the mode
    // report is a handful per session.
    const modeReport =
      typeof raw === 'string' && raw.includes('"pipmode"') ? parsePipModeReport(raw) : null
    if (modeReport !== null) {
      log.info('live:pip', 'presentation mode changed', { deviceId, mode: modeReport.mode })
      return
    }
    const snap = parseSnapshotPayload(raw)
    if (snap !== null) {
      snapshotBrokerRef.current.accept(snap)
      return
    }
    const cap = parseLiveCapturePayload(raw)
    if (cap) {
      const result = captureAssemblerRef.current.push(cap)
      if (result) {
        const waiter = captureWaiterRef.current
        captureWaiterRef.current = null
        if (result.kind === 'complete') {
          waiter?.resolve({ mime: result.mime, base64: result.base64 })
        } else if (waiter) {
          waiter.reject(new Error(result.message))
        } else {
          onLiveCaptureError?.(result.message)
        }
      }
      return
    }
    const msg = parseEmbedMessage(raw)
    if (msg) {
      // What the PAGE says it can do. Latched from every state report (they all
      // carry it) rather than from a one-shot handshake, so a WebView that
      // reloaded — auto-retry, a fallback rebuild — re-advertises on its way
      // back up instead of leaving the host believing an older page.
      if (msg.caps !== undefined) capsRef.current = msg.caps
      // Tagged with the camera: a state timeline that cannot be grouped per
      // camera cannot answer the only question ever asked of it.
      log.debug('live:state', msg.state, { deviceId, reason: msg.message })
      setStatus(
        msg.state === 'error' && msg.message !== undefined
          ? { state: 'error', reason: msg.message }
          : { state: msg.state },
      )
      if (msg.state === 'playing') {
        if (!bootLoggedRef.current) {
          bootLoggedRef.current = true
          // Once per mount: total wall time from host mount to first 'playing'.
          log.info('live:cold-start', 'mount→playing', {
            totalMs: Date.now() - mountTsRef.current,
            deviceId,
          })
          // The end of the thing the operator is complaining about. Recorded
          // once per launch (the timeline ignores repeats), and it emits the
          // whole chain on one line so a launch is readable without stitching.
          markBoot('firstFrame', { deviceId })
        }
        setHasPlayed(true)
      }
      return
    }
    // Recorded-playback page→host messages (distinct from the live `{type:'state'}`
    // above): playhead position + recorded state. The server embed forwards
    // `{type:'position',positionMs}` and `{type:'recState',state}`.
    if (typeof raw === 'string') {
      const rec = parseRecordingHostMessage(raw)
      // Stream-debug samples (STATE, never shipped) and embed diagnostics —
      // routed by the one router both hosts share (`embed-log-route.ts`).
      if (rec && rec.type === 'log') {
        logRouter.route(rec)
        return
      }
      if (rec && rec.type === 'position') {
        onPosition?.(rec.positionMs)
        return
      }
      if (rec && rec.type === 'servedProfile') {
        onServedProfile?.({ profile: rec.profile, requested: rec.requested })
        return
      }
      if (rec && rec.type === 'clipDuration') {
        onClipDuration?.({ clipId: rec.clipId, durationMs: rec.durationMs })
        return
      }
      if (rec && rec.type === 'clipAudio') {
        onClipAudio?.(rec)
        return
      }
      // The camera cut this clip's replay short (D623). Forwarded, never
      // turned into `setStatus({ state: 'error' })`: that would tear the
      // player down over a clip that played.
      if (rec && rec.type === 'clipIncomplete') {
        onClipIncomplete?.(rec)
        return
      }
      if (rec && rec.type === 'scrubDrawn') {
        // First pushed scrub frame on the WebRTC track → hide the placeholder.
        onScrubDrawn?.()
        return
      }
      const mode = parseRecState(raw)
      if (mode) onPlaybackState?.(mode)
    }
  }, [onPosition, onPlaybackState, onScrubDrawn, onServedProfile, onClipDuration, onClipAudio, onClipIncomplete, onLiveCaptureError, deviceId, logRouter])

  const handleLoadError = useCallback((): void => {
    // Covers DNS/connection failures and HTTP errors (incl. TLS rejections,
    // which WKWebView reports as a failed navigation, not an HTTP status).
    // This is the failure the in-embed retry loop can NEVER recover from — its
    // script never ran — so it is the reason the host keeps a loop of its own.
    log.warn('live', 'webview load error', { deviceId })
    // The page never rendered, so the next attempt should not be the same
    // source: a WebView that cannot read the bundled file (the Mac) gets the
    // hub's copy instead. No-op after the first call and on every platform
    // where the local asset loads.
    reportLoadFailure()
    setStatus({ state: 'error', reason: t('v2.live.errorPageLoad') })
  }, [deviceId, t, reportLoadFailure])


  // Cover lifecycle. `coverActive` is the OLD overlay condition verbatim (so the
  // `hasPlayed` guard is unchanged: after the first successful play a reconnect
  // keeps the embed's last frame and is never re-covered). What changed is the
  // exit: instead of unmounting the moment `playing` arrives, the cover fades
  // out over COVER_FADE_MS and unmounts after, so the poster dissolves into the
  // live video rather than cutting.
  const coverActive = state !== 'playing' && !hasPlayed
  const [coverMounted, setCoverMounted] = useState(true)
  const coverOpacity = useSharedValue(1)
  useEffect(() => {
    if (coverActive) {
      coverOpacity.value = 1
      setCoverMounted(true)
      return undefined
    }
    coverOpacity.value = withTiming(0, { duration: COVER_FADE_MS, easing: Easing.out(Easing.quad) })
    const timer = setTimeout(() => setCoverMounted(false), COVER_FADE_MS)
    return () => clearTimeout(timer)
  }, [coverActive, coverOpacity])
  const coverStyle = useAnimatedStyle(() => ({ opacity: coverOpacity.value }))

  if (!source) {
    // No active server configured — show the error surface with retry disabled
    // semantics (retry just re-evaluates once a server exists).
    return (
      <View style={[styles.container, { backgroundColor: '#000', borderColor: colors.border }]}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.danger }]}>{t('v2.live.error')}</Text>
        </View>
      </View>
    )
  }

  return (
    <View
      ref={containerRef}
      style={[styles.container, { backgroundColor: '#000', borderColor: colors.border }]}
      onLayout={handleLayout}
    >
      <WebView
        ref={webViewRef}
        source={source}
        // Grant the asset FOLDER, not the single file: `loadFileURL:` defaults to
        // the file alone, and that grant is what the Mac failure was made of.
        {...(readAccessUri === null ? {} : { allowingReadAccessToURL: readAccessUri })}
        originWhitelist={['*']}
        injectedJavaScriptBeforeContentLoaded={injectedBefore}
        onMessage={handleMessage}
        onLoadEnd={() => {
          // WebView document load done (bundle fetched+parsed) — phase 1 of the
          // cold start. mount→loadEnd ≈ WebView boot + embed bundle cost.
          log.info('live:cold-start', 'mount→webviewLoadEnd', {
            loadEndMs: Date.now() - mountTsRef.current,
            deviceId,
          })
          markBoot('embedLoaded', { deviceId, via: 'player' })
          // Push the current RN-measured frame so the embed sizes its box (the
          // embed fills + object-contains itself; no DOM video-lifting hack).
          applyFrame()
        }}
        onError={handleLoadError}
        onHttpError={handleLoadError}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsPictureInPictureMediaPlayback
        // Transparent style background so the black container shows through
        // before first paint (WKWebView inherits the view's bg color).
        style={[styles.web, videoStyle]}
        containerStyle={styles.web}
      />

      {coverMounted && (
        <Animated.View
          style={[styles.overlay, coverStyle]}
          // The cover used to claim the touch stream on 'error' so its retry
          // button could be pressed — and it could not: the camera-detail
          // screen lays a full-bleed GestureDetector over the video as a LATER
          // sibling, which takes every touch that lands here. With the button
          // moved to the host's playback bar, the cover stops swallowing
          // pinch/pan/tap as well.
          pointerEvents={
            coverActive && shownState === 'error' && onPlayerState === undefined ? 'auto' : 'none'
          }
        >
          {/* The last known frame instead of a black box — still fully opaque,
              so the embed's own connecting loader / any garbage first frame
              stays hidden. */}
          <StreamPoster deviceId={deviceId} enabled={coverMounted} />
          {/* Branch on the CURRENT state only: while fading out state is
              already 'playing', so neither the spinner nor the error card must
              render (an `else` here would flash the error card on every open). */}
          {shownState === 'connecting' && onPlayerState === undefined ? (
            // Fallback only. When the host takes `onPlayerState` it draws the
            // indicator as a RING around the on-video play/pause disc, which is
            // both where the operator looks and what the disc describes; a
            // second spinner in the corner would then be duplicate furniture.
            <View style={styles.cornerLoader}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : shownState === 'error' && onPlayerState === undefined ? (
            // Fallback only, exactly like the spinner above it. A host that
            // listens draws the failure — reason included — as a DANGER ring on
            // its playback bar and carries the retry there. Drawn here it was
            // visible and inert: the screen's gesture layer sits on top of the
            // whole picture, so the button refused every tap (operator,
            // 2026-08-02: "esce un pulsante sullo stream ma non è cliccabile").
            //
            // Scrim under the error card so its text stays legible over the
            // poster photo (it used to sit on flat black).
            <View style={styles.errorScrim}>
              <View style={styles.center}>
                <Text style={[styles.errorText, { color: colors.danger }]}>
                  {t('v2.live.error')}
                </Text>
                {/* WHY, not just THAT. A player showing only "error" sends the
                    operator to the logs for something the surface already knew. */}
                {status.reason !== undefined ? (
                  <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
                    {status.reason}
                  </Text>
                ) : null}
                <Pressable
                  onPress={handleRetry}
                  style={[styles.retryButton, { borderColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('v2.live.retry')}
                >
                  <RotateCw size={16} color={colors.foreground} />
                  <Text style={[styles.retryLabel, { color: colors.foreground }]}>
                    {t('v2.live.retry')}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </Animated.View>
      )}
    </View>
  )
})

const styles = StyleSheet.create({
  // Fill the parent wrapper (the camera-detail box sizes us: 16:9 in portrait,
  // full-screen when filling/landscape). No fixed aspectRatio/border — matches
  // the native LiveView; the WebView itself is black so any letterbox (e.g. a
  // 16:9 embed video in a wide landscape viewport) shows black, never white.
  container: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  web: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    // Fully OPAQUE: while the stream is not yet `playing` this overlay
    // completely COVERS the WebView, hiding the embed page's own (hard-coded,
    // English, un-editable) "Connecting…" loader behind it. The opacity now
    // comes from `StreamPoster` (last known frame → shimmer → themed surface);
    // this `#000` is only the last-resort base beneath it. The overlay fades
    // out on `playing` instead of unmounting instantly.
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  // Dim layer carrying the error card so its text reads over a poster photo.
  errorScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
    gap: SPACING.md,
  },
  // Connecting spinner pinned to the bottom-left corner (the bottom-right
  // hosts the on-video control cluster; the top corners carry name/badges).
  cornerLoader: {
    position: 'absolute',
    left: SPACING.md,
    bottom: SPACING.md,
    padding: SPACING.xs,
  },
  hint: {
    fontSize: 13,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  retryLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
})
