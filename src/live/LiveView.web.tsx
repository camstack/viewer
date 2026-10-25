/**
 * LiveView (web) — single-camera live via the stream-broker embed in an
 * `<iframe>`. Mirrors `LiveViewWebView.tsx` (iOS) but over the web postMessage
 * bridge instead of RN injectedJavaScript. Registers a per-device `EmbedChannel`
 * so the talk button (`use-intercom.web`) can post `setMic` / read `micState`.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useTranslation } from 'react-i18next'
import { RotateCw } from '../lib/icons.js'
import { useServer } from '../app/ServerProvider.js'
import { useTheme } from '../theme/theme-provider.js'
import { StreamPoster } from '../components/camera/StreamPoster.js'
import { SPACING, RADIUS } from '../theme/tokens.js'
import {
  DEFAULT_TARGET,
  type LiveViewHandle,
  type LiveViewProps,
  type PlayerStatus,
} from './live-view-types.js'
import { useHostAutoRetry } from './use-host-auto-retry.js'
import { buildPlayerEmbedConfig } from './embed-player-config.js'
import { coercePlayerHostMessage, type PlayerCommand } from './embed-player-messages.js'
import { coerceRecordingHostMessage } from '../recording/recording-messages.js'
import { log } from '../lib/logger.js'
import { createEmbedChannel, registerEmbedChannel } from './embed-channel.js'
import { useEmbedIframe } from './use-embed-iframe.js'
import { useScreenWakeLock } from './use-screen-wake-lock.js'
import { playbackCommandToMessage } from './live-control-map.js'
import type { PipStartResult } from './pip-request.js'
import { LiveCaptureAssembler, parseLiveCapturePayload } from './live-capture-protocol.js'
import { SnapshotBroker, parseSnapshotPayload } from './frame-snapshot-protocol.js'
// ONE mapper for both hosts — and the one place `ended` stops being an error.
import { mapRecState } from './rec-state.js'
import { EmbedLogRouter, streamStatsFromSample } from './embed-log-route.js'
import type { StreamDebugSample } from './stream-debug-sample.js'
import { useStreamDebugStore } from '../store/stream-debug-store.js'

export type { LiveViewHandle, LiveViewProps } from './live-view-types.js'

/** Cross-fade duration for the poster cover → live video handoff (mirrors iOS). */
const COVER_FADE_MS = 220

export const LiveView = forwardRef<LiveViewHandle, LiveViewProps>(function LiveView(
  {
    deviceId,
    target = DEFAULT_TARGET,
    muted = true,
    videoStyle,
    showStats = false,
    highlight,
    initialSeekMs,
    onPlaybackState,
    onPlayerState,
    onPosition,
    onServedProfile,
    onClipDuration,
    onClipAudio,
    onClipIncomplete,
    onLiveCaptureError,
  },
  ref,
) {
  const { server, token } = useServer()
  const { colors } = useTheme()
  const { t } = useTranslation()
  // A live picture on screen keeps the screen on: the muted iframe video does
  // not reliably inhibit auto-lock in a PWA, and native gets this from its
  // audio session for free.
  useScreenWakeLock()
  // State AND its reason as one value — see `PlayerStatus`.
  const [status, setStatus] = useState<PlayerStatus>({ state: 'connecting' })
  const state = status.state
  // Mirror every transition to the host so it can render the indicator — and
  // the FAILURE — where the operator is looking (the toolbar ring); same
  // contract as the iOS host. This prop used to be silently ignored here, which
  // left the screen's player state stuck at its 'connecting' seed on web.
  // The mirror moved BELOW `shownStatus` — the host bar must be told what the
  // operator is being shown, not the raw state, or it would draw a danger ring
  // for a failure the picture is deliberately still hiding.
  // Mirrors the iOS host (LiveViewWebView): once the embed has played once, a
  // reconnect keeps its last decoded frame inside the iframe — so the cover must
  // NOT blank it again. Web previously had no such guard and re-covered the
  // frame on every reconnect.
  const [hasPlayed, setHasPlayed] = useState(false)

  const serverUrl = server?.serverUrl ?? null

  const buildConfig = useCallback(
    () =>
      serverUrl
        ? buildPlayerEmbedConfig({
            serverUrl,
            token: token ?? '',
            deviceId,
            target,
            muted,
            stats: showStats,
            highlight,
            // Deep-link go-to-moment — handed over in the embed-ready→embed-config
            // handshake (page boot only); cleared by the host once settled so an
            // iframe reload never re-seeks to a stale instant.
            ...(initialSeekMs !== undefined ? { initialSeekMs } : {}),
          })
        : {},
    [serverUrl, token, deviceId, target, muted, showStats, highlight, initialSeekMs],
  )

  const channelRef = useRef(createEmbedChannel())
  // Stable sender ref so the channel object is created ONCE per deviceId and
  // survives postCommand identity changes (serverUrl hydration / failover) —
  // otherwise use-intercom.web's subscription would bind to a discarded channel.
  const sendRef = useRef<(command: PlayerCommand) => void>(() => {})
  sendRef.current = (command: PlayerCommand) => postCommand(command)
  const captureAssemblerRef = useRef(new LiveCaptureAssembler())
  const snapshotBrokerRef = useRef(new SnapshotBroker())
  const captureWaiterRef = useRef<{
    resolve: (v: { mime: string; base64: string }) => void
    reject: (err: Error) => void
  } | null>(null)

  // The embed's 1 Hz stream-debug sample and its diagnostics — the SAME router
  // the native host uses (`embed-log-route.ts`). Without it the PWA's status
  // card said "No measurement yet" for ever and the stats read-out was empty:
  // the iframe posted every sample and this host dropped them all.
  const lastSampleRef = useRef<StreamDebugSample | null>(null)
  const logRouter = useMemo(
    () =>
      new EmbedLogRouter({
        reportSample: (sample) => {
          lastSampleRef.current = sample
          useStreamDebugStore.getState().report(deviceId, sample)
        },
        info: (scope, msg, data) => log.info(scope, msg, data),
        debug: (scope, msg, data) => log.debug(scope, msg, data),
        nowMs: () => Date.now(),
      }),
    [deviceId],
  )
  // The numbers stop being true the moment this player goes away — a card
  // opened afterwards must say "no measurement yet", not a dead stream's rate.
  useEffect(() => {
    return () => {
      lastSampleRef.current = null
      useStreamDebugStore.getState().clear(deviceId)
    }
  }, [deviceId])

  const onHostMessage = useCallback((data: unknown): void => {
    const snap = parseSnapshotPayload(data)
    if (snap !== null) {
      snapshotBrokerRef.current.accept(snap)
      return
    }
    const cap = parseLiveCapturePayload(data)
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
    const msg = coercePlayerHostMessage(data)
    if (msg) {
      if (msg.type === 'state') {
        // Tagged with the camera — the only grouping this line is ever read by.
        log.debug('live:state', msg.state, { deviceId, reason: msg.message })
        setStatus(
          msg.state === 'error' && msg.message !== undefined
            ? { state: 'error', reason: msg.message }
            : { state: msg.state },
        )
        if (msg.state === 'playing') setHasPlayed(true)
      } else if (msg.type === 'micState') channelRef.current.setMicState(msg.state)
      return
    }
    // Recorded-playback embed→host messages (distinct types from the live
    // `{type:'state'}` above), mirroring the iOS `onMessage` path: playhead
    // position + recorded state drive the timeline + LIVE/recorded chip.
    if (typeof data !== 'object' || data === null) return
    const m = data as Record<string, unknown>
    if (m.type === 'position' && typeof m.positionMs === 'number') {
      onPosition?.(m.positionMs)
      return
    }
    if (m.type === 'recState' && typeof m.state === 'string') {
      onPlaybackState?.(mapRecState(m.state))
      return
    }
    // Through the SAME validator the native host uses on its string form: a
    // second hand-written check here is how a message ends up forwarded on
    // one platform and not the other — which is exactly how `servedProfile`
    // reached the iOS bar and never the web one: the tier badge by the play
    // control was blank on web for every recorded seek that fell to Mid.
    const rec = coerceRecordingHostMessage(m)
    if (rec === null) return
    if (rec.type === 'log') {
      logRouter.route(rec)
      return
    }
    if (rec.type === 'servedProfile') {
      onServedProfile?.({ profile: rec.profile, requested: rec.requested })
    } else if (rec.type === 'clipDuration') {
      onClipDuration?.({ clipId: rec.clipId, durationMs: rec.durationMs })
    } else if (rec.type === 'clipAudio') {
      onClipAudio?.(rec)
    } else if (rec.type === 'clipIncomplete') {
      // Through the SAME validator as the native host, one arm further down.
      // The clip played and was cut short; the host chrome says so and the
      // player is left exactly as it is.
      onClipIncomplete?.(rec)
    }
  }, [onPosition, onPlaybackState, onServedProfile, onClipDuration, onClipAudio, onClipIncomplete, onLiveCaptureError, deviceId, logRouter])

  const { iframeRef, src, postCommand, reload } = useEmbedIframe({
    serverUrl,
    mode: 'player',
    buildConfig,
    onHostMessage,
  })

  useEffect(() => {
    const channel = createEmbedChannel((command: PlayerCommand) => sendRef.current(command))
    channelRef.current = channel
    return registerEmbedChannel(deviceId, channel)
  }, [deviceId])

  useEffect(() => postCommand({ kind: 'setMuted', value: muted }), [muted, postCommand])
  useEffect(() => postCommand({ kind: 'setTarget', value: target }), [target, postCommand])
  useEffect(() => postCommand({ kind: 'setStats', value: showStats }), [showStats, postCommand])
  // Renewed access token (D812): the host SessionKeeper slides the session;
  // the iframe must adopt it or dies at the 2 h access-token mark. The page
  // no-ops when the value matches what it already holds.
  useEffect(() => {
    if (token === null || token.length === 0) return
    postCommand({ kind: 'setToken', value: token })
  }, [token, postCommand])

  /** Rebuild the SURFACE: reload the iframe (fresh page → fresh embed → fresh
   *  session). The only cure for a page that failed to load or a script that
   *  wedged — the failures the embed's own retry loop can never reach. */
  const rebuildSurface = useCallback((): void => {
    setStatus({ state: 'connecting' })
    reload()
  }, [reload])

  // Auto-retry in EVERY case, backing off. The manual affordance (on the host's
  // playback bar) only makes the next attempt sooner.
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
        // Browser PiP can't reach a cross-origin iframe's <video>. A definitive
        // no, not a silent one: the caller logs it and the screen stays, on
        // every platform (`screens/camera-detail/pip-handoff.ts`).
        return Promise.resolve('unavailable')
      },
      // The player's own last sample, measured on the embed's peer — the full
      // webrtc set. This used to be a constant `null`, which is why the PWA's
      // stats read-out never showed a number.
      getStats: () => Promise.resolve(streamStatsFromSample(lastSampleRef.current, Date.now())),
      // Recorded-playback control — same shared `PlaybackCommand` vocabulary the
      // iOS handle uses (LiveViewWebView), but encoded for the postMessage bridge
      // (`playbackCommandToMessage`) instead of injectedJS. `postCommand` wraps it
      // in the `{type:'embed-command', command}` envelope the embed accepts.
      playRecorded: (epochMs: number, profile: string): void =>
        postCommand(playbackCommandToMessage({ kind: 'playRecorded', deviceId, epochMs, profile })),
      playClip: (clipId: string, provider: string, offsetMs: number, profile?: string): void =>
        postCommand(
          playbackCommandToMessage({
            kind: 'playClip',
            deviceId,
            clipId,
            provider,
            offsetMs,
            ...(profile === undefined ? {} : { profile }),
          }),
        ),
      seek: (epochMs: number): void => postCommand(playbackCommandToMessage({ kind: 'seek', epochMs })),
      scrubStart: (dragId?: string): void =>
        postCommand(playbackCommandToMessage({ kind: 'scrubStart', dragId })),
      scrubTo: (epochMs: number, m?: 'fine' | 'coarse', v?: number): void =>
        postCommand(playbackCommandToMessage({ kind: 'scrubTo', epochMs, m, v })),
      scrubEnd: (epochMs: number): void => postCommand(playbackCommandToMessage({ kind: 'scrubEnd', epochMs })),
      scrubCommit: (epochMs: number, dragId?: string): void =>
        postCommand(playbackCommandToMessage({ kind: 'scrubCommit', epochMs, dragId })),
      setRate: (rate: number): void => postCommand(playbackCommandToMessage({ kind: 'setRate', rate })),
      stepFrame: (dir: 1 | -1): void => postCommand(playbackCommandToMessage({ kind: 'stepFrame', dir })),
      goLive: (): void => postCommand(playbackCommandToMessage({ kind: 'goLive' })),
      timelineWarm: (epochMs: number): void =>
        postCommand(playbackCommandToMessage({ kind: 'timelineWarm', epochMs })),
      startLiveCapture: (): void => postCommand(playbackCommandToMessage({ kind: 'startLiveCapture' })),
      stopLiveCapture: (): Promise<{ mime: string; base64: string }> =>
        new Promise((resolve, reject) => {
          captureWaiterRef.current = { resolve, reject }
          postCommand(playbackCommandToMessage({ kind: 'stopLiveCapture' }))
          setTimeout(() => {
            if (captureWaiterRef.current?.reject === reject) {
              captureWaiterRef.current = null
              reject(new Error('capture timeout'))
            }
          }, 15_000)
        }),
      captureSnapshot: () =>
        snapshotBrokerRef.current.request((id) =>
          postCommand(playbackCommandToMessage({ kind: 'snapshot', id })),
        ),
      // The host bar's recovery control — see `LiveViewHandle.retry`.
      retry: handleRetry,
    }),
    [postCommand, deviceId, handleRetry],
  )

  // Cover lifecycle — same model as the iOS host: opaque until the embed reports
  // `playing`, then a short fade-out so the poster dissolves into the video.
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

  if (!src) {
    return (
      <View style={[styles.container, { borderColor: colors.border }]}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.danger }]}>{t('v2.live.error')}</Text>
        </View>
      </View>
    )
  }

  return (
    <View style={[styles.container, videoStyle, { borderColor: colors.border }]}>
      { }
      <iframe
        ref={iframeRef}
        src={src}
        title={`camera-${deviceId}`}
        allow="microphone; autoplay; fullscreen"
        style={{ width: '100%', height: '100%', border: 'none', background: '#000' }}
      />
      {coverMounted && (
        <Animated.View
          style={[styles.overlay, coverStyle]}
          // Mirrors the native host: the cover claimed the touch stream on
          // 'error' only so its retry button could be pressed. That button now
          // lives on the playback bar (the one place a press actually lands),
          // so the cover must stop swallowing the picture's gestures.
          pointerEvents={
            coverActive && shownState === 'error' && onPlayerState === undefined ? 'auto' : 'none'
          }
        >
          {/* Last known frame instead of a black box; still fully opaque. */}
          <StreamPoster deviceId={deviceId} enabled={coverMounted} />
          {/* Branch on the CURRENT state only — while fading out state is
              already 'playing', so nothing must render on top. */}
          {shownState === 'connecting' && onPlayerState === undefined ? (
            // Fallback only, mirroring the iOS host: when the host takes
            // `onPlayerState` the connecting indicator is the ring around the
            // playback bar's play button — a second spinner on the picture is
            // duplicate furniture.
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>{t('v2.live.connecting')}</Text>
            </View>
          ) : shownState === 'error' && onPlayerState === undefined ? (
            // Fallback only, exactly like the spinner above it: a host that
            // listens draws the failure — reason included — as a DANGER ring on
            // its playback bar and carries the retry there, where a press
            // actually lands.
            //
            // Scrim so the error card stays legible over the poster photo.
            <View style={styles.errorScrim}>
              <View style={styles.center}>
                <Text style={[styles.errorText, { color: colors.danger }]}>{t('v2.live.error')}</Text>
                {status.reason !== undefined ? (
                  <Text style={[styles.hint, { color: colors.foregroundMuted }]}>{status.reason}</Text>
                ) : null}
                <Pressable
                  onPress={handleRetry}
                  style={[styles.retryButton, { borderColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={t('v2.live.retry')}
                >
                  <RotateCw size={16} color={colors.foreground} />
                  <Text style={[styles.retryLabel, { color: colors.foreground }]}>{t('v2.live.retry')}</Text>
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
  // The WRAPPER owns the box (16:9 of the width in `stack`, the rail's stream
  // box in `wide`, the whole window in `fill`); this host fills it, like the
  // iOS host's `flex: 1`. It used to be `aspectRatio: 16 / 9` of the width —
  // in `fill` on a landscape phone that was an iframe taller than the window,
  // pinned to the top and clipped: the bottom of the picture was cut off and
  // the detection boxes landed too high (operator report 2026-09-06, "the
  // stream did not take the header into account"). No `borderRadius` either:
  // a full-window picture with rounded corners shows the background through
  // them, and the iOS picture never had any.
  container: { width: '100%', height: '100%', backgroundColor: '#000', overflow: 'hidden' },
  // Opacity comes from StreamPoster (last frame → shimmer → themed surface);
  // the `#000` is only the last-resort base beneath it.
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  errorScrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.md },
  hint: { fontSize: 13, textAlign: 'center' },
  errorText: { fontSize: 13, textAlign: 'center' },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  retryLabel: { fontSize: 13, fontWeight: '600' },
})
