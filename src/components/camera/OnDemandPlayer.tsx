/**
 * OnDemandPlayer — the movable, resizable second player (D483).
 *
 * A camera's RECORDED playback from a given instant, with a compact scrub/live
 * timeline, floating over whatever page the operator is on. Opened from the
 * "go to this moment" button in a track detail and from a card in the tablet
 * camera reel; see `live/ondemand-player.ts` for what each entry point means.
 *
 * ## What is new here, and what is not
 *
 * Almost nothing about playback is new. The picture is a `<LiveView>` with
 * `initialSeekMs`, which is the shipped "open at an instant" path — the embed
 * enters recorded on its own the moment its control channel opens
 * (`embed/src/playback/initial-seek.ts`), with no host round-trip and no
 * live-first flash. The state is a second `usePlaybackMachine`, which is
 * hook-local precisely so there can be a second one. The transport row is
 * `TimelinePlaybackBar` and the day tape is `HeatmapBar`, both mounted
 * VERBATIM — neither gained a prop, a variant or a flag for this surface.
 *
 * The one thing this surface does NOT bind is the bar's live lock, and 1.0.488
 * shipped with it bound. The lock lets the theater's operator browse a timeline
 * while the picture stays put — the theater has a preview to browse INTO. Here
 * there is a day strip, a picture, and nowhere for a previewed instant to
 * appear: armed, every press on the strip moved the cursor and left the picture
 * behind, on a panel with no room to say why. The binding is absent rather than
 * disabled, which is the rule the bar already applies to `onStepFrame` and
 * `record`.
 *
 * So the compact timeline is a COMPOSITION of the leaves `TheaterTimeline`
 * already uses, not a copy of it and not a mode of it. `TheaterTimeline` is
 * 1 986 lines, takes some forty props, is the PLAYER'S OWN PARENT in every
 * layout (`stream-slot.ts`), and its `chromeHidden` docblock prices its reads
 * at "four batched calls per view". Reusing it here would have meant a second
 * copy of the screen, or a flag threaded through all of it; copying it would
 * have meant two timelines to keep in step. Composing the leaves costs two
 * day-scoped aggregates — availability for the recording hairline, event
 * density for the motion and audio lanes — and no changes to anything shared.
 *
 * What this file genuinely owns: the frame, the two gestures, and the wiring
 * between them.
 *
 * ## The stream's controls are the SCREEN's controls
 *
 * The operator drives this window on a phone and asked for the audio, the
 * microphone and the PiP that the single-camera screen already has. None of
 * the three is rebuilt here. The disc's icon, label and active state come from
 * `stream-control-items.ts`; the chrome, the press re-arm and the clusters are
 * `OverlayDiscGroup`, one size down because the picture is 144pt tall on the
 * narrowest panel; the talk session is `useIntercom`, the same hook
 * `CameraDetailScreen` drives; the PiP sequence is `live/use-system-pip.ts`,
 * extracted FROM that screen so there is one ordering rather than two. D62 is
 * the rule underneath: a knob that disagrees with the one that owns the
 * function is worse than no knob.
 *
 * The one disc that is genuinely this window's is the way OUT of it — see
 * `onOpenCamera`, which routes and stops.
 *
 * ## The picture is muted, and stays the operator's choice
 *
 * `muted` starts `true`, the same default the primary picture has
 * (`CameraDetailScreen`'s `useState(true)`). There is deliberately no
 * exclusivity rule between this player and the primary: the app's audio model
 * is a COMBINABLE host-owned set (`EmbedGridPage`'s `audioOnIds`, the wall's
 * `setAudioOn`), the only genuinely exclusive resource is the mic — one
 * `useIntercom` session at a time, per camera — and a fourth audio policy on
 * one screen ("unmuting here silences the picture") would disagree with the
 * wall sitting next to it. Two audible cameras therefore takes two deliberate
 * presses, which is exactly what it already takes to unmute the picture and
 * listen to a wall cell.
 *
 * ## Both gestures commit on RELEASE
 *
 * The picture is a WKWebView (native) or an iframe (web). A transform is
 * composited; a gesture-driven `width`/`height`/`left`/`top` relayouts WebKit
 * every frame. So a drag moves a GHOST — an empty bordered View — and the real
 * box changes exactly once, at the release: `snapSizeForWidth` for a resize,
 * `clampOnDemandPosition` for a move. The maths is in `live/ondemand-geometry.ts`
 * and asserted by value there; this file only feeds it the gesture.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useCameras, FEATURE } from '../../data/use-cameras.js'
import { onDemandTitle } from '../../live/ondemand-title.js'
import { LiveView, type LiveViewHandle } from '../../live/LiveView.js'
import { useRouteChannel } from '../../connection/use-route-channel.js'
import { qualityToTargetForRoute } from '../../live/quality-target.js'
import {
  usePlaybackMachine,
  selectActiveEpoch,
  selectScrubDirection,
  type PlaybackControlSink,
} from '../../recording/playback-machine.js'
import { HeatmapBar } from './theater/HeatmapBar.js'
import { TimelinePlaybackBar } from './theater/TimelinePlaybackBar.js'
import { TimelineScaleProvider } from './theater/TimelineScaleProvider.js'
import {
  dayFractionToEpoch,
  epochToDayFraction,
  localDayWindow,
} from './theater/heatmap-scrub.js'
import { useRecordingAvailability } from '../../data/use-recording.js'
import { useTimelineActivity } from '../../data/use-timeline-activity.js'
import { composeHeatmapBins } from './theater/event-highlights.js'
import {
  clampOnDemandPosition,
  snapSizeForWidth,
  ONDEMAND_CHROME_PADDING,
  ONDEMAND_RESIZE_GRIP,
  resolveOnDemandBox,
  ONDEMAND_OVERLAY_Z,
  type OnDemandBox,
  type OnDemandContainer,
  type OnDemandPosition,
  type OnDemandSize,
} from '../../live/ondemand-geometry.js'
import { onDemandSeedSeekMs, onDemandStartsLoading, type OnDemandRequest } from '../../live/ondemand-player.js'
import { useIntercom } from '../../live/use-intercom.js'
import { useSystemPip } from '../../live/use-system-pip.js'
import type { PlayerConnectionState } from '../../live/live-view-types.js'
import { useNotice } from '../ui/confirm.js'
import { OverlayDiscGroup, type OverlayDisc } from './OverlayDiscGroup.js'
import {
  muteDisc,
  talkDisc,
  systemPipDisc,
  systemPipSupported,
} from './stream-control-items.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, withAlpha, type ColorTokens } from '../../theme/tokens.js'
import { ExternalLink, Move, MoveDiagonal2, X } from '../../lib/icons.js'


/**
 * Disc diameter for this window's control cluster.
 *
 * The app's on-video disc is 40pt. Here the picture is 144pt tall on the
 * narrowest panel (`ONDEMAND_MIN_WIDTH` at 16:9) and four 40pt discs plus
 * their gaps do not cross it. So the SIZE is smaller and nothing else is: the
 * chrome, the auto-hide, the press re-arm and the definitions are the screen's.
 */
const ONDEMAND_DISC_SIZE = 28

/**
 * The cluster never hides in this window.
 *
 * `OverlayDiscGroup` hides on a parent-owned flag that the single-camera
 * screen toggles with a tap on its stage. There is no such gesture here — the
 * picture is a WKWebView and this panel's touches are already spoken for by a
 * move and a resize — so a hide would be one the operator could not undo.
 * `holdOpen` keeps the timer unarmed; this is the callback it therefore never
 * calls.
 */
const NEVER_HIDES = (): void => {}

export interface OnDemandPlayerProps {
  readonly request: OnDemandRequest
  readonly container: OnDemandContainer
  readonly size: OnDemandSize
  readonly position: OnDemandPosition | null
  readonly onSize: (size: OnDemandSize) => void
  readonly onPosition: (position: OnDemandPosition) => void
  readonly onClose: () => void
}

export function OnDemandPlayer({
  request,
  container,
  size,
  position,
  onSize,
  onPosition,
  onClose,
}: OnDemandPlayerProps): React.JSX.Element {
  const { t } = useTranslation()
  const { data: cameras } = useCameras()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const liveRef = useRef<LiveViewHandle | null>(null)
  // Same clamp as the theater: off the LAN this overlay opens recorded, and
  // adaptive would climb after a probe. Pin `low` on a remote route.
  const routeChannel = useRouteChannel()
  const liveTarget = useMemo(
    () => qualityToTargetForRoute('auto', routeChannel),
    [routeChannel],
  )

  const box = useMemo(() => resolveOnDemandBox(size, container), [size, container])
  /**
   * What the chrome actually has to render into: the panel minus its own
   * padding and the corner the resize grip reserves.
   *
   * Derived here from the constants the styles use, rather than re-measured
   * with `onLayout`. A measurement of a surface that is never unmounted latches
   * — the defect `screens/camera-detail/container-width.ts` documents three
   * times over, and this overlay outlives every route change by construction,
   * so a latched value here would survive not just a rotation but a whole
   * session. The box is KNOWN before the panel lays out; measuring it back
   * would be asking a question we already hold the answer to.
   */
  const chromeWidth = Math.max(
    0,
    box.width - 2 * ONDEMAND_CHROME_PADDING - ONDEMAND_RESIZE_GRIP,
  )
  // Re-clamped against the LIVE container on every render, never once at the
  // drop: a position measured in a window that has since shrunk would otherwise
  // strand the player off screen for the rest of the session, which is the
  // latched-measurement defect `container-width.ts` documents three times.
  const at = useMemo(
    () =>
      position === null
        ? defaultCorner(box, container)
        : clampOnDemandPosition(position, box, container),
    [position, box, container],
  )

  // ── Playback ───────────────────────────────────────────────────────────────
  // `initialSeekMs` is cleared once the session has taken it, so an auto-retry
  // reload or a go-live remount cannot re-enter recorded at the stale instant —
  // the same discipline `CameraDetailScreen` applies to its `?at=` deep link.
  // A LIVE request mounts with no seed at all (`onDemandSeedSeekMs`).
  const [seedSeekMs, setSeedSeekMs] = useState<number | undefined>(() =>
    onDemandSeedSeekMs(request),
  )
  const [reloadKey, setReloadKey] = useState(0)
  const [muted, setMuted] = useState(true)
  const [rate, setRate] = useState(1)
  const [paused, setPaused] = useState(false)
  // Busy only while a RECORDED session owes its report (`onDemandStartsLoading`):
  // a live mount never sends `recState`, so a blanket `true` rang forever.
  const [loading, setLoading] = useState(() => onDemandStartsLoading(request))
  // The player's state, not merely "is it broken": the PiP request's go-live
  // leg is answered from it (`live/use-system-pip.ts`), and a boolean has no
  // way to say `playing`.
  const [playerState, setPlayerState] = useState<PlayerConnectionState>('connecting')
  const faulted = playerState === 'error'

  // Go-live as ONE callback. The transport row and the PiP request both need
  // it — PiP's entire contract is that it pictures the LIVE edge, never the
  // playhead — and two spellings of a remount is two remounts to keep in step.
  const goLiveNow = useCallback((): void => {
    liveRef.current?.goLive()
    setSeedSeekMs(undefined)
    setReloadKey((k) => k + 1)
    // The remount is live, and live never reports `recState`: a `loading`
    // carried over from the recorded session would ring the play button forever.
    setLoading(false)
    setPaused(false)
    setRate(1)
  }, [])

  const sink = useMemo<PlaybackControlSink>(
    () => ({
      scrubStart: (dragId) => {
        liveRef.current?.scrubStart(dragId)
      },
      scrubTo: (epochMs, hint) =>
        liveRef.current?.scrubTo(epochMs, hint?.mode, hint?.velocityPxPerS),
      scrubCommit: (epochMs, dragId) => liveRef.current?.scrubCommit(epochMs, dragId),
      seek: (epochMs) => liveRef.current?.seek(epochMs),
      // Remount, for the reason the primary does: a fresh session at the live
      // edge kills the recorded feeder, so its in-flight position reports
      // cannot bounce the tape back off live.
      goLive: goLiveNow,
    }),
    [goLiveNow],
  )
  const playback = usePlaybackMachine(sink)
  const { state } = playback
  const playbackMode = state.mode
  const { goLive } = playback

  // A retarget (a second entry-point press while the player is open) moves the
  // POINTER rather than rebuilding the session: the embed can do that itself,
  // and a remount would cost a full renegotiation to change a number.
  const lastRequestRef = useRef(request)
  useEffect(() => {
    const previous = lastRequestRef.current
    lastRequestRef.current = request
    if (previous === request) return
    if (previous.deviceId !== request.deviceId) {
      // A different camera IS a different session; the seed rides the new one.
      setSeedSeekMs(onDemandSeedSeekMs(request))
      setLoading(onDemandStartsLoading(request))
      setReloadKey((k) => k + 1)
      return
    }
    const seek = onDemandSeedSeekMs(request)
    if (seek !== undefined) liveRef.current?.seek(seek)
    // Live on the camera already shown: back to the edge through the machine,
    // and only if the picture has left it — a live window re-asked for live
    // keeps its session.
    else if (playbackMode !== 'live') goLive()
  }, [request, playbackMode, goLive])


  // A TICKING clock, seeded lazily — the idiom `TheaterTimeline` uses for the
  // same job. `Date.now()` read during render is an impure call the React
  // Compiler's `purity` rule rejects, and it would also freeze the live edge at
  // mount: with the player live, `viewedEpoch` IS this value, so a static one
  // would leave the tape's cursor behind the picture within a minute.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const activeEpoch = selectActiveEpoch(state)
  const viewedEpoch = activeEpoch ?? nowMs
  const day = useMemo(() => localDayWindow(viewedEpoch), [viewedEpoch])

  // The two queries this surface adds. Both scoped to the single camera and the
  // viewed day, so both reuse the cache entries camera-detail has been filling
  // for this device and day.
  //
  // Coverage stays its OWN read rather than riding the activity bundle: only
  // `useRecordingAvailability` passes `rethrow`, so only it can tell a hub that
  // did not answer from a camera that recorded nothing. Folding the hairline
  // into the bundle would hand this tape a failed read drawn as an empty day.
  const coverage = useRecordingAvailability(request.deviceId, day.fromMs, day.toMs, true)
  // The tape's OTHER lanes. One aggregate (`getEventDensity`) carries motion
  // and audio for the whole day; without it this strip drew the recording
  // hairline and nothing else, which is what the operator reported.
  //
  // The DETECTION lane is deliberately not here. It comes from
  // `useDeviceTracks` — the heaviest read on the camera screen (~374 KB slim
  // for a busy day, deferred behind `timelineReady` even there) — and a
  // floating 256pt panel does not open that on top of a live session. Absent
  // and named, not silently half-fed.
  const { activity } = useTimelineActivity(request.deviceId, day.fromMs, day.toMs, true)
  const bins = useMemo(
    () =>
      composeHeatmapBins({
        dayStartMs: day.fromMs,
        motion: activity.motion,
        audio: activity.audio,
      }),
    [day.fromMs, activity.motion, activity.audio],
  )

  const onSeekFraction = useCallback(
    (fraction: number) => playback.seek(dayFractionToEpoch(fraction, day.fromMs, day.toMs), 'heatmap'),
    [playback, day.fromMs, day.toMs],
  )
  const onScrubFraction = useCallback(
    (fraction: number) =>
      playback.moveScrub(dayFractionToEpoch(fraction, day.fromMs, day.toMs), 'heatmap'),
    [playback, day.fromMs, day.toMs],
  )
  const onScrubEnd = useCallback(
    (fraction: number) =>
      playback.commitScrub(dayFractionToEpoch(fraction, day.fromMs, day.toMs), 'heatmap'),
    [playback, day.fromMs, day.toMs],
  )
  const onScrubStart = useCallback(() => playback.beginScrub('heatmap'), [playback])

  const onTogglePause = useCallback(() => {
    setPaused((p) => {
      const next = !p
      liveRef.current?.setRate(next ? 0 : rate)
      return next
    })
  }, [rate])
  const onSelectRate = useCallback((next: number) => {
    setRate(next)
    setPaused(false)
    liveRef.current?.setRate(next)
  }, [])
  const onJog = useCallback(
    (deltaMs: number) => {
      playback.seek(viewedEpoch + deltaMs, 'timeline')
    },
    [playback, viewedEpoch],
  )

  // ── The stream's own controls (audio · talk-back · PiP · open) ────────────
  //
  // Every one of these is the single-camera screen's, reached by the same
  // route it reaches them by: the definitions are `stream-control-items.ts`,
  // the chrome is `OverlayDiscGroup`, the talk session is `useIntercom` and
  // the PiP sequence is `useSystemPip`. This window contributes the LAYOUT
  // (one size down, both clusters on its own picture) and one extra disc that
  // is genuinely its own — the way out of it, below.
  //
  // D62 is why: a second knob that disagrees with the one that owns the
  // function is worse than no knob.
  const notice = useNotice()
  const camera = useMemo(
    () => (cameras ?? []).find((c) => c.id === request.deviceId) ?? null,
    [cameras, request.deviceId],
  )
  const hasTwoWayAudio = camera?.features.includes(FEATURE.twoWayAudio) ?? false

  const { talking, error: talkError, toggle: onToggleTalk } = useIntercom(request.deviceId)
  useEffect(() => {
    // A denied mic or an unsupported camera is REPORTED. A talk button that
    // lights up and moves no air is the shape this overlay lost a padlock over.
    if (talkError) {
      notice({ title: t('v2.cameraDetail.talk'), message: t('v2.cameraDetail.talkFailed') })
    }
  }, [talkError, t, notice])

  const systemPip = useSystemPip({
    mode: state.mode,
    playerState,
    goLive: goLiveNow,
    startPip: () => liveRef.current?.startPip() ?? Promise.resolve('unavailable'),
  })

  /**
   * The way out of the window: the camera's own screen.
   *
   * It pushes the route and STOPS. Closing the overlay is not this button's
   * job and never was — `resolveOnDemandOnFocus` already takes a camera out of
   * the overlay the moment its own screen is focused, which is how the app
   * avoids two pictures of one camera each paying for a media session. A
   * second close here would be a second authority over the same rule.
   */
  const onOpenCamera = useCallback(() => {
    router.push(`/camera/${request.deviceId}`)
  }, [request.deviceId])

  const streamDiscs = useMemo((): readonly OverlayDisc[] => {
    const next: OverlayDisc[] = [
      muteDisc({ muted, onToggleMute: () => setMuted((m) => !m), cluster: 'left', t }),
    ]
    const talk = talkDisc({ hasTwoWayAudio, talking, onToggleTalk, cluster: 'left', t })
    if (talk) next.push(talk)
    const pip = systemPipDisc({
      supported: systemPipSupported(Platform.OS),
      onStartSystemPip: systemPip.request,
      cluster: 'right',
      t,
    })
    if (pip) next.push(pip)
    next.push({
      id: 'open-camera',
      icon: ExternalLink,
      label: t('v2.onDemandPlayer.openCamera'),
      onPress: onOpenCamera,
      cluster: 'right',
    })
    return next
  }, [muted, hasTwoWayAudio, talking, onToggleTalk, systemPip.request, onOpenCamera, t])

  // ── The two gestures ───────────────────────────────────────────────────────
  // The ghost's offset is two shared values: the drag writes them from the JS
  // responder, the UI thread moves the empty view.
  const ghostX = useSharedValue<number>(0)
  const ghostY = useSharedValue<number>(0)
  const ghostStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: ghostX.get() }, { translateY: ghostY.get() }],
  }))
  const [dragging, setDragging] = useState(false)
  const [ghostSize, setGhostSize] = useState<OnDemandSize | null>(null)

  const moveResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          ghostX.set(0)
          ghostY.set(0)
          setDragging(true)
        },
        onPanResponderMove: (_e, g) => {
          // The GHOST moves — a transform on an empty View. Nothing about the
          // panel's own box changes, so WebKit never relayouts mid-drag.
          ghostX.set(g.dx)
          ghostY.set(g.dy)
        },
        onPanResponderRelease: (_e, g) => {
          setDragging(false)
          onPosition(clampOnDemandPosition({ x: at.x + g.dx, y: at.y + g.dy }, box, container))
        },
        onPanResponderTerminate: () => setDragging(false),
      }),
    [ghostX, ghostY, at.x, at.y, box, container, onPosition],
  )

  const resizeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => setGhostSize(size),
        onPanResponderMove: (_e, g) => {
          setGhostSize(snapSizeForWidth(Math.max(0, box.width + g.dx), container))
        },
        onPanResponderRelease: (_e, g) => {
          const next = snapSizeForWidth(Math.max(0, box.width + g.dx), container)
          setGhostSize(null)
          if (next !== size) onSize(next)
        },
        onPanResponderTerminate: () => setGhostSize(null),
      }),
    [box.width, container, size, onSize],
  )

  const ghostBox = ghostSize === null ? null : resolveOnDemandBox(ghostSize, container)

  return (
    <>
      {/* The move ghost: where the panel will land. Sits under the panel and
          outside its subtree, so nothing the panel hosts is re-laid-out. */}
      {dragging ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ghost,
            {
              width: box.width,
              height: box.height,
              left: at.x,
              top: at.y,
            },
            ghostStyle,
          ]}
        />
      ) : null}
      {ghostBox !== null ? (
        <View
          pointerEvents="none"
          style={[
            styles.ghost,
            { width: ghostBox.width, height: ghostBox.height, left: at.x, top: at.y },
          ]}
        />
      ) : null}
      <View
        testID="ondemand-player"
        style={[styles.panel, { width: box.width, height: box.height, left: at.x, top: at.y }]}
      >
        <View style={styles.header} {...moveResponder.panHandlers}>
          <Move size={14} color={colors.foregroundMuted} />
          <Text style={styles.title} numberOfLines={1}>
            {/* The CAMERA, not the feature: two overlays, or an overlay beside
                the stream it was opened from, were indistinguishable. */}
            {onDemandTitle(cameras ?? [], request.deviceId, t('v2.onDemandPlayer.title'))}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('v2.onDemandPlayer.close')}
            style={styles.headerBtn}
            testID="ondemand-player-close"
          >
            <X size={15} color={colors.foregroundMuted} />
          </Pressable>
        </View>

        <View style={styles.picture}>
          <LiveView
            key={`ondemand-${request.deviceId}-${reloadKey}`}
            ref={liveRef}
            deviceId={request.deviceId}
            target={liveTarget}
            muted={muted}
            initialSeekMs={seedSeekMs}
            onPlaybackState={(embed) => {
              playback.reportEmbedState(embed)
              setLoading(embed === 'loading')
              // The seed has been consumed the moment the embed reports any
              // settled state: keeping it would re-seek a later reload.
              if (embed !== 'loading') setSeedSeekMs(undefined)
            }}
            onPlayerState={(status) => setPlayerState(status.state)}
            onPosition={playback.reportPosition}
          />
          <OverlayDiscGroup
            visible
            holdOpen
            onRequestHide={NEVER_HIDES}
            items={streamDiscs}
            discSize={ONDEMAND_DISC_SIZE}
          />
        </View>

        {/* The compact timeline: the day tape and the transport row, both the
            theater's own components, unmodified. */}
        {/* The chrome is judged at the width the PANEL gives it, not the
            window's: this overlay is a resizable window, and a bar laid out for
            390pt inside a 256pt panel wrapped the LIVE chip onto two lines and
            painted its buttons over each other. The provider was simply never
            here — `TheaterTimeline` and `LandscapeTimelineOverlay` both wrap
            their chrome, this surface did not. `playback-bar-fit.ts` takes over
            where the scale tokens hit their floor. */}
        <TimelineScaleProvider availableWidth={chromeWidth}>
        <View style={styles.chrome}>
          <HeatmapBar
            bins={bins}
            cursorFraction={epochToDayFraction(viewedEpoch, day.fromMs, day.toMs)}
            coverage={coverage.data?.ranges}
            unknownCameras={coverage.data?.unknownIds.length ?? 0}
            dayStartMs={day.fromMs}
            dayEndMs={day.toMs}
            onSeekFraction={onSeekFraction}
            onScrubStart={onScrubStart}
            onScrubFraction={onScrubFraction}
            onScrubEnd={onScrubEnd}
          />
          <TimelinePlaybackBar
            mode={state.mode}
            rate={rate}
            paused={paused}
            loading={loading}
            faulted={faulted}
            scrubDirection={selectScrubDirection(state)}
            onTogglePause={onTogglePause}
            onJogBack={() => onJog(-10_000)}
            onJogForward={() => onJog(10_000)}
            onSelectRate={onSelectRate}
            onGoLive={playback.goLive}
          />
        </View>
        </TimelineScaleProvider>

        {/* The grip. Its 28pt box is RESERVED out of the bar's row
            (`styles.chrome`), so the two no longer compete for this corner, and
            `hitSlop` carries the touch target past the 44pt a finger needs
            without spending the layout — hit area is not layout. It is also
            given a visible surface: the operator's report was "it does not
            appear to be resizable", and an affordance nobody can see is one
            nobody tries. */}
        <View
          style={styles.resizeHandle}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('v2.onDemandPlayer.resize')}
          testID="ondemand-player-resize"
          {...resizeResponder.panHandlers}
        >
          <MoveDiagonal2 size={15} color={colors.foregroundMuted} />
        </View>
      </View>
    </>
  )
}

/** Bottom-right, inset — kept here rather than imported so the component has
 *  one source for "no stored position" and the geometry module stays pure. */
function defaultCorner(box: OnDemandBox, container: OnDemandContainer): OnDemandPosition {
  return clampOnDemandPosition(
    { x: container.width - box.width, y: container.height - box.height },
    box,
    container,
  )
}

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    panel: {
      position: 'absolute',
      zIndex: ONDEMAND_OVERLAY_Z,
      elevation: ONDEMAND_OVERLAY_Z,
      backgroundColor: colors.background,
      borderRadius: RADIUS.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    /** Where the panel will land. Deliberately empty: it must cost nothing to
     *  move, which is the whole reason the real box does not move. */
    ghost: {
      position: 'absolute',
      zIndex: ONDEMAND_OVERLAY_Z - 1,
      elevation: ONDEMAND_OVERLAY_Z - 1,
      borderRadius: RADIUS.md,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: colors.primary,
      backgroundColor: withAlpha(colors.primary, 0.12),
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.xs,
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs,
      backgroundColor: colors.surface,
    },
    title: { flex: 1, color: colors.foreground, fontSize: 12, fontWeight: '600' },
    headerBtn: { padding: 2 },
    // ui-check-ok: video letterbox — a camera picture sits on black in both themes
    picture: { flex: 1, minHeight: 0, backgroundColor: '#000' },
    chrome: {
      paddingLeft: ONDEMAND_CHROME_PADDING,
      paddingBottom: SPACING.xs,
      /** The resize grip owns the bottom-right corner. Reserved rather than
       *  overlapped: the grip is the last sibling and wins every touch in its
       *  square, which is exactly where the bar's record/speed controls sit. */
      paddingRight: ONDEMAND_CHROME_PADDING + ONDEMAND_RESIZE_GRIP,
    },
    /**
     * The grip, in the shape this app gives every small icon affordance: a
     * `RADIUS.md` square on `surface`, hairline `border`, a MUTED
     * glyph — the token set `TrackFlagButtons`, `ClusterDetailBody` and
     * `FaceAssignPanel` all use for their 36pt icon buttons, at the 28pt this
     * corner can spend (`ONDEMAND_RESIZE_GRIP`; `hitSlop` carries the touch
     * target past 44).
     *
     * What it is NOT any more: a bespoke notch welded to the corner (one
     * rounded edge, three square) wearing the single-camera screen's own
     * FULLSCREEN glyph — so the corner was signing the wrong action, and the
     * spec beside this file names that glyph so nobody brings it back.
     * `MoveDiagonal2` is the corner-drag sign. The maths behind
     * the gesture was fixed on 2026-09-12 — this is only its appearance.
     */
    resizeHandle: {
      position: 'absolute',
      right: SPACING.xs,
      bottom: SPACING.xs,
      width: ONDEMAND_RESIZE_GRIP,
      height: ONDEMAND_RESIZE_GRIP,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: RADIUS.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
  })
}
