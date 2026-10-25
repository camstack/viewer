/**
 * CameraDetailScreen — single-camera detail view (V1 "theater" layout).
 *
 * Below the status bar (top safe-area inset): a stream block (`LiveView` / a
 * frozen poster, with a name tag + the tile-style `StreamOverlayControls` + optional dummy
 * `MotionBoxesOverlay`) over `TheaterTimeline` (fills remaining height; owns the
 * back arrow + the devices/detections toggles + the snapshot button). The stream
 * box defaults to 16:9 and grows up to 50% of the page (the timeline shrinks)
 * via BOTH the bottom drag handle AND the pinch progress — pinching out enlarges
 * the box continuously on the UI thread. The video supports the V1-ported
 * progressive pinch-to-zoom + clamped pan (`useStreamZoom`). A single stage
 * `GestureDetector` owns: single-tap (show/hide controls), double-tap (fill the
 * player from the whole picture, back to the whole picture otherwise), pinch +
 * pan (zoom), and a one-finger downward swipe (hand the session
 * to system PiP, then back to the camera list — disabled while zoomed) — the
 * controls overlay is `box-none` so it never steals those touches. The video
 * fills the screen in manual fullscreen OR natural landscape.
 *
 * ## Nothing floats over this screen any more (2026-08-01)
 *
 * PTZ, the linked devices, the camera switcher, the quality picker and the
 * view-options menu were `FloatingPanel`s; storage and the event store were
 * `<Modal>`s. All seven are now PANELS OF THE TIMELINE, owning its body under
 * the toolbar — see `TimelineBodyPanel`. Their state went with them, which is
 * the point: this screen no longer holds an `activePanel` union that the
 * timeline's toolbar chips were derived from, so "which panel is open" and "is
 * there a panel" cannot disagree, and no surface has to be handed a
 * `topOffset` computed from the animated video-box height.
 *
 * What stays here is what the SCREEN owns and the panels merely edit: the
 * device, the stream tier, and the overlays drawn on the video. Those travel
 * into the timeline as named bindings.
 *
 * Single-session fullscreen tradeoff: RN cannot reparent a mounted native video
 * view into a `Modal` without remounting it (recreating the stream surface). To
 * guarantee ONE WebRTC session we keep the same `<LiveView>` element mounted in
 * place and only restyle its container to fill the window — no Modal, no second
 * session — then lock landscape + hide the status bar.
 *
 * ## The picture is a WALL as soon as the view has two cameras (2026-09-02)
 *
 * The invariant above — one `<LiveView>`, mounted once, restyled and never
 * re-parented — is a rule about FULLSCREEN and it still holds there. It is no
 * longer a rule about the whole screen.
 *
 * The workspace used to draw its wall UNDER the picture, keeping the route
 * camera in its own native player so that no interaction could cost the session
 * a renegotiation. The operator overruled that: "Non possiamo usare la grid con
 * l'aggiunta? Non fa niente se riconnette". So when
 * `shouldShowWorkspaceGrid` is true the stream slot holds `WorkspaceStage` —
 * ONE wall containing every camera on screen, the route camera first and
 * biggest — and `<LiveView>` is not mounted at all. Going from one camera to
 * two, and from two back to one, each cost one renegotiation. Everything else
 * about the no-remount guarantee is intact: adding a THIRD camera pushes
 * `setDevices` at the page and remounts nothing (`WorkspaceGrid.tsx`).
 *
 * ## The wall is on the PHONE too, in both of its shapes (2026-09-02)
 *
 * `fill` (a phone in landscape) BUILDS a view: confirming a multi-selection in
 * the timeline's camera selector writes the workspace and the wall replaces the
 * picture, with no navigation — the selector lives in the compact edge drawer
 * there, which floats over the picture, so nothing the operator is touching
 * moves. `stack` (portrait) keeps `router.push('/grid/adhoc')` for that same
 * confirm, because in portrait the selector is hosted INSIDE the timeline body
 * and building a view would make the surface being used disappear
 * (`camera-selection.ts` carries the full argument).
 *
 * But portrait RENDERS a view that already exists: rotate a phone with the wall
 * up and the wall stays, drawn in the picture's box with the timeline below and
 * the timeline halved to give the wall its space (`wall-box.ts`). Removing the
 * last member is the close, exactly as on the tablet — there is no second close
 * affordance. And the rotation itself is a RESTYLE of one element rather than a
 * re-parent, so it costs no renegotiation: see `wallStage`.
 *
 * What that costs the controls is not left implicit. Everything on this screen
 * that acted on `liveRef` — the capture button, PiP, the swipe-to-PiP fling,
 * the stats overlay, the retry, the zoom gestures, the on-video control pills —
 * is part of the picture's stage and is simply NOT MOUNTED while the wall is
 * up; the timeline's transport reaches the wall instead, through
 * `gridPlaybackBus`. Three timeline controls are re-aimed rather than dropped:
 * the quality chip, the highlight border and the detection boxes state the
 * WALL, from the primary's documents (the only camera whose preferences this
 * screen owns). The zone filter is withheld — it is drawn on a picture that no
 * longer exists — and the per-camera menus for every cell, the primary
 * included, are reached from the cells themselves (`GridCellPanelOverlay`).
 *
 * The wall also carries the grid page's own control bar, docked under its
 * cells (`WorkspaceStage`): pause all, audio, quality, layout, highlight and
 * active-only over every camera on it. What the bar sets is session state of
 * the view (`workspace-wall-options.ts`) and wins over the primary's documents
 * for the rest of the view; the quality chip reads and writes that same value
 * while the wall is up, so the chip and the bar are one control.
 */
import type { ServedProfileReport } from '../recording/recording-messages.js'
import { assertionAfterPlayerChange, shouldAssertClip } from '../clips/clip-assert-on-player.js'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useClipStage, type ClipStagePorts } from '../clips/use-clip-stage.js'
import { clipStartOnFrame } from '../clips/clip-on-frame.js'
import { noteClipOpenStep } from '../clips/clip-telemetry.js'
import { clipStageStep } from '../clips/clip-stage.js'
import { resolvePauseAuthority, shouldEndLiveCapture } from '../clips/clip-transport.js'
import { adoptClipList } from '../clips/clip-list-identity.js'
import { ClipStageView } from '../components/camera/clips/ClipStageView.js'
import type { Clip } from '../clips/clip-model.js'
import { scrubFramePainted } from '../recording/scrub-first-frame.js'
import {
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useViewportReadout } from '../hooks/use-viewport-size.js'
import { SkeletonBox } from '../components/ui/SkeletonBox.js'
import { GlassSurface } from '../components/ui/GlassSurface.js'
import { useConfirm, useNotice } from '../components/ui/confirm.js'
import type { LayoutChangeEvent } from 'react-native'
import { useTranslation } from 'react-i18next'
import { usePathname, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import * as ScreenOrientation from 'expo-screen-orientation'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  runOnJS,
} from 'react-native-reanimated'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { useWebFullscreen, webFullscreenButtonShown } from '../hooks/use-web-fullscreen.js'
import { useTheaterOrientation } from '../hooks/use-theater-orientation.js'
import {
  usePlaybackMachine,
  selectActiveEpoch,
  selectPlaybackStatus,
  selectScrubDirection,
  type PlaybackControlSink,
  type ScrubSource,
} from '../recording/playback-machine.js'
import { evaluateDivergence } from '../recording/position-divergence.js'
import { jogBaseFor, jogTarget, resolveInitialSeekAction } from '../recording/playback-status.js'
import { log } from '../lib/logger.js'
import { useSystemPip } from '../live/use-system-pip.js'
import { shouldShowOverlayPlayPause } from './camera-detail/overlay-play-pause.js'
import {
  BACK_SWIPE_POINTERS,
  OVERLAY_SWIPE_POINTERS,
  shouldGoBackOnSwipe,
  shouldOpenOverlayOnSwipe,
} from './camera-detail/stream-swipes.js'
import { backToCameras } from '../navigation/back-to-cameras.js'
import { SideNavRail } from '../navigation/SideNavRail.js'
import { BottomNavBar } from '../navigation/BottomNavBar.js'
import { bottomNavFootprint } from '../navigation/bottom-nav-metrics.js'
import { useTheme } from '../theme/theme-provider.js'
import { LiveView, type LiveViewHandle } from '../live/LiveView.js'
import type { PlayerStatus } from '../live/live-view-types.js'
import {
  resolveRecordedProfileForReconnect,
  shouldReassertRecordedOnReconnect,
} from '../live/reassert-recorded-on-reconnect.js'
import type { PipStartResult } from '../live/pip-request.js'
import { captureFileExtension } from '../live/live-capture-protocol.js'
import { formatSelectionDuration } from '../recording/export-selection.js'
import type { LiveCaptureFlow } from '../recording/record-control.js'
import { useStreamZoom } from '../live/use-stream-zoom.js'
import { growBoxHeight } from '../live/zoom-render.js'
import { useDeviceCapNames } from '../data/use-device-cap-names.js'
import { useExportSelection } from '../recording/use-export-selection.js'
import { useActivityStore } from '../activity/activity-instance.js'
import { snapshotItemFrom } from '../activity/activity-model.js'
import { saveSnapshot } from '../activity/save-snapshot.js'
import { useIntercom } from '../live/use-intercom.js'
import { StreamOverlayControls } from '../components/camera/StreamOverlayControls.js'
import { DriveOverlay } from '../components/camera/navigation/DriveOverlay.js'
import { PtzOverlay } from '../components/camera/ptz/PtzOverlay.js'
import { drawerWidth } from '../components/camera/theater/landscape-drawer-geometry.js'
import { OverlayDiscGroup, type OverlayDisc } from '../components/camera/OverlayDiscGroup.js'
import {
  resolveLivePaused,
  shouldMountLiveView,
  shouldDialLiveOnGoLive,
  type LiveStreamGateInput,
} from '../live/battery-stream-gate.js'
import { StreamStatsOverlay } from '../components/camera/StreamStatsOverlay.js'
import { OverlayFrame } from '../components/camera/overlay/OverlayFrame.js'
import { LiveViewersBadge } from '../components/camera/LiveViewersBadge.js'
import { useStreamAspect } from '../live/stream-aspect.js'
import { MotionBoxesOverlay } from '../components/camera/MotionBoxesOverlay.js'
import { StationaryBoxesOverlay } from '../components/camera/StationaryBoxesOverlay.js'
import { MotionRegionsOverlay } from '../components/camera/MotionRegionsOverlay.js'
import { DiscardedBoxesOverlay } from '../components/camera/DiscardedBoxesOverlay.js'
import { AudioLevelMeter } from '../components/camera/AudioLevelMeter.js'
import { DeviceInfoOverlay } from '../components/camera/DeviceInfoOverlay.js'
import { useSettingsStore } from '../store/settings-store.js'
import type { OverlayPosition } from '../components/camera/overlay/overlay-position.js'
import { ZoneDrawOverlay } from '../components/camera/ZoneDrawOverlay.js'
import { ZoneActiveOverlay } from '../components/camera/ZoneActiveOverlay.js'
import { serializeAdhocDeviceIds } from '../grid/adhoc-devices.js'
import {
  TheaterTimeline,
  type TheaterTimelineHandle,
  type TimelineStreamFaultBinding,
} from '../components/camera/theater/TheaterTimeline.js'
import type { ZoneShape } from '../components/camera/theater/zone-filter.js'
import { computeWideDetailSizes } from './camera-detail/wide-detail-sizes.js'
import { BelowStreamArea } from './camera-detail/BelowStreamArea.js'
import { resolveReelInstant } from '../live/ondemand-player.js'
import { atParam, viewedInstant } from '../recording/viewed-instant.js'
import { focusOnDemandCamera, openOnDemandPlayer } from '../store/ondemand-player-store.js'
import { WorkspaceStage } from './camera-detail/WorkspaceStage.js'
import { gateLiveHighlight, type WorkspaceWallPrimary } from './camera-detail/workspace-wall-options.js'
import { shouldShowCameraShelf } from './camera-detail/camera-shelf.js'
import {
  resolvePortraitColumnSplit,
  wallBoxStyle,
} from './camera-detail/wall-box.js'
import {
  shouldShowWorkspaceGrid,
  workspaceOnScreenCameras,
} from './camera-detail/workspace-grid.js'
import { fanOutPlaybackToWall } from './camera-detail/workspace-playback.js'
import { gridPlaybackBus } from '../live/playback-bus.js'
import {
  cameraSelectionModeFor,
  resolveCameraSelection,
} from './camera-detail/camera-selection.js'
import { useWorkspaceStore } from '../store/workspace-store.js'
import {
  shouldShowStreamNavBar,
  streamColumnHeight,
} from './camera-detail/stream-nav-bar.js'
import { GridCellPanelOverlay } from '../components/grid/GridCellPanelOverlay.js'
import { useLastCameraStore } from '../store/last-camera-store.js'
import { resolveCellPanel, type GridCellPanel, type GridCellPanelKind } from '../grid/cell-controls.js'
import {
  isUsableMeasurement,
  resolveContainerWidth,
  type MeasuredContainerWidth,
} from './camera-detail/container-width.js'
import {
  isUnexpectedPortraitStack,
  resolveDetailLayoutMode,
  toolbarPlacementFor,
  type DetailLayoutMode,
} from './camera-detail/detail-layout.js'
import {
  DETAIL_LAYOUT_SCOPE,
  buildDetailLayoutTrace,
  detailLayoutTraceSignature,
} from './camera-detail/layout-trace.js'
import { useScreenMinSide, useSidebarLayout } from '../hooks/use-responsive.js'
import { useSnapshot } from '../data/use-snapshot.js'
import { SnapshotImage } from '../components/camera/SnapshotImage.js'
import { useCameras, FEATURE } from '../data/use-cameras.js'
import { useEventHaptics } from '../data/use-event-haptics.js'
import {
  ArrowLeft, VideoOff, PowerOff, Maximize2, Minimize2, Moon } from '../lib/icons.js'
import { useBattery } from '../data/use-battery.js'

import { useSettings } from '../data/use-settings.js'
import { useMotionHighlight } from '../data/use-motion.js'
import { MOTION, timingTo, useReducedMotion, usePopTransitions } from '../theme/motion.js'
import {
  sideTimelineWidth,
  timelineShown,
  type TimelineDock,
} from '../components/camera/theater/timeline-dock.js'
import { timelineDockDisc } from '../components/camera/stream-control-items.js'
import { CameraStatusDot } from '../components/camera/CameraStatusDot.js'
import { OccupancyBadge } from '../components/camera/OccupancyBadge.js'
import { DoorbellBadge } from '../components/camera/DoorbellBadge.js'
import { useDetections } from '../data/use-detections.js'
import { useAudioActive } from '../data/use-audio.js'
import { AUDIO_HIGHLIGHT_HOLD_SEC } from '../components/camera/audio-level.js'
import { useHeld } from '../data/use-held.js'
import { useCameraLocalStore } from '../store/camera-local-store.js'
import { useDeviceSettingsStore } from '../store/device-settings-store.js'
import { opensMuted } from '../live/audio-on-open.js'
import { hasLayer, patchOverlay } from '../components/camera/overlay/overlay-config.js'
import { OverlayReadouts } from '../components/camera/overlay/OverlayReadouts.js'
import { useCameraViewOptions } from '../hooks/use-camera-view-options.js'
import { useCanActuate } from '../hooks/use-user-scope.js'
import type { GridHighlightEmbedConfig } from '../grid-embed/embed-config.js'
import { qualityToTargetForRoute } from '../live/quality-target.js'
import { useRouteChannel } from '../connection/use-route-channel.js'
import type { StreamQuality } from '../store/settings-store.js'

interface CameraDetailScreenProps {
  readonly deviceId: number
  /** Open the camera ALREADY seeked to this recorded moment (epoch ms) — set
   *  by the `?at=` route param carried by "go to this moment" navigations. */
  readonly initialSeekMs?: number
}

/**
 * The picture's health while there is no picture.
 *
 * With the wall up the cameras are cells inside the embed, which draws its own
 * connecting and error states per tile and offers its own retry. A fault slot
 * still fed by the unmounted player's last `playerStatus` would put a stale
 * red banner over a wall that is playing, with a retry button wired to a null
 * ref. The timeline keeps reducing the RECORDINGS and EVENTS faults, which are
 * about the scope and not about the picture.
 */
const NO_PICTURE_FAULT: TimelineStreamFaultBinding = {
  failed: false,
  fetching: false,
  reason: null,
  onRetry: () => undefined,
}

/** What the last `live:lifecycle` surface line said, so the next render can
 *  tell whether anything the operator would notice actually moved. */
interface WallSurfaceTrace {
  readonly wall: boolean
  readonly mode: DetailLayoutMode
  readonly devices: readonly number[]
}

/** Why a surface line is being written, or `null` for "nothing moved".
 *  A closed union: a fourth reason has to be named to be logged. */
type WallSurfaceDirection = 'pictureToWall' | 'wallToPicture' | 'wallReshaped'

/**
 * Did the theater's surface change in a way worth a shipped line?
 *
 * Three yeses: the picture became a wall, the wall became a picture, and the
 * wall CHANGED SHAPE — a rotation between `fill`, `wide` and `stack` with the
 * wall up, which moves it into a different box and, in portrait, takes half the
 * timeline's height for it. A rotation with no wall is not one: `theater:layout`
 * already writes that decision, and duplicating it here would put two lines
 * about one event in a report that is read by hand.
 */
function wallTraceDirection(
  prev: WallSurfaceTrace | null,
  wall: boolean,
  mode: DetailLayoutMode,
): WallSurfaceDirection | null {
  if (prev === null || prev.wall !== wall) return wall ? 'pictureToWall' : 'wallToPicture'
  if (wall && prev.mode !== mode) return 'wallReshaped'
  return null
}

/**
 * The wall's disc group never auto-hides, so this callback is never called.
 *
 * A module constant rather than an inline arrow: `OverlayDiscGroup` holds it in
 * an effect's dependency list, and a fresh function every render would re-run
 * that effect on every playhead tick of the most re-rendered file in the repo.
 */
const NEVER_HIDE = (): void => undefined

/** Stream box max height as a fraction of the page (pinch-driven grow target). */
const MAX_HEIGHT_FRACTION = 0.5
/** Pinch scale at which the box reaches its max height (default→max over 1×→this). */
const HEIGHT_GROW_SCALE = 2.5

/** Resolve name + feature flags + status inputs from the authoritative camera list. */
function useCameraMeta(deviceId: number): {
  name: string
  features: readonly string[]
  online: boolean
  disabled: boolean
  known: boolean
} {
  const { t } = useTranslation()
  const { data: cameras = [] } = useCameras()
  const cam = cameras.find((c) => c.id === deviceId)
  return {
    name: cam?.name ?? t('v2.cameraDetail.fallbackName', { id: deviceId }),
    features: cam?.features ?? [],
    online: cam?.online ?? false,
    disabled: cam?.disabled ?? false,
    // `features: []` means BOTH "wired camera" and "the list has not answered
    // yet", and the battery gate must tell those apart — see
    // `battery-stream-gate.ts`. Everything else on this screen is happy to
    // treat an unanswered list as "no features".
    known: cam !== undefined,
  }
}

/** The wall and the controls that belong to IT — never the picture's. Exported
 *  so a spec can scope a query to this subtree: the drawer's toolbar carries a
 *  back button too, and a tree-wide query for one is green whether the wall has
 *  its own or not. */
export const WALL_STAGE_TEST_ID = 'wall-stage'

/** Stable empty list — a fresh literal would remint the stepping memos every
 *  render, on a screen that re-renders on every position report. */
const EMPTY_FRAME_CLIPS: readonly Clip[] = []

export function CameraDetailScreen({ deviceId, initialSeekMs }: CameraDetailScreenProps) {
  const namePop = usePopTransitions()
  const { t } = useTranslation()
  const confirm = useConfirm()
  const notice = useNotice()
  const router = useRouter()
  const { colors, mode } = useTheme()
  const insets = useSafeAreaInsets()
  // The viewport the whole screen lays out in — the safe-area FRAME on a
  // device, never `Dimensions` alone: on 2026-09-10 the latter reported
  // portrait for the rest of a session inside a landscape root, and every
  // consumer below inherited the lie. `hooks/viewport-size.ts` has the report.
  // The raw pair is kept only for the `theater:layout` line.
  const { viewport, readout: viewportReadout } = useViewportReadout()
  const { width: winWidth, height: winHeight } = viewport
  const { name, features, online, disabled, known: cameraKnown } = useCameraMeta(deviceId)

  const { settings, hydrated, setStreamDefault } = useSettings()
  /**
   * The LOOP switch, read from the one document that persists it.
   *
   * ON before hydration too, because `settings` starts at `DEFAULTS` — the
   * operator's default is the value a first frame already has, not one that
   * arrives a beat later and changes what the chip says.
   */
  const clipLoop = settings.stream.clipLoop
  const onToggleClipLoop = useCallback((): void => {
    // Writes the AUTHORITY it read, and nothing else. A second store for this
    // switch would be a knob that disagrees with the one acting on it.
    setStreamDefault('clipLoop', !clipLoop)
  }, [setStreamDefault, clipLoop])

  // On iOS the WebView embed renders its OWN highlight (a host border is
  // occluded by the WebView's video layer). iOS now always uses the WebView
  // embed. The stats read-out is NOT the embed's any more: the embed's pill was
  // pinned bottom-left and ignored the operator's position, so the host draws
  // it from the embed's samples like on every other platform.
  const useWebViewPlayer = Platform.OS === 'ios'

  // PTZ MOVES the camera, so it is an `actuate`-grade surface: a session the
  // hub would refuse never sees the toolbar disc, and therefore never reaches
  // the pad behind it. Hidden, never greyed — a disabled d-pad advertises a
  // capability the session does not have and offers nothing to do about it.
  const canActuate = useCanActuate()
  const hasPtz = canActuate && features.includes(FEATURE.ptz)
  const hasBattery = features.includes(FEATURE.battery)
  // `network-link` is a cap, not a device feature: only the device's own
  // bindings say whether this camera has one (D12), and a query on a camera
  // without it is a warning per poll.
  const { data: capNames = [] } = useDeviceCapNames(deviceId, true)
  const hasNetworkLink = capNames.includes('network-link')
  // The robot camera's drive. `actuate`-grade like PTZ: a session the hub
  // would refuse never sees the controls icon.
  const hasNavigation = canActuate && capNames.includes('navigation')
  // The charge decides the name chip's dot — a sleeping camera wears the moon
  // the cameras page already wears, never the green "online" dot. The badges
  // themselves live in the toolbar (`toolbar-status-layout.ts`).
  const { data: battery = null } = useBattery(deviceId, hasBattery)
  const cameraSleeping = hasBattery && battery?.sleeping === true
  const hasTwoWayAudio = features.includes(FEATURE.twoWayAudio)
  const hasDoorbell = features.includes(FEATURE.doorbell)

  // Live stream tier. Seeded from the user's stream defaults (Settings), then
  // owned locally so the toolbar quality picker can switch it on the fly.
  // Changing `quality` recomputes `liveTarget` → `LiveView` (whose effect deps
  // include `target`) reconnects on the new tier.
  // Stream quality is PER-CAMERA and DEVICE-LOCAL: restored from camera-local
  // on open, persisted on change (no global default anymore), never carried
  // by a shared settings profile.
  const storedQuality = useCameraLocalStore((s) => s.local.byId[deviceId]?.quality)
  const setCameraQuality = useCameraLocalStore((s) => s.setCameraQuality)
  // This camera's remembered AUDIO choice, and whether camera-local has been
  // read off disk yet. Both are needed before the opening mute can be decided:
  // `last-selected` resolved against an unhydrated store would say "never
  // chosen" for every camera on every cold start.
  const storedAudioOn = useCameraLocalStore((s) => s.local.byId[deviceId]?.audioOn)
  const prefsHydrated = useCameraLocalStore((s) => s.hydrated)
  const hydrateCameraLocal = useCameraLocalStore((s) => s.hydrate)
  useEffect(() => {
    void hydrateCameraLocal()
  }, [hydrateCameraLocal])
  const setCameraAudioOn = useCameraLocalStore((s) => s.setCameraAudioOn)
  const [quality, setQuality] = useState<StreamQuality>(storedQuality ?? 'auto')
  const qualityApplied = useRef(false)
  // Same gate as the opening mute: apply once camera-local has been read off
  // disk. Without it a cold start marks the default `auto` applied against an
  // empty store and never re-reads the remembered High after hydration.
  useEffect(() => {
    if (!prefsHydrated || qualityApplied.current) return
    qualityApplied.current = true
    if (storedQuality !== undefined) setQuality(storedQuality)
  }, [prefsHydrated, storedQuality])
  // Off the LAN / loopback the player asks for `low` regardless of the stored
  // preference — recorded scrub/playback and the live edge share one target, so
  // the clamp covers both without a second path. Preference is kept for home
  // (and for the quality chip — the clamp must not look like a failed pick).
  const routeChannel = useRouteChannel()
  const liveTarget = useMemo(
    () => qualityToTargetForRoute(quality, routeChannel),
    [quality, routeChannel],
  )
  const onQualityChange = useCallback(
    (q: StreamQuality) => { setQuality(q); setCameraQuality(deviceId, q) },
    [deviceId, setCameraQuality],
  )

  // Haptic feedback for key events on THIS camera while it's on screen (motion /
  // detection / recognized person). Self-gates on the master toggle + per-kind
  // config + foreground AppState + connection; no-ops on web and on old native
  // binaries (OTA-safe).
  //
  // The master toggle is FORCED OFF since 2026-09-13 and has no UI any more
  // (`HAPTICS_DEFAULTS`). The mechanism is deliberately left wired rather than
  // deleted — the operator asked for it off, not gone — so this call is a
  // no-op by configuration and not by an absent call site. Deleting it would
  // make bringing the feature back a re-implementation instead of a default.
  useEventHaptics([deviceId], true)

  // Per-camera highlight (detail view): a colored border on motion / audio /
  // detection per the camera's saved settings (priority detection>audio>motion,
  // each with a cooldown hold). The triggers themselves are the enablement —
  // there's no master toggle in the single view.
  // What this camera draws over its picture. One persisted document replacing
  // three lifetimes: `useState` toggles that died on navigation, a pref that
  // held only the meter's corner, and overlays with no switch at all.
  // ONE binding for the per-camera configuration — the SAME hook a grid cell's
  // view-options panel is driven by, so the menu the operator opens from a tile
  // and the one here edit the same document (and hydrate it the same way).
  const {
    overlay,
    setOverlay: onSetOverlay,
    highlight: cameraHighlight,
    setHighlight: onSetCameraHighlight,
  } = useCameraViewOptions(deviceId)

  // For the WebView player the embed computes + draws highlight itself (same
  // solution as the grid), so skip the native detection/audio subscriptions here.
  const detState = useDetections(deviceId, cameraHighlight.detection && !useWebViewPlayer)
  const detMatch =
    cameraHighlight.detection &&
    detState.boxes.some(
      (b) => cameraHighlight.detectionClasses.length === 0 || cameraHighlight.detectionClasses.includes(b.label),
    )
  const detActive = useHeld(detMatch, cameraHighlight.detectionHoldSec * 1000)
  const audioRaw = useAudioActive(deviceId, useWebViewPlayer ? 'off' : cameraHighlight.audio, cameraHighlight.audioDb)
  const audioActive = useHeld(
    cameraHighlight.audio !== 'off' && audioRaw,
    AUDIO_HIGHLIGHT_HOLD_SEC * 1000,
  )
  // Picking a level lights the overlay immediately for 5s so the operator
  // sees the colour without waiting for live audio to cross the rung.
  const [audioPreviewUntil, setAudioPreviewUntil] = useState(0)
  const audioHighlightKey = `${cameraHighlight.audio}:${cameraHighlight.audioDb}`
  const skipAudioPreview = useRef(true)
  useEffect(() => {
    if (skipAudioPreview.current) {
      skipAudioPreview.current = false
      return
    }
    if (cameraHighlight.audio === 'off') {
      setAudioPreviewUntil(0)
      return
    }
    const until = Date.now() + AUDIO_HIGHLIGHT_HOLD_SEC * 1000
    setAudioPreviewUntil(until)
    const t = setTimeout(() => setAudioPreviewUntil(0), AUDIO_HIGHLIGHT_HOLD_SEC * 1000)
    return () => clearTimeout(t)
  }, [audioHighlightKey, cameraHighlight.audio])
  const audioPreview = audioPreviewUntil > Date.now()

  // Highlight config injected into the WebView embed (same shape as the grid).
  // `enabled` is the overlay document's border switch: the embed draws its OWN
  // border, so without this the panel's toggle was dead on the WebView player —
  // the exact defect the operator reported. On the native path the same flag
  // gates the border View below; one switch, both painters.
  const embedHighlight = useMemo<GridHighlightEmbedConfig>(
    () => ({
      enabled: overlay.highlightBorder,
      ...cameraHighlight,
      audioHoldSec: AUDIO_HIGHLIGHT_HOLD_SEC,
      appearance: settings.highlight,
      motionHoldSec: settings.grid.motionHoldSec,
    }),
    [overlay.highlightBorder, cameraHighlight, settings.highlight, settings.grid.motionHoldSec],
  )

  // LIVE pause. Deliberately NOT a plain `useState(false)`: mounting `LiveView`
  // IS starting the stream (there is no autoStart prop, by design), and on a
  // battery camera starting the stream wakes the firmware. So the initial value
  // is DERIVED by `resolveLivePaused` — `null` means "the operator has not
  // touched the transport yet" and the gate decides, after which their choice
  // wins outright. Deriving rather than latching is the point: the camera list
  // is empty on the first render of a cold start, and a latched `false` there
  // would dial a sleeping camera before we ever learned it runs on battery.
  const [pauseChoice, setPauseChoice] = useState<boolean | null>(null)
  const streamGate: LiveStreamGateInput = {
    operatorChoice: pauseChoice,
    cameraKnown,
    batteryPowered: hasBattery,
  }
  const paused = resolveLivePaused(streamGate)
  // The sink is memoized on `[]`, so goLive reads the hold through a ref —
  // remounting the live peer here is the sleeping-camera wake.
  const liveHeldRef = useRef(paused)
  liveHeldRef.current = paused
  // LIVE connection lifecycle from the embed player, REASON included.
  // `connecting` until the first frame paints — the state that rings the
  // playback bar's play button while a stream is slow to start; `error` with a
  // reason on a hard failure, which rings the same button in the danger colour
  // and puts the retry control beside it. The player draws neither itself: the
  // screen's gesture layer (below) covers the whole picture, so a button drawn
  // there is visible and untouchable.
  const [playerStatus, setPlayerStatus] = useState<PlayerStatus>({ state: 'connecting' })
  /**
   * The clip already asserted to THIS player incarnation, and the player's own
   * state as a ref.
   *
   * Both live up here because `clipStagePorts` below is minted once, with `[]`
   * deps, and cannot close over state. The record has two senders — the tap
   * and the re-assert effect — and both reach the player through that one
   * port, so the port is where a send is recorded. It used to be written only
   * by the effect, which is why every tap produced two injections and a
   * Hikvision's single replay slot contended with itself.
   */
  const assertedClipRef = useRef<string | null>(null)
  const playerStateRef = useRef<string>(playerStatus.state)
  playerStateRef.current = playerStatus.state
  // Toggles the RESOLVED value, so the first press on a battery camera's hold
  // is an unambiguous "play" rather than a flip of a state that was never
  // false. Re-derived inside the updater from primitives, not closed over
  // `paused`: a dependency the compiler cannot prove stable costs the whole
  // component its memoization.
  //
  // No `useCallback`: the React Compiler memoizes this for us, and a manual
  // `useCallback` here cannot be preserved (it infers `setPauseChoice` as the
  // only dependency and refuses to optimize the WHOLE component over the
  // mismatch — 900 lines of screen, for one handler).
  const onTogglePause = (): void => {
    setPauseChoice((prev) =>
      !resolveLivePaused({
        operatorChoice: prev,
        cameraKnown,
        batteryPowered: hasBattery,
      }),
    )
  }
  // ── Recorded-playback transport state (advanced playback) ────────────────
  // `speed` = the selected play rate (never 0); `recPaused` = recorded pause
  // (server rate 0 — the feeder holds the exact frame; frame-step works).
  // LIVE pause keeps the old poster-pause behavior (teardown); RECORDED pause
  // is a real rate-0 pause on the same session.
  const [speed, setSpeed] = useState(1)
  const [recPaused, setRecPaused] = useState(false)

  // Unified WebRTC surface: ONE <LiveView> serves both live and recorded. The
  // playback MACHINE (`usePlaybackMachine`) is the SINGLE owner of the playhead +
  // live/playback mode for this camera instance. The embed reports position +
  // state INTO the machine (subordinate to `mode`); the timeline drives playback
  // OUT through `liveRef` via the sink. No tap-to-enter-VOD gate (a `seek` enters
  // recorded mode server-side); no duplicate playhead/mode useState.
  const liveRef = useRef<LiveViewHandle>(null)
  const [capturing, setCapturing] = useState(false)
  const [captureStartedAt, setCaptureStartedAt] = useState<number | null>(null)
  const [captureElapsedSec, setCaptureElapsedSec] = useState(0)
  const capturingRef = useRef(false)
  useEffect(() => {
    if (!capturing || captureStartedAt === null) {
      setCaptureElapsedSec(0)
      return
    }
    const tick = (): void => setCaptureElapsedSec(Math.floor((Date.now() - captureStartedAt) / 1000))
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [capturing, captureStartedAt])
  // Bumped on Go-Live to remount the player (fresh WebRTC session → live edge).
  const [liveReloadKey, setLiveReloadKey] = useState(0)

  // ── Initial seek (the `?at=` navigation) ──────────────────────────────────
  // The instant now travels INSIDE the embed config (`initialSeekMs`): a NEW
  // embed enters recorded on its own the moment its control channel opens — no
  // RN round-trip, no live-first flash. Two pieces of host state:
  //  • `pendingInitialSeek` — the deferred RN-bridge seek, kept as the FALLBACK
  //    for an OLD embed (deployed before the config field) that ignores it.
  //  • `embedInitialSeek` — the value still advertised to the embed config.
  //    Cleared once the seek settles, so a WebView reload (auto-retry) or the
  //    Go-Live remount can never re-seek to the stale deep-link instant.
  const pendingInitialSeek = useRef<number | null>(initialSeekMs ?? null)
  const [embedInitialSeek, setEmbedInitialSeek] = useState<number | undefined>(initialSeekMs)
  /**
   * The clip a freshly mounted player must open on, instead of live.
   *
   * Set when a clip is dispatched while no player is mounted — the normal case
   * on a held or sleeping camera, where the gate deliberately keeps the live
   * peer down. Without it the command went to `liveRef.current?.playClip` and
   * `?.` dropped it: measured on 3628 (battery, asleep), the chain reached
   * `open: port` with `hasPlayer: false` and stopped (2026-09-21).
   *
   * It also ARMS the mount (`shouldMountLiveView`), and mounting for a clip
   * wakes nothing: the bytes are a file the hub serves, and the page enters it
   * on its first channel without ever dialling live.
   */
  const [embedInitialClip, setEmbedInitialClip] = useState<
    { readonly clipId: string; readonly provider: string; readonly profile?: string } | undefined
  >(undefined)

  const sink = useMemo<PlaybackControlSink>(
    () => ({
      scrubStart: (dragId) => {
        liveRef.current?.scrubStart(dragId)
      },
      scrubTo: (epochMs, hint) =>
        liveRef.current?.scrubTo(epochMs, hint?.mode, hint?.velocityPxPerS),
      scrubCommit: (epochMs, dragId) => liveRef.current?.scrubCommit(epochMs, dragId),
      seek: (epochMs) => liveRef.current?.seek(epochMs),
      // Return to live = REMOUNT the player (fresh WebView → fresh embed → a new
      // WebRTC session at the live edge, killing the old recorded feeder so its
      // stale position reports can't bounce the timeline back). `goLive()` on the
      // stale embed is a best-effort fast-path if it supports it.
      goLive: () => {
        // A held battery camera: the machine still snaps the timeline home
        // (GO_LIVE is dispatched before this sink runs). Driving the peer —
        // inject goLive, remount LiveView — would wake the firmware. Play
        // is the only wake (2026-08-23).
        if (!shouldDialLiveOnGoLive(liveHeldRef.current)) {
          pendingInitialSeek.current = null
          setEmbedInitialSeek(undefined)
          setRecPaused(false)
          setSpeed(1)
          return
        }
        liveRef.current?.goLive()
        setLiveReloadKey((k) => k + 1)
        // Fresh live session → recorded transport state resets.
        setRecPaused(false)
        setSpeed(1)
        // Go-Live is an explicit "stay live": drop any unsettled deep-link seek
        // so the remounted player's fresh config cannot re-enter recorded.
        pendingInitialSeek.current = null
        setEmbedInitialSeek(undefined)
      },
    }),
    [],
  )
  const playback = usePlaybackMachine(sink)

  // ── The clip surface (D570, revised) ──────────────────────────────────
  //
  // A clip that is a FILE is NOT a mode of the playback machine: 1.0.512 made
  // it one, and a mode that GO_LIVE could not leave removed the only brake on
  // `use-timeline-scrub`'s go-live echo — continuous haptics and a wedged app
  // on 3629. See `recording/__tests__/go-live-terminator.spec.ts`.
  //
  // The machine is therefore untouched while a clip plays, which is why there
  // is nothing to restore when it closes: nothing was taken. A sleeping
  // battery camera is still on its poster because the battery gate — not this
  // code — decides, and it never changed.
  // The clip plays in THIS screen's player (D575) — one message on the control
  // channel the seek and the scrub already use. Wrapped so the hook holds a
  // stable port and never the ref itself.
  // ONE object, minted once: the hook derives its seek callbacks from it, and
  // a fresh object per render would re-mint them per render and churn every
  // prop they reach.
  const clipStagePorts = useMemo<ClipStagePorts>(
    () => ({
      playClip: (clipId: string, provider: string, offsetMs: number, profile?: string): boolean => {
        // The second silent hop: `liveRef` is null whenever the player is not
        // mounted — a battery camera held, a screen still warming — and `?.`
        // dropped the command with nothing to read.
        const player = liveRef.current
        // A player that is still `connecting` has a ref and no channel: a
        // command sent into it is the same silent drop wearing a different
        // hat, which is why `shouldAssertClip` refuses that state too. The
        // ANSWER below must agree with that rule or the record would claim an
        // assertion that never landed.
        const canHear =
          playerStateRef.current !== 'connecting' && playerStateRef.current !== 'error'
        noteClipOpenStep('port', {
          clipId,
          provider,
          offsetMs,
          profile: profile ?? null,
          hasPlayer: player !== null,
          canHear,
        })
        if (player === null || !canHear) {
          // Nobody to speak to — the ordinary case on a held camera. Carry the
          // clip into the mount instead of dropping it: the gate reads this
          // and brings the page up straight into the file.
          setEmbedInitialClip({ clipId, provider, ...(profile === undefined ? {} : { profile }) })
          return false
        }
        player.playClip(clipId, provider, offsetMs, profile)
        return true
      },
      // Written by whoever SENT, which is the whole point: this record had one
      // writer and two senders, so the tap's send was never recorded and the
      // re-assert effect fired a second injection for every tap.
      noteAsserted: (stageClipId: string): void => {
        assertedClipRef.current = stageClipId
      },
      // The seek INSIDE the file: the same scrub family the timeline drives,
      // straight to the player and never through the machine — a clip leaves
      // the machine where it was (D570). The broker routes these to the clip
      // feeder on the file's own axis while a clip holds the pointer.
      scrubStart: (dragId: string): void => {
        liveRef.current?.scrubStart(dragId)
      },
      scrubTo: (positionMs: number): void => {
        liveRef.current?.scrubTo(positionMs)
      },
      scrubCommit: (positionMs: number, dragId: string | undefined): void => {
        liveRef.current?.scrubCommit(positionMs, dragId)
      },
    }),
    [],
  )
  // The hook is where the end of a file is KNOWN (the player's `ended`
  // report) and where `replay()` lives, so the loop is decided there — never
  // by a second watcher comparing a position with a duration.
  const clipStage = useClipStage(clipStagePorts, clipLoop)
  // The clip list the timeline's body is showing, published by it. Kept here
  // only so the frame can STEP through it; never re-derived.
  const [frameClips, setFrameClips] = useState<readonly Clip[]>(EMPTY_FRAME_CLIPS)
  // A DERIVED array put in state is only safe if its identity means something.
  // The timeline republishes on every render whenever any dependency of
  // `derivedClips` churns, and adopting each of those blindly is a setState
  // loop that starved the JS thread on 3629. `adoptClipList` keeps the previous
  // reference when the list says the same thing, which is what React bails out
  // on. See `clips/clip-list-identity.ts`.
  const publishFrameClips = useCallback((next: readonly Clip[]): void => {
    setFrameClips((prev) => adoptClipList(prev, next))
  }, [])

  // Timeline warm-up (spec 2026-08-07 §4): tell the hub to pre-run
  // locate + read + demux around the playhead the timeline OPENS on, so the
  // FIRST drag's frame pays none of that chain (measured 531 ms p50 cold vs
  // 28 ms warm on the recordings spindle). Fire-and-forget and safe while
  // live; the embed silently no-ops until its session is up, hence the delay
  // and the retry. Server-side idle warm covers every LATER landing — this is
  // the one moment it cannot cover (no seek has happened yet).
  useEffect(() => {
    const timers = [3_000, 10_000].map((delayMs) =>
      setTimeout(() => liveRef.current?.timelineWarm(Date.now() - 30_000), delayMs),
    )
    return () => {
      for (const t of timers) clearTimeout(t)
    }
  }, [])

  // Recorded transport controls (advanced playback — server-side WebRTC feeder).
  const isRecorded = playback.state.mode !== 'live'
  // Held battery cameras: LiveView mounts only for a committed recording (or a
  // deep-link seek). The first scrub frame used to flip `isRecorded` and dial
  // live; a gap then kept the live peer. Play is the only wake.
  /**
   * Close the clip AND forget the seed.
   *
   * The seed is what a freshly mounted page opens on. Left behind, a later
   * remount would replay a clip nobody asked for — and while it stood, the
   * mount gate had a reason to keep a sleeping camera's player up.
   */
  const closeClipStage = useCallback((): void => {
    setEmbedInitialClip(undefined)
    clipStage.close()
  }, [clipStage])

  /**
   * Go-live LEAVES the clip — the operator's answer to "where does exiting a
   * clip land you": go-live goes to the live view; prev/next keep you in the
   * list (`clip-transport.ts`, `planClipExit`).
   *
   * The server already leaves the clip on `goLive` in one dispatch (D570);
   * this is the app's half, which did not exist: `playback.goLive()` ran the
   * machine and the sink and never touched the stage, so the frame went on
   * "holding" a clip the server had dropped. Stage first, machine second —
   * closing the stage is what lets a held camera's mount gate drop the
   * player (its sink refuses to dial), and what stops a normal camera's
   * remount from reopening the seed.
   */
  const leaveClipToLive = useCallback((): void => {
    closeClipStage()
    playback.goLive()
  }, [closeClipStage, playback])

  const recordedSessionMountedRef = useRef(false)
  /** The clip on the frame right now — the only reason to hold a held camera's
   *  player up, and it ends when the clip does. */
  const clipHoldingFrame = clipStage.stage.kind === 'clip' ? clipStage.stage.clipId : null

  /**
   * RE-ASSERT the held clip whenever a player is there to hear it.
   *
   * The command used to be fired once, at the tap, and dropped when
   * `liveRef.current` was null. The trace from the operator's session:
   *
   *   08:13:39  open: port  hasPlayer: false      ← tap dropped
   *   08:13:39  connecting ×3, mount→playing      ← the tap MOUNTED the player
   *   08:13:59  playing → connecting              ← reconnect, the clip is gone
   *
   * So tapping a clip mounted the player, and the player was born on the LIVE
   * edge: *"faccio partire una clip → parte la live"*. Prev/next ran the same
   * dispatch and fell in the same hole, which is why they "did nothing".
   *
   * `initialClip` covers only the case where there is no component yet — its
   * payload is read AT PAGE LOAD — and `liveRef.current === null` also means
   * "mounted this very render, ref not attached". One branch, two situations,
   * and the second one was silent. A clip on the stage is a STATE, so it is
   * re-asserted idempotently (`clip-assert-on-player.ts`), and a reconnect —
   * which drops the clip on the server side too — clears the record so it is
   * asserted again rather than assumed.
   */
  useEffect(() => {
    const playerPresent = liveRef.current !== null
    assertedClipRef.current = assertionAfterPlayerChange(
      assertedClipRef.current,
      playerPresent,
      playerStatus.state,
    )
    if (
      !shouldAssertClip({
        heldClipId: clipHoldingFrame,
        playerPresent,
        playerState: playerStatus.state,
        assertedClipId: assertedClipRef.current,
      })
    ) {
      return
    }
    if (clipHoldingFrame === null) return
    noteClipOpenStep('assert', {
      clipId: clipHoldingFrame,
      playerState: playerStatus.state,
    })
    assertedClipRef.current = clipHoldingFrame
    // The hook re-sends exactly what it sent the first time — the FILE id, the
    // provider and the profile. The stage knows which clip the operator
    // picked; only the hook knows what was dispatched for it.
    clipStage.replay()
  }, [clipHoldingFrame, playerStatus.state, clipStage])
  /** The held clip's own start, for every label around the picture. */
  const clipEpochOnFrame = clipStartOnFrame(frameClips, clipStage.stage)
  const mountLiveView = shouldMountLiveView({
    liveHeld: paused,
    mode: playback.state.mode,
    playhead: playback.state.playhead,
    recordedSeekMs: embedInitialSeek ?? null,
    keepRecordedSession: recordedSessionMountedRef.current,
    // The STAGE, not the seed. The seed is a one-shot config value; the reason
    // to hold the player up is that a clip is on the frame RIGHT NOW.
    //
    // Reading the seed kept the gate armed for ever, because nothing cleared
    // it: the player stayed mounted after the clip ended and a sleeping
    // battery camera was dialled live — it woke, which is the one thing this
    // gate exists to prevent (reported 2026-09-21, and introduced by the fix
    // that mounted for a clip in the first place).
    initialClipId: clipHoldingFrame,
  })
  recordedSessionMountedRef.current = mountLiveView
  // First recorded entry while the player is unmounted: the commit's sink.seek
  // would hit a null ref. Seed the same config-carried seek the deep-link uses
  // so the embed enters recorded the moment its channel opens — never live first.
  const seedRecordedEntryIfUnmounted = (epoch: number): void => {
    if (!paused) return
    if (liveRef.current != null) return
    pendingInitialSeek.current = epoch
    setEmbedInitialSeek(epoch)
  }
  const onSeek = useCallback(
    (epoch: number, source: ScrubSource): void => {
      seedRecordedEntryIfUnmounted(epoch)
      playback.seek(epoch, source)
    },
    [paused, playback],
  )
  const onScrubCommit = useCallback(
    (epoch: number, source: ScrubSource): void => {
      seedRecordedEntryIfUnmounted(epoch)
      playback.commitScrub(epoch, source)
    },
    [paused, playback],
  )
  const finishLiveCapture = async (): Promise<{ mime: string; base64: string } | null> => {
    if (!capturingRef.current) return null
    capturingRef.current = false
    setCapturing(false)
    setCaptureStartedAt(null)
    try {
      return (await liveRef.current?.stopLiveCapture()) ?? null
    } catch {
      notice({ title: t('v2.theater.recordLive'), message: t('v2.theater.recordFailed') })
      return null
    }
  }
  const shareLiveClip = async (clip: { mime: string; base64: string }): Promise<void> => {
    const ext = captureFileExtension(clip.mime)
    const uri = `${FileSystem.cacheDirectory}live-${deviceId}-${Date.now()}.${ext}`
    await FileSystem.writeAsStringAsync(uri, clip.base64, {
      encoding: FileSystem.EncodingType.Base64,
    })
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: clip.mime || (ext === 'webm' ? 'video/webm' : 'video/mp4'),
        UTI: ext === 'webm' ? 'public.movie' : 'public.mpeg-4',
      })
    }
  }
  /**
   * The rescue prompt for a capture the OPERATOR did not stop.
   *
   * Pausing, the picture becoming a wall, or leaving the live edge all tear the
   * recorder down mid-clip. The bytes exist and nobody has said what to do with
   * them, so they are offered. It is deliberately NOT the ending of a normal
   * capture any more: that one ends on Keep or Discard, pressed, and a dialog
   * asking the same question again after the operator already answered it is
   * the second affordance this screen was told not to grow.
   */
  const promptKeepLiveClip = (clip: { mime: string; base64: string }): void => {
    void (async (): Promise<void> => {
      const keep = await confirm({
        title: t('v2.theater.keepClipTitle'),
        confirmLabel: t('v2.theater.shareClip'),
        cancelLabel: t('v2.theater.discardClip'),
      })
      if (!keep) return
      await shareLiveClip(clip)
    })()
  }
  const startLiveCapture = (): void => {
    capturingRef.current = true
    setCapturing(true)
    setCaptureStartedAt(Date.now())
    liveRef.current?.startLiveCapture()
  }
  const keepLiveCapture = (): void => {
    void (async () => {
      const result = await finishLiveCapture()
      if (result) await shareLiveClip(result)
    })()
  }
  const discardLiveCapture = (): void => {
    // The recorder is still stopped: the clip lives inside the WebView until it
    // is, and a discard that only hid the chip would leave it writing. The
    // bytes come back and are dropped here — nothing is written to disk, so
    // there is nothing to clean up.
    void finishLiveCapture()
  }
  const onLiveCaptureError = (): void => {
    capturingRef.current = false
    setCapturing(false)
    setCaptureStartedAt(null)
    notice({ title: t('v2.theater.recordLive'), message: t('v2.theater.recordFailed') })
  }
  /**
   * The live half of the bar's ONE record control (`record-control.ts` picks
   * which half the mode gets).
   *
   * Assembled here rather than inline in the JSX: an object literal built in
   * the element is render-phase data as far as the React Compiler is concerned,
   * and the `Date.now()` inside `startLiveCapture` then reads as an impure call
   * during render (`react-hooks/purity`).
   */
  const liveCaptureBinding: LiveCaptureFlow = {
    capturing,
    // The SAME formatter the selection's duration uses, so the two chips read
    // alike in the slot they share.
    elapsedLabel: formatSelectionDuration(captureElapsedSec * 1000),
    onStart: startLiveCapture,
    onKeep: keepLiveCapture,
    onDiscard: discardLiveCapture,
  }
  // The recorded-export selection, in one hook: the MODE is the playback
  // machine's (`selectionAnchor`), the hub call is `use-export-selection.ts`'s.
  const exportSelection = useExportSelection(deviceId, name, playback)

  // The frame on screen, cut by the embed player (live or recorded) and put in
  // the Activity list. The player's own capture, never a hub call: the operator
  // asked for the picture they are looking at, and the hub only knows the
  // camera's present.
  const addActivity = useActivityStore((s) => s.add)
  const takeSnapshot = useCallback((): void => {
    void (async () => {
      const failed = (): void =>
        notice({ title: t('v2.activity.title'), message: t('v2.activity.snapshotFailed') })
      const player = liveRef.current
      if (player === null) {
        failed()
        return
      }
      try {
        const frame = await player.captureSnapshot()
        const now = Date.now()
        const atMs = selectActiveEpoch(playback.state) ?? now
        const saved = await saveSnapshot(frame.base64, `snapshot-${deviceId}-${atMs}`)
        if (saved === null) {
          failed()
          return
        }
        addActivity(
          snapshotItemFrom({
            uid: `${deviceId}-${now.toString(36)}`,
            deviceId,
            cameraName: name,
            atMs,
            fileUri: saved.uri,
            mime: saved.mime,
            now,
          }),
        )
        notice({ title: t('v2.activity.title'), message: t('v2.activity.snapshotSaved') })
      } catch (error) {
        log.warn('activity', 'snapshot failed', {
          deviceId,
          error: error instanceof Error ? error.message : String(error),
        })
        failed()
      }
    })()
  }, [addActivity, deviceId, name, notice, playback, t])

  // A clip taking the frame ends a running capture exactly as leaving the live
  // edge does: the <video> is about to show a stored file, and a recorder left
  // running would capture it as if it were the live picture
  // (`clip-transport.ts`, `shouldEndLiveCapture`). The machine stays `live`
  // under a clip (D570), so the mode alone never fired this.
  const clipHeld = clipStage.stage.kind === 'clip'
  useEffect(() => {
    if (!shouldEndLiveCapture({ mode: playback.state.mode, clipHeld })) return
    if (!capturingRef.current) return
    void (async () => {
      const result = await finishLiveCapture()
      if (result) promptKeepLiveClip(result)
    })()
  }, [playback.state.mode, clipHeld])
  const onToggleRecPause = useCallback(() => {
    // PURE state updater + side effect OUTSIDE it. The old shape called
    // `setRate` inside the updater, and React may invoke an updater more than
    // once — captured on-device as setRate 1→0→1→0 flapping within 300 ms:
    // pause became unreliable, jogs resumed playing, and recorded audio kept
    // sounding through "pause".
    const next = !recPaused
    setRecPaused(next)
    liveRef.current?.setRate(next ? 0 : speed)
  }, [recPaused, speed])
  const onSelectRate = useCallback(
    (next: number) => {
      setSpeed(next)
      // Apply immediately while playing; while paused it becomes the resume rate.
      if (!recPaused) liveRef.current?.setRate(next)
    },
    [recPaused],
  )
  const onStepFrame = useCallback(
    (dir: 1 | -1) => {
      // The server treats stepFrame as atomic pause+jog; mirror that state
      // locally without a separate setRate message that can race the jog.
      if (!recPaused) setRecPaused(true)
      liveRef.current?.stepFrame(dir)
    },
    [recPaused],
  )

  // Settling the initial seek. 'adopt' = the embed already honoured the
  // config-carried instant (it is playing the target) — move the MACHINE into
  // playback without re-driving the player; 'seek' = the embed ignored (or
  // failed) it — fire the deferred RN-bridge seek exactly as before.
  const settleInitialSeek = useCallback(
    (action: 'adopt' | 'seek'): void => {
      const pending = pendingInitialSeek.current
      if (pending === null) return
      pendingInitialSeek.current = null
      setEmbedInitialSeek(undefined)
      if (action === 'adopt') playback.adoptSeek(pending, 'cluster')
      else playback.seek(pending, 'cluster')
    },
    [playback],
  )
  // The recorded tier the embed is really on — drawn as a small badge by the
  // play control, never a message: the operator asked for High, the hub had
  // Mid here, the bar says so and nothing else moves.
  const [servedTier, setServedTier] = useState<ServedProfileReport | null>(null)
  const servedTierRef = useRef<ServedProfileReport | null>(null)
  servedTierRef.current = servedTier
  // After AppState foreground the host reconnects the WebRTC peer; the broker's
  // recorded pointer is gone unless we playRecorded at the machine playhead.
  const pendingRecordedReassertRef = useRef(false)
  const reassertEpochRef = useRef<number | null>(null)
  const reassertProfileRef = useRef<string | null>(null)
  const playbackModeRef = useRef(playback.state.mode)
  playbackModeRef.current = playback.state.mode
  const activeEpochRef = useRef(selectActiveEpoch(playback.state))
  activeEpochRef.current = selectActiveEpoch(playback.state)
  const clipHoldingFrameRef = useRef<string | null>(null)
  clipHoldingFrameRef.current = clipHoldingFrame
  const onPeerReconnect = useCallback((): void => {
    if (
      !shouldReassertRecordedOnReconnect({
        playbackMode: playbackModeRef.current,
        playheadEpoch: activeEpochRef.current,
        clipHoldingFrame: clipHoldingFrameRef.current,
      })
    ) {
      return
    }
    const epoch = activeEpochRef.current
    if (epoch === null) return
    reassertEpochRef.current = epoch
    reassertProfileRef.current = resolveRecordedProfileForReconnect(
      liveTarget,
      servedTierRef.current?.profile ?? null,
    )
    pendingRecordedReassertRef.current = true
  }, [liveTarget])
  useEffect(() => {
    if (!pendingRecordedReassertRef.current) return
    if (playerStatus.state !== 'playing') return
    const epoch = reassertEpochRef.current
    const profile = reassertProfileRef.current
    pendingRecordedReassertRef.current = false
    reassertEpochRef.current = null
    reassertProfileRef.current = null
    if (epoch === null || profile === null) return
    if (playbackModeRef.current === 'live') return
    log.info('playback', 'foreground reconnect → playRecorded', {
      tags: { deviceId },
      epoch,
      profile,
    })
    liveRef.current?.playRecorded(epoch, profile)
    if (recPaused) liveRef.current?.setRate(0)
  }, [playerStatus.state, deviceId, recPaused])
  const reportClipPlayerState = clipStage.reportPlayerState
  const onEmbedPlaybackState = useCallback(
    (embed: Parameters<typeof playback.reportEmbedState>[0]): void => {
      playback.reportEmbedState(embed)
      // The clip's own wait: the machine ignores `loading` (it adopts only
      // gap/error while in playback), so under a clip the report has to reach
      // the stage or the ring never clears.
      reportClipPlayerState(embed)
      if (embed === 'paused') setRecPaused(true)
      else if (embed === 'playing') setRecPaused(false)
      // A held camera that landed on a gap/error must drop the entry seek so
      // a later go-live (mode back to live with recordedSeekMs still set)
      // cannot remount the live peer.
      if (embed === 'gap' || embed === 'error') {
        pendingInitialSeek.current = null
        setEmbedInitialSeek(undefined)
      }
      // The FIRST embed state report settles the pending `?at=` seek: a
      // recorded-flow state confirms the config-carried seek (adopt, never
      // re-seek); live/error means an old embed / a failed start (fall back to
      // the RN-bridge seek, as this handler always did).
      settleInitialSeek(resolveInitialSeekAction(embed))
    },
    [playback, settleInitialSeek, reportClipPlayerState],
  )

  const [muted, setMuted] = useState(true)
  // Apply the persisted "audio on open" MODE once both documents have hydrated
  // (the global mode and this camera's remembered choice), then leave the
  // user's manual mute toggles alone. Starts muted and only ever moves off it
  // deliberately — the wait for storage must never itself be a moment of sound.
  const audioApplied = useRef(false)
  useEffect(() => {
    if (hydrated && prefsHydrated && !audioApplied.current) {
      audioApplied.current = true
      setMuted(opensMuted(settings.stream.audioOnOpen, storedAudioOn))
    }
  }, [hydrated, prefsHydrated, settings.stream.audioOnOpen, storedAudioOn])

  // The video overlays now come from `overlay` above — see the overlay panel.
  // Four INDEPENDENT layers, each with its own membership test: the parked
  // objects used to ride `objects`, which defaults off, so a fresh install
  // never drew one and "parked only" was inexpressible.
  const motionRegionsOn = hasLayer(overlay, 'motion')
  const detectionBoxesOn = hasLayer(overlay, 'objects')
  const discardedBoxesOn = hasLayer(overlay, 'discarded')
  const stationaryBoxesOn = hasLayer(overlay, 'stationary')
  const statsPosition: OverlayPosition = overlay.stats
  const streamAspect = useStreamAspect(deviceId)
  const audioPosition: OverlayPosition = overlay.audioMeter
  const deviceInfoPosition = useSettingsStore((s) => s.settings.deviceInfo)
  const [fullscreen, setFullscreen] = useState(false)
  // Controls visibility is owned here so the stage's single-tap gesture (not a
  // touch-stealing overlay Pressable) can toggle it alongside pinch/pan.
  const [controlsVisible, setControlsVisible] = useState(true)
  // The fullscreen PTZ pad (`PtzOverlay`), opened by its disc in the on-video
  // cluster (operator, 2026-10-23). A press on the pad bumps `chromeActivity`,
  // which restarts the discs' auto-hide: steering is using the chrome.
  const [ptzOverlayOpen, setPtzOverlayOpen] = useState(false)
  const onTogglePtzOverlay = useCallback(() => setPtzOverlayOpen((open) => !open), [])
  const [chromeActivity, setChromeActivity] = useState(0)
  const onChromeActivity = useCallback(() => setChromeActivity((n) => n + 1), [])
  // Where the timeline sits in landscape fullscreen: off, over the stream, or
  // beside it. Seeded from the last choice on this device and written back on
  // every change; it is only ever APPLIED in `fill` (`timelineDock` below), so
  // rotating to portrait does not lose it.
  const [dockChoice, setDockChoice] = useState<TimelineDock>(settings.stream.landscapeTimeline)
  const setTimelineDock = useCallback(
    (next: TimelineDock) => {
      setDockChoice(next)
      setStreamDefault('landscapeTimeline', next)
    },
    [setStreamDefault],
  )
  // The robot's drive overlay reaches the timeline's controls panel through
  // this handle: in `fill` the panel rides the drawer, so the "…" opens the
  // drawer AND asks for the `ptz` kind — the toolbar chip's own — rather than
  // a second panel of its own (operator, 2026-09-06).
  const timelineRef = useRef<TheaterTimelineHandle>(null)
  const onOpenDriveControls = useCallback(() => {
    // Over the stream unless it is already on screen (beside it counts).
    setDockChoice((dock) => (dock === 'off' ? 'overlay' : dock))
    timelineRef.current?.openControls()
  }, [])

  // Timeline zone filter (v0, client-side): the rect is DRAWN over the video
  // box (ZoneDrawOverlay) but consumed by the timeline, so the screen owns
  // both the active zone and the drawing flag. Camera-specific geometry —
  // dropped when the device changes (render-time adjustment, no effect).
  const [timelineZone, setTimelineZone] = useState<ZoneShape | null>(null)
  const [zoneDrawing, setZoneDrawing] = useState(false)
  // The zone's own reset moved into the ONE camera-swap block below — see
  // `shownDeviceId`. It was the only piece of per-camera state that already
  // handled a device change in place, and it is the pattern the rest now follow.
  const onRequestZoneDraw = useCallback(() => setZoneDrawing(true), [])
  // Turns the whole zone flow off: cancels a drawing in progress AND drops the
  // applied zone, back to the normal timeline.
  const onClearZone = useCallback(() => {
    setZoneDrawing(false)
    setTimelineZone(null)
  }, [])
  const onZoneConfirm = useCallback((zone: ZoneShape) => {
    setTimelineZone(zone)
    setZoneDrawing(false)
  }, [])
  const onZoneCancel = useCallback(() => setZoneDrawing(false), [])

  // The two numbers the operator says disagree, compared for the first time.
  // `reportPosition` feeds the machine as before; the extra work is only a
  // measurement, and it logs at most once per DIVERGENCE_REPORT_INTERVAL_MS so
  // a standing drift is one line a spell rather than one per position message.
  const lastDivergenceAtRef = useRef<number | null>(null)
  // Finger down → first scrub frame PAINTED. The embed has emitted this all
  // along and nothing consumed it, so the decode+paint leg of a drag — the
  // half the hub cannot see — had no number at all.
  const onScrubDrawn = useCallback((): void => {
    scrubFramePainted(deviceId)
  }, [deviceId])

  const reportClipPosition = clipStage.reportPosition
  const onPlayerPosition = useCallback(
    (epochMs: number) => {
      // While a clip holds the frame the number is FILE-RELATIVE — the
      // parameter's name lies — and it belongs to the clip surface, not to
      // the machine: fed through, it landed as a playhead of 1970 on a
      // timeline that had been scrubbed before the clip was opened.
      if (reportClipPosition(epochMs)) return
      // Belt and braces for the config-carried initial seek: only the recorded
      // feeder ever emits positions, so a position with the seek still pending
      // proves the embed entered recorded on its own — adopt BEFORE reporting,
      // so the machine is in playback mode (with the anchor armed) when this
      // very report reconciles.
      settleInitialSeek('adopt')
      playback.reportPosition(epochMs)
      const nowMs = Date.now()
      const report = evaluateDivergence({
        indicatorEpoch: selectActiveEpoch(playback.state),
        playerEpoch: epochMs,
        nowMs,
        lastReportAt: lastDivergenceAtRef.current,
      })
      if (report === null) return
      lastDivergenceAtRef.current = nowMs
      log.warn('theater:divergence', 'indicator and stream disagree', {
        deviceId,
        deltaMs: report.deltaMs,
        indicatorAhead: report.indicatorAhead,
        indicatorEpoch: selectActiveEpoch(playback.state),
        playerEpoch: epochMs,
        mode: playback.state.mode,
        seekAnchor: playback.state.seekAnchor,
        seekLanded: playback.state.seekLanded,
      })
    },
    [playback, deviceId, settleInitialSeek, reportClipPosition],
  )

  /**
   * The manual toggle — and the ONLY writer of this camera's remembered audio
   * choice. Every automatic mute (opening, a camera swap) is deliberately
   * silent here: remembering those would make the memory a copy of the last
   * RESOLUTION instead of the last decision, and `last-selected` would
   * eventually just mean "muted".
   */
  const onToggleMute = useCallback(() => {
    // Not the functional `setMuted(m => …)` form: persisting is a side effect
    // and a state updater must stay pure (React may call it twice).
    const next = !muted
    setMuted(next)
    setCameraAudioOn(deviceId, !next)
  }, [muted, deviceId, setCameraAudioOn])
  /**
   * Single tap on a switcher row (or a reel card) → SWITCH the detail view to
   * that camera, AT THE MOMENT THIS SCREEN IS SHOWING.
   *
   * ## The instant travels (2026-09-12, D483)
   *
   * This used to send "minimal params (no `?at`) — the new camera opens LIVE",
   * and that sentence is now false: the operator asked for «se sono in playback
   * deve rimanere allo stesso istante sulla nuova camera». So the gesture means
   * "camera B at the moment I am looking at" — exactly the verb the reel's
   * on-demand entry point carries, and both read the same computation
   * (`recording/viewed-instant.ts`).
   *
   * Live carries NOTHING, which is the half that would break silently: an
   * `?at=<now>` would open camera B in RECORDED playback a fraction of a second
   * behind the live edge — a feeder, a seek, and a picture that never catches
   * up — for a gesture the operator reads as "show me this camera". `atParam`
   * owns that rule and asserts both directions.
   *
   * ## What is unchanged, and why
   *
   * `replace`, not `push`: backing out still returns to the LIST, and that
   * gesture carries meaning (see `forgetLastCamera` below — backing out of a
   * camera is the operator finishing with it).
   *
   * And the route still changes, so the screen still REMOUNTS. That is the
   * operator's other request («cambia semplicemente la camera nello scope
   * corrente senza ricaricare tutto») and it is deliberately not answered here:
   * the id is a path SEGMENT, so changing camera changes the route. The
   * in-place swap is a separate piece of work whose finding is recorded in
   * `docs/history/sessions.md` — the embed can ALREADY do it
   * (`embed/src/embed/set-device-command.ts`) and the host has no command to
   * ask. Carrying the instant is correct either way: `?at=` is what expresses
   * it today and `setDevice` would carry the same number tomorrow, so this
   * change is not work that the in-place swap throws away.
   *
   * A camera with no footage at that instant is NOT pre-checked. The coverage
   * read is per-day and cached, so a stale "no coverage" would refuse a valid
   * seek; instead the new screen opens at the instant and says so — the embed
   * reports `gap`, the playback bar draws it, and the heatmap tape shows no
   * band under the cursor. The line below is what makes the case findable.
   */
  const onSwitchCamera = useCallback(
    (id: number) => {
      if (id === deviceId) return
      const instant = viewedInstant(selectActiveEpoch(playback.state))
      log.info('theater', 'switch camera', {
        tags: { deviceId: id },
        from: deviceId,
        carrying: instant.kind === 'at' ? instant.atMs : 'live',
      })
      router.replace(`/camera/${id}${atParam(instant)}`)
    },
    [router, deviceId, playback.state],
  )
  // Multiselect (2+) → an ON-THE-FLY grid of the selected cameras: a transient
  // route-param grid (`/grid/adhoc?devices=…`), never persisted (see
  // GridViewScreen ad-hoc mode). Full-screen on every form factor.
  // The shelf's per-camera bar posts the SAME intent a wall tile posts, and it
  // is answered by the SAME host (`GridCellPanelOverlay`) — so PTZ, linked
  // devices and the view-options menu for another camera are not a third
  // implementation. The panel carries its own device id, so "a panel is open"
  // and "there is a camera to open it for" cannot disagree.
  const [cellPanel, setCellPanel] = useState<GridCellPanel | null>(null)
  // Backing out of THIS camera is the operator finishing with it — the one
  // gesture (with pressing Cameras while on it) that clears the remembered
  // camera. Leaving for another tab deliberately does not.
  const forgetLastCamera = useLastCameraStore((st) => st.forget)
  const onShelfPanel = useCallback((kind: GridCellPanelKind, id: number): void => {
    setCellPanel({ kind, deviceId: id })
  }, [])
  /**
   * A reel card asked for the on-demand player (D483): THAT camera, at the
   * moment THIS screen is showing.
   *
   * The instant is resolved here because the screen owns the playback machine —
   * a card that read `activeEpoch` would re-render on every tick of the
   * playhead, and the reel is a list of them. `resolveReelInstant` turns the
   * machine's live edge (`activeEpoch === null`) into `'live'` — never into
   * wall-clock now, which the embed would open as a recorded seek.
   */
  const onShelfOpenPlayback = useCallback(
    (id: number): void => {
      openOnDemandPlayer({
        deviceId: id,
        atMs: resolveReelInstant(selectActiveEpoch(playback.state)),
      })
    },
    [playback.state],
  )
  const closeCellPanel = useCallback((): void => setCellPanel(null), [])
  const { data: allCameras } = useCameras()
  // The panel is kept only while its camera is still one the shelf could have
  // offered — the wall's own rule, reused. A panel left open for a camera that
  // has gone (a removal, a narrowed permission) describes something the
  // operator cannot see, and its linked devices would still be actionable.
  const shelfPanel = useMemo(
    () =>
      resolveCellPanel(
        cellPanel,
        (allCameras ?? []).map((c) => c.id),
      ),
    [cellPanel, allCameras],
  )
  const shelfPanelCamera = (allCameras ?? []).find((c) => c.id === shelfPanel?.deviceId)
  const shelfPanelCameraName = shelfPanelCamera?.name ?? ''
  const shelfPanelHasPtz =
    canActuate && (shelfPanelCamera?.features ?? []).includes(FEATURE.ptz)

  // Tapping the meter on the video moves it — the fast spatial way, and it
  // writes to the SAME document the panel edits, so the two never disagree.
  const onSetAudioPosition = useCallback(
    (position: OverlayPosition) => onSetOverlay(patchOverlay(overlay, { audioMeter: position })),
    [onSetOverlay, overlay],
  )
  const onToggleControls = useCallback(() => setControlsVisible((v) => !v), [])
  const onHideControls = useCallback(() => setControlsVisible(false), [])

  // System PiP — one button, and the same request the downward fling makes.
  // It must show LIVE: a request made while scrubbing would otherwise
  // picture-in-picture the playhead. goLive REMOUNTS the WebView, so PiP waits
  // until the NEW session is playing. We do NOT change Stack `presentation`
  // here: flipping card → transparentModal remounts the native screen and
  // kills the session (operator-visible error, 2026-08-23).
  //
  // The wait is a resolver, not a flag, because the request is not answered
  // until the whole chain (go live → PiP → confirmed) has come back — see
  // `pip-handoff.ts`, and `live/use-system-pip.ts` for the hook that parks it.
  const goLiveForPip = useCallback((): void => {
    setPlayerStatus({ state: 'connecting' })
    leaveClipToLive()
  }, [leaveClipToLive])
  const startSystemPip = useCallback(
    (): Promise<PipStartResult> => liveRef.current?.startPip() ?? Promise.resolve('unavailable'),
    [],
  )
  // The sequence, the go-live gate and the waiter are `live/use-system-pip.ts`
  // — shared with the on-demand overlay, which asks for the same window from
  // its own `LiveViewHandle`. This screen supplies only its own remount.
  const systemPip = useSystemPip({
    mode: playback.state.mode,
    playerState: playerStatus.state,
    goLive: goLiveForPip,
    startPip: startSystemPip,
  })
  const onStartSystemPip = systemPip.request

  // ── The camera swapped IN PLACE (D483) ─────────────────────────────────────
  //
  // The route used to carry `key={deviceId}`, so a camera change remounted this
  // whole screen and every piece of per-camera state was reset for free. The
  // key is gone — the operator asked for «cambia semplicemente la camera nello
  // scope corrente senza ricaricare tutto» — so the reset is explicit, HERE,
  // and this block is the whole of it.
  //
  // A render-time adjustment and not an effect, which is the pattern the zone
  // state already used in this file. It matters: the reset lands in the SAME
  // commit as the new `deviceId`, so nothing downstream ever observes the new
  // camera next to the old camera's state. An effect would leave exactly that
  // gap for one paint, and a stale read there is a silent wrong-camera bug.
  //
  // The audit behind this list is in `docs/history/sessions.md`. The rule it
  // settled: state that describes THE CAMERA resets; state that describes THE
  // SCREEN survives. `fullscreen`, `controlsVisible`, `landscapeDrawerOpen` and
  // the measured container width are the screen's and are deliberately absent.
  const [shownDeviceId, setShownDeviceId] = useState(deviceId)
  if (shownDeviceId !== deviceId) {
    setShownDeviceId(deviceId)

    // The instant the gesture carries. Read from the machine BEFORE it is
    // reset, because right now it still holds the camera we are leaving.
    const carried = viewedInstant(selectActiveEpoch(playback.state))
    const carriedMs = carried.kind === 'at' ? carried.atMs : undefined

    // The playhead. Reset AND seeded in one action — see `SWAP_CAMERA` for why
    // `GO_LIVE` + `adoptSeek` would not do (a locked machine silently previews).
    playback.swapCamera(carriedMs ?? null)

    // What the player is told to open at. Re-seeded, never merely cleared, or
    // a swap while scrubbing would open the new camera live.
    setEmbedInitialSeek(carriedMs)

    // Transport. A rate or a pause chosen for the old camera is not a
    // preference about the new one, and `recPaused` left true would open the
    // new camera stopped with no visible cause.
    setSpeed(1)
    setRecPaused(false)
    setPauseChoice(null)

    // The picture. `playerStatus` is the loudest of these: left on `playing` it
    // says the NEW camera is up before it has connected, which suppresses the
    // connecting indicator and the poster.
    setPlayerStatus({ state: 'connecting' })
    setServedTier(null)
    // The new camera opens under the same rule a fresh open does — the mode,
    // resolved against THAT camera's memory. `storedAudioOn` and
    // `storedQuality` are already the new camera's: `deviceId` changed before
    // this render-time reset runs.
    setMuted(opensMuted(settings.stream.audioOnOpen, storedAudioOn))
    setQuality(storedQuality ?? 'auto')

    // Camera-specific chrome and overlays.
    setTimelineZone(null)
    setZoneDrawing(false)
    setCellPanel(null)
    setPtzOverlayOpen(false)
    setAudioPreviewUntil(0)

    // A live capture belongs to the session being replaced. The remount used to
    // drop it by destroying the component; now it has to be dropped on purpose,
    // and said out loud — the same treatment the wall transition already gives
    // it.
    setCapturing(false)
    setCaptureStartedAt(null)
    setCaptureElapsedSec(0)

    log.info('theater', 'camera swapped in place', {
      tags: { deviceId },
      from: shownDeviceId,
      carrying: carriedMs ?? 'live',
    })
  }

  /**
   * The REF half of the same swap reset.
   *
   * Split from the render-time block above because a ref WRITTEN during render
   * is what `react-hooks/refs` exists to reject, and it is right to: a ref is
   * not render state. The split is safe precisely because none of these are
   * READ during render — every one of them is consulted from a callback or an
   * effect (the embed's state report, the capture flow, the go-live waiter), all
   * of which run after this effect has.
   *
   * Keyed on the camera, so it fires exactly when the block above does.
   */
  useEffect(() => {
    // The fallback path for a page too old to take the instant with the swap:
    // the seek is re-applied when the rebuilt surface reports its first state.
    pendingInitialSeek.current = embedInitialSeek ?? null
    recordedSessionMountedRef.current = false
    liveHeldRef.current = false
    audioApplied.current = false
    qualityApplied.current = false
    skipAudioPreview.current = true

    // A live capture belongs to the session being replaced. The remount used to
    // drop it by destroying the component; now it is dropped on purpose, and
    // said out loud — the same treatment the wall transition already gives it.
    if (capturingRef.current) {
      log.warn('live:lifecycle', 'live capture dropped: the camera was swapped', {
        tags: { deviceId },
      })
      capturingRef.current = false
    }

    // A pending go-live waiter is awaiting the OLD camera reaching the live
    // edge, and nothing will ever answer it now. The remount collected it with
    // the component; with no remount it would hang forever, so it is answered
    // honestly.
    systemPip.abandon()
    // `embedInitialSeek` is deliberately not a dependency: this is the CAMERA's
    // reset, and it reads the seed the block above has already committed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId])
  /**
   * Arriving on a camera's own screen takes that camera out of the overlay.
   *
   * The overlay survives navigation on purpose, so opening camera X full-screen
   * while the overlay shows X left two pictures of one camera on one screen,
   * each paying for its own media session. The decision is
   * `resolveOnDemandOnFocus` and it lives in `live/ondemand-player.ts`; this is
   * only the arrival that feeds it.
   *
   * Keyed on the camera and NOT on every render, which is the half that matters:
   * `onSwipeToOverlay` opens the overlay on this very camera and leaves the
   * screen afterwards, and a standing condition would delete its product in the
   * gap between those two halves.
   */
  useEffect(() => {
    focusOnDemandCamera(deviceId)
  }, [deviceId])
  // Stats overlay reads live health from the same handle (polled by the overlay).
  const getStats = useCallback(() => liveRef.current?.getStats() ?? Promise.resolve(null), [])

  // Two-way audio: a real intercom session. Surfacing the talk error keeps a
  // denied-mic / unsupported-camera failure visible instead of silent.
  const { talking, error: talkError, toggle: onToggleTalk } = useIntercom(deviceId)
  useEffect(() => {
    if (talkError) notice({ title: t('v2.cameraDetail.talk'), message: t('v2.cameraDetail.talkFailed') })
  }, [talkError, t, notice])

  // ONE layout decision, resolved by a pure function (`detail-layout.ts`):
  //   fill  — the picture owns the window (explicit fullscreen, or a phone in
  //           landscape); the timeline rides the compact edge drawer.
  //   wide  — side by side: stream column left, timeline rail right. A wide web
  //           window or a tablet in landscape ONLY (the 2026-08-08 widening to
  //           phones/foldables was reverted on operator feedback).
  //   stack — the portrait column, with the toolbar hoisted above the stream.
  // Every downstream branch reads `layoutMode` (or the two booleans derived
  // from it once, here) instead of recomputing the question.
  //
  // `screenMinSide` is the DEVICE screen's shortest side, and it is what makes
  // "tablet in landscape" a stable answer: the window height is shrunk by every
  // soft keyboard, and deriving tablet-ness from it flipped a motionless
  // landscape tablet out of its rail mid-typing. See `sidebar-rules.ts`.
  const screenMinSide = useScreenMinSide()
  // Same gate the tab navigator uses, so "wide enough for the rail" has one
  // answer app-wide and the detail cannot disagree with the screen it came from.
  const { showSidebar: showSideNav, compact: sidebarCompact } = useSidebarLayout()
  const pathname = usePathname()
  const layoutInput = {
    width: winWidth,
    height: winHeight,
    screenMinSide,
    isWeb: Platform.OS === 'web',
    fullscreen,
  }
  const layoutMode = resolveDetailLayoutMode(layoutInput)
  const isWideDetail = layoutMode === 'wide'

  // The camera panel's confirm. On a surface with a workspace it WRITES the
  // view and stays put — the operator's "sembra un modal" was never the panel
  // (it takes the timeline body like every other one), it was this callback
  // pushing a whole screen onto a `containedTransparentModal` group. On a phone
  // it still pushes, because a phone has nowhere to draw a view.
  //
  // The store is reached through its ACTION only. A `useWorkspaceStore(s =>
  // s.workspace)` here would re-render the entire theater — the stream slot
  // included — on every add; a zustand action is a stable reference, so the
  // selector runs and nothing renders. That separation is the whole reason
  // `BelowStreamArea` exists as its own component.
  const setWorkspaceMembers = useWorkspaceStore((s) => s.setMembers)

  // The ONE piece of workspace STATE this screen reads, and the exception the
  // paragraph above allows for: the timeline aggregates the view, so the view's
  // membership has to reach it, and no component below can supply it (the
  // timeline is a sibling of `BelowStreamArea`, not its parent).
  //
  // The blast radius is bounded by the selector rather than by a wrapper: every
  // reducer in `workspace.ts` returns the SAME `members` array when membership
  // did not change — a cell resize, a primary change and a no-op add all keep
  // it — so this subscription re-renders the theater only when the answer to
  // "which cameras does the timeline read" actually moved. That is a render the
  // feature is FOR, and a render is not a remount: the player keeps its one
  // parent and its session (`stream-slot.ts`).
  const workspaceMembers = useWorkspaceStore((s) => s.workspace.members)
  // The wall bar's session tier pick, if any — read here only for the
  // timeline's quality chip, which states the wall while it is up.
  const wallQualityPick = useWorkspaceStore((s) => s.wallOptions.quality)
  const setWallOptions = useWorkspaceStore((s) => s.setWallOptions)
  const onWallQualityChange = useCallback(
    (q: StreamQuality) => setWallOptions({ quality: q }),
    [setWallOptions],
  )
  // ONE list: the timeline's scope AND the wall's cells, picture first. They
  // were two derivations until the picture became a cell, and the gate that
  // decided whether to draw a wall counted the wrong one (`workspace-grid.ts`).
  const onScreenIds = useMemo(
    () => workspaceOnScreenCameras(workspaceMembers, deviceId),
    [workspaceMembers, deviceId],
  )

  // Picture or wall — the ONE decision, made here because it decides two things
  // that must never disagree: what goes in the stream slot, and what the reel
  // below it becomes. `BelowStreamArea` is handed the answer rather than
  // recomputing it.
  const wallShowing = shouldShowWorkspaceGrid(layoutMode, workspaceMembers, deviceId)


  // A live capture cannot survive the transition: the wall replaces the
  // `<LiveView>` the blob is being written by, in the same commit, so there is
  // no frame in which to flush it. Reset the flags and SAY SO — a recording
  // that silently stops is the one failure worse than a refused one.
  useEffect(() => {
    if (!wallShowing || !capturingRef.current) return
    capturingRef.current = false
    setCapturing(false)
    setCaptureStartedAt(null)
    log.warn('live:lifecycle', 'live capture dropped: the picture became a wall', { deviceId })
  }, [wallShowing, deviceId])

  const cameraSelection = cameraSelectionModeFor(layoutMode)
  const onCameraSelection = useCallback(
    (ids: readonly number[]) => {
      // The SAME value the panel armed its button with — one derivation, so a
      // confirm that looked enabled can never resolve to `'none'`.
      const outcome = resolveCameraSelection(cameraSelection, ids)
      switch (outcome.kind) {
        case 'buildView':
          setWorkspaceMembers(outcome.members)
          return
        case 'goTo':
          // Deliberately the SAME callback a row tap uses, not a second
          // `router.replace` — one camera means one verb, in one place.
          onSwitchCamera(outcome.deviceId)
          return
        case 'openGrid':
          router.push(`/grid/adhoc?devices=${serializeAdhocDeviceIds(outcome.deviceIds)}`)
          return
        case 'none':
          return
      }
    },
    [cameraSelection, onSwitchCamera, router, setWorkspaceMembers],
  )
  const isLandscape = winWidth > winHeight
  const fill = layoutMode === 'fill'
  // The fullscreen PTZ disc and pad. A robot camera is left out: its drive
  // overlay owns the left of the picture, and its "…" already opens the
  // controls panel that carries PTZ.
  const fullscreenPtz = fill && hasPtz && !hasNavigation
  // The dock only exists in `fill`; elsewhere the timeline is on the page.
  const timelineDock: TimelineDock = fill ? dockChoice : 'off'
  const landscapeDrawerOpen = timelineShown(timelineDock)
  const timelineBeside = timelineDock === 'side'
  const toolbarPlacement = toolbarPlacementFor(layoutMode)
  // Purely the layout question again: the playback band carries play/pause
  // wherever it is drawn, and it is now drawn on every surface including the
  // native clips list (D606). The battery short-circuit that used to be here
  // was a workaround for the one surface that withdrew it.
  const showOverlayPlayPause = shouldShowOverlayPlayPause({ fill, landscapeDrawerOpen })

  // Wide-mode sizing. The column is narrower than the window whenever the app
  // sidebar shows, so it is MEASURED — but a measurement on this screen is a
  // long-lived thing: `freezeOnBlur: false` means the screen is never
  // unmounted, so whatever is latched here governs every later navigation and
  // every rotation. `container-width.ts` carries the three ways that went
  // wrong; the rules are (a) refuse a degenerate pass, (b) a measurement
  // expires with the window it was taken in, (c) the unmeasured answer already
  // knows about the rail instead of pretending the column is the whole window.
  const [measuredWidth, setMeasuredWidth] = useState<MeasuredContainerWidth | null>(null)
  const onRootLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const width = e.nativeEvent.layout.width
      if (!isUsableMeasurement(width)) return
      setMeasuredWidth((prev) =>
        prev !== null && prev.width === width && prev.windowWidth === winWidth
          ? prev
          : { width, windowWidth: winWidth },
      )
    },
    [winWidth],
  )
  const sideNav = useMemo(
    () => ({ visible: showSideNav && !fill, compact: sidebarCompact, insetLeft: insets.left }),
    [showSideNav, fill, sidebarCompact, insets.left],
  )
  const containerWidth = resolveContainerWidth({
    measured: measuredWidth,
    windowWidth: winWidth,
    sideNav,
  })
  // The main navigation, kept on screen over the stream when the operator asks
  // for it. The rail above already does this for a wide window; this is the
  // narrow half that was missing (`camera-detail/stream-nav-bar.ts`).
  const showNavBar = shouldShowStreamNavBar({
    enabled: settings.stream.navBarOnStream,
    showSidebar: showSideNav,
    fill,
  })
  // What the bar takes out of the window — 0 whenever it is not drawn, which is
  // every shipped state today. The column below the picture is sized from what
  // REMAINS rather than from the window, so nothing living under the picture
  // can be squeezed by an amount nobody subtracted. See `streamColumnHeight`.
  const navBarFootprint = bottomNavFootprint({
    visible: showNavBar,
    insetBottom: insets.bottom,
  })
  const columnHeight = streamColumnHeight({ windowHeight: winHeight, navBarFootprint })
  const wideSizes = useMemo(
    () => computeWideDetailSizes({ containerWidth, viewportHeight: columnHeight }),
    [containerWidth, columnHeight],
  )

  // ── The layout decision, on the record (`theater:layout`) ─────────────────
  // ONE line per DECISION CHANGE, never one per render: the payload's signature
  // is compared with the last one emitted and only a TRANSITION writes — a
  // rotation, a Split View drag, the rail appearing, a measurement being
  // accepted or expiring. `detailLayoutTraceSignature` carries the full account
  // of why that bound holds; a stationary tablet writes one line and goes quiet,
  // while this component re-renders on every playhead tick.
  //
  // `info` on a scope that is in `ALWAYS_SHIP_SCOPES` (`lib/logger.ts`). The
  // `theater` geometry line below is `debug`, and every report of "in landscape
  // la timeline va sotto" has arrived with debug mode OFF — so the numbers that
  // decide this have never once left a device. The payload is raw inputs only:
  // window, device screen, BOTH thresholds (the 768 tablet gate and the 1180
  // rail gate, which have been confused for each other), the side-nav footprint
  // being subtracted, the resulting column width, and whether that width was
  // measured or derived.
  const layoutTrace = buildDetailLayoutTrace({
    deviceId,
    layout: layoutInput,
    viewport: viewportReadout,
    sideNav,
    measured: measuredWidth,
    containerWidth,
    railWidth: wideSizes.railWidth,
    mode: layoutMode,
  })
  const layoutTraceSig = detailLayoutTraceSignature(layoutTrace)
  const lastLayoutTraceSig = useRef<string | null>(null)
  useEffect(() => {
    if (lastLayoutTraceSig.current === layoutTraceSig) return
    lastLayoutTraceSig.current = layoutTraceSig
    log.info(DETAIL_LAYOUT_SCOPE, 'layout decision', layoutTrace)
  }, [layoutTraceSig, layoutTrace])

  // Geometry diagnostic. In landscape the operator sees the picture parked in
  // the top-left at 430x243pt while the drawer's toggle sits correctly on the
  // true right edge — two parts of the same tree disagreeing about the window.
  //
  // 430 is BOTH the portrait width and the landscape height on the device this
  // was reported from, so no amount of reading tells the two explanations apart:
  //  - the screen still holds PORTRAIT dimensions (winWidth 430) while the
  //    overlay has landscape ones, or
  //  - the dimensions are right and something downstream sized a box from
  //    `winHeight`.
  // These two lines separate them on the first rotation.
  useEffect(() => {
    log.debug('theater', 'detail geometry', {
      deviceId,
      winWidth,
      winHeight,
      // The device screen next to the window: when they disagree by more than a
      // status bar, something (a keyboard, a split view) is eating the window,
      // and that used to be enough to change the layout.
      screenMinSide: screenMinSide ?? -1,
      isLandscape,
      layoutMode,
      toolbarPlacement,
      fullscreen,
      containerWidth,
      // Separated from the resolved width on purpose: when the two disagree,
      // the measurement was refused (degenerate, or taken in another window)
      // and THAT is the answer to "why is the rail the wrong width".
      measuredWidth: measuredWidth?.width ?? -1,
      railWidth: wideSizes.railWidth,
      defaultHeight: Math.round((winWidth * 9) / 16),
    })
  }, [
    deviceId, winWidth, winHeight, screenMinSide, isLandscape, layoutMode, toolbarPlacement,
    fullscreen, containerWidth, measuredWidth, wideSizes.railWidth,
  ])

  // The operator's standing report — "la timeline va sotto in landscape" — is
  // this exact state, and the screen has never left a trace of it. On a tablet
  // the stack is only reachable through a window that is NOT landscape, so the
  // pair (window, device screen) is the whole answer: a portrait window on a
  // landscape device is Split View / Stage Manager or an orientation that did
  // not follow, and neither is a width problem. At `warn`, because every report
  // so far arrived with debug mode off.
  // A per-camera panel cannot outlive the SURFACE IT WAS OPENED FROM, and there
  // are two of them: a reel card's action bar, and a wall cell's own menu. The
  // question is therefore "is either still on screen", never "is this `wide`" —
  // reading the reel's predicate here would strand a cell panel on a phone,
  // where the wall exists and the reel never has. Cleared in render, the same
  // way the landscape drawer is cleared above — not from an effect, which would
  // paint the orphan once before removing it.
  if (!shouldShowCameraShelf(layoutMode) && !wallShowing && cellPanel !== null) {
    setCellPanel(null)
  }

  const portraitStackOnTablet = isUnexpectedPortraitStack(layoutInput, layoutMode)
  useEffect(() => {
    if (!portraitStackOnTablet) return
    // A window of 834x1194 that equals the device screen reads identically for
    // the two opposite diagnoses: an iPad genuinely held in portrait (the
    // stack is correct, and the operator asked for it on 2026-08-08), and an
    // iPad held in LANDSCAPE that the app believes is portrait. The lock was
    // the first candidate for the second case, and it is asked here; the
    // 2026-09-10 report answered `orientationLock: 0, orientation: 1` — no
    // lock, and expo's orientation agreeing with the stale `Dimensions`. What
    // separated the two cases was the ROOT's own width (1122 = landscape) next
    // to `winWidth: 834`, which is why the raw viewport pair is on this line
    // now. One async call, on a branch that only runs when the suspicion is
    // already true.
    let cancelled = false
    const report = async (): Promise<void> => {
      let lock = -1
      let orientation = -1
      if (Platform.OS !== 'web') {
        try {
          lock = await ScreenOrientation.getOrientationLockAsync()
          orientation = await ScreenOrientation.getOrientationAsync()
        } catch {
          // A device that will not answer keeps the -1 sentinels; the line
          // still ships, and "unknown" is the truth about it.
        }
      }
      if (cancelled) return
      log.warn('theater', 'tablet resolved to the portrait stack', {
        deviceId,
        winWidth,
        winHeight,
        // The two raw sources next to the resolved pair: the 2026-09-10 report
        // was `Dimensions` saying portrait inside a landscape view tree, and
        // this line could not show it because it carried only one of them.
        viewportSource: viewportReadout.source,
        dimWidth: viewportReadout.dimWidth,
        dimHeight: viewportReadout.dimHeight,
        frameWidth: viewportReadout.frameWidth,
        frameHeight: viewportReadout.frameHeight,
        screenMinSide: screenMinSide ?? -1,
        isWeb: Platform.OS === 'web',
        orientationLock: lock,
        orientation,
      })
    }
    void report()
    return () => {
      cancelled = true
    }
  }, [portraitStackOnTablet, deviceId, winWidth, winHeight, screenMinSide, viewportReadout])

  // --- Stream-box height ----------------------------------------------------
  // Grows with the pinch: scale 1→HEIGHT_GROW_SCALE interpolates the box from
  // 16:9 up to MAX_HEIGHT_FRACTION of the page (UI thread). As the box passes
  // 16:9 the video (cover) crops its side edges — geometric tradeoff of a
  // bigger view on a 16:9 source.
  const defaultHeight = useMemo(() => (winWidth * 9) / 16, [winWidth])
  const maxHeight = useMemo(() => winHeight * MAX_HEIGHT_FRACTION, [winHeight])

  // ── The portrait column split ────────────────────────────────────────────
  // The one place the picture/wall box and the timeline's remaining height are
  // decided together (`wall-box.ts`). Only `stack` draws from it — `fill` has
  // no timeline in flow and `wide` has the rail — but it is resolved
  // unconditionally so the transition line below can report the number that
  // was actually in force rather than the one a reader would assume.
  const portraitSplit = resolvePortraitColumnSplit({
    columnHeight,
    topInset: insets.top,
    pictureHeight: defaultHeight,
    wallShowing,
  })
  // -1 outside `stack`: the split is a portrait fact, and a plausible number in
  // a shape that does not use it is how a report gets read wrong.
  const portraitTimelineHeight =
    layoutMode === 'stack' ? Math.round(portraitSplit.timelineHeight) : -1

  // ── The single↔wall transition, on the record (`live:lifecycle`) ──────────
  // At `info` on a scope that is in `ALWAYS_SHIP_SCOPES` (`lib/logger.ts`),
  // because every operator report about this screen has arrived with debug mode
  // OFF — a line that only exists in verbose mode has never left a device.
  //
  // The FIRST resolution is logged too, with an empty `before`. A cell's "open"
  // is `router.replace('/camera/<id>')` and the route keys this screen by id, so
  // moving between cameras inside a wall arrives as a fresh mount: without the
  // opening line, the state an operator spent the whole session in would be the
  // one state never written down.
  //
  // A ROTATION with the wall already up writes here too (`wallReshaped`). It is
  // not a surface change in the "picture became a wall" sense — the element is
  // the same one, deliberately (see `wallStage`) — but it IS the wall moving
  // between two different boxes, and in portrait it is the timeline handing
  // over half its height. Without this line the only trace of that would be the
  // `theater:layout` decision, which knows nothing about the wall.
  const wallTraceRef = useRef<WallSurfaceTrace | null>(null)
  useEffect(() => {
    const prev = wallTraceRef.current
    wallTraceRef.current = { wall: wallShowing, mode: layoutMode, devices: onScreenIds }
    const direction = wallTraceDirection(prev, wallShowing, layoutMode)
    if (direction === null) return
    const before = prev?.devices ?? []
    log.info('live:lifecycle', 'theater surface changed', {
      deviceId,
      direction,
      opening: prev === null,
      before,
      beforeCount: before.length,
      after: onScreenIds,
      afterCount: onScreenIds.length,
      // The SHAPE the surface changed in, and — in portrait — the split it
      // changed to. A rotation that changed the surface, and a wall that took
      // half the timeline, are both invisible in a report without these: the
      // same `pictureToWall` line is written on a phone in landscape, a phone
      // in portrait and a tablet, and they are three different layouts.
      layoutMode,
      beforeLayoutMode: prev?.mode ?? 'none',
      portraitTimelineHeight,
    })
  }, [wallShowing, onScreenIds, deviceId, layoutMode, portraitTimelineHeight])


  // ── The picture box's height: ONE rule, three readers ────────────────────
  // The zoom hook clamps against it and folds it into the render transform,
  // and `liveBoxHeight` below sizes the box with it — all from the LIVE pinch
  // scale, so the box grows under the fingers and nothing moves at a release.
  // The player's wrapper never reads it: on iOS the picture is a WKWebView,
  // and while a `transform` on its wrapper is GPU-composited, a change to its
  // FRAME is a WebKit re-layout, an IPC to the content process and a `fit()`
  // into the page. A wrapper sized from the pinch made every frame of the
  // gesture a frame change (the "scattoso"; the July log localised it to
  // "portrait with the growing panel, never landscape"), and a box animated
  // AFTER the release on the committed scale (1.0.478) kept the picture moving
  // once the fingers had lifted ("continua a ritornare in avanti").
  //
  // A worklet: the gesture handlers call it on the UI thread, every frame.
  const pinchExpandsHeight = settings.stream.pinchExpandsHeight
  const wideStreamW = wideSizes.streamWidth
  const wideStreamH = wideSizes.streamHeight
  const zoomBoxHeightFor = useCallback(
    (scale: number): number => {
      'worklet'
      if (fill) return winHeight
      if (isWideDetail) return wideStreamH
      if (!pinchExpandsHeight) return defaultHeight
      // Scale 1→HEIGHT_GROW_SCALE grows the box from 16:9 up to
      // MAX_HEIGHT_FRACTION of the page; past 16:9 the video (cover) crops its
      // side edges — the geometric tradeoff of a bigger view on a 16:9 source.
      return growBoxHeight(scale, { rest: defaultHeight, max: maxHeight, growScale: HEIGHT_GROW_SCALE })
    },
    [fill, winHeight, isWideDetail, wideStreamH, pinchExpandsHeight, defaultHeight, maxHeight],
  )

  // Pinch + pan zoom. The screen owns tap/double-tap/one-finger-fling and
  // composes them simultaneously with the hook's gesture. The wrapper's fit
  // decides the pan bounds. Fill / wide put the video in an absolute-fill where
  // it letterboxes (`contain`); the mobile stacked box uses `videoCoverStyle`,
  // where it overflows and is cropped (`cover`). Passing the wrong one shrank
  // the reachable travel to a quarter in portrait. The viewport is the box
  // above, never a measurement: the hook's own `onLayout` did not fire when
  // the box was resized by a reanimated style (measured — 420 ms into a
  // rotation the transform was still 1.71x), and a JS-side "write the layout,
  // then settle against it" read the PREVIOUS layout, because a shared value
  // set from JS is scheduled while a read is synchronous.
  // The trace rides on debug mode — the switch the operator already flips to
  // send `debug` lines to the hub (`LoggerBridge`). Off, the handlers take a
  // dead branch and nothing is buffered.
  const zoomTraceOn = useDeviceSettingsStore((s) => s.settings.debugMode)
  const zoom = useStreamZoom({
    fit: fill || isWideDetail ? 'contain' : 'cover',
    viewport: { width: isWideDetail ? wideStreamW : winWidth, heightFor: zoomBoxHeightFor },
    trace: zoomTraceOn,
  })

  // Drop the zoom the instant the window changes shape.
  //
  // This lives HERE, not in the zoom hook, because a React effect on the window
  // dimensions is the only signal that reliably fires: the hook's own
  // `onLayout` does not run when the box above it is resized by a reanimated
  // style, and the measurement proved it — 420 ms into a rotation the transform
  // was still 1.71x.
  //
  // Two things depend on it. The retained pan was clamped against the OLD box,
  // so carried over it parks the picture off-centre. And every `measure()`
  // taken BENEATH this transform comes back multiplied by it — which is how the
  // embedded player was told to become 1279pt wide on a 932pt screen, resized
  // its video past the surface, and stalled the stream for seconds.
  const snapZoom = zoom.snapZoom
  useEffect(() => {
    snapZoom()
  }, [winWidth, winHeight, snapZoom])

  // Reset zoom (scale + pan) on every fill transition — entering/leaving
  // landscape or fullscreen. Without this the pinch scale + pan offset measured
  // for the OLD viewport survive the rotation: returning to portrait the stream
  // box stays "grown" (the timeline-shrink stays engaged) and the video looks
  // zoomed/panned. `resetZoom` is a stable callback so this fires only on flip.
  const resetZoom = zoom.resetZoom
  useEffect(() => {
    resetZoom()
  }, [fill, resetZoom])

  // A zoom does not outlive the camera it was applied to.
  //
  // This screen deliberately stays MOUNTED when you leave it (`freezeOnBlur:
  // false`, so pressing Cameras returns to the camera you never closed), and
  // the zoom transform lives in shared values on the same component. Until
  // 2026-09-21 nothing reset it on exit: a pinch left committed survived for
  // the whole life of the app process, so an operator came back to a camera
  // that looked broken — zoomed and cropped with no visible way out, since the
  // double-tap ladder is discovered by nobody. The only exits were a rotation
  // or four taps.
  //
  // Keyed on the camera rather than on focus: switching camera is exactly when
  // a retained pan is meaningless, and it fires on the way IN, which also
  // covers the return to a screen that was left zoomed.
  useEffect(() => {
    snapZoom()
  }, [deviceId, snapZoom])

  // The fling does not CLOSE the camera and it does not LEAVE it either: it
  // asks for system PiP exactly as the PiP disc does, and the screen stays.
  //
  // It used to navigate back once PiP was confirmed, and that was the defect
  // the operator reported as "the window comes up and dies" (v1.0.412). The
  // measurement is on record (the parking guard spec, 2026-09-01): a
  // WKWebView that is not visible — gone from the tree or parked off screen —
  // is throttled by WebKit within seconds and the PiP window closes with its
  // video. The PiP that lives is the one whose page stays on screen.
  //
  // "And put the app in the background" is not something iOS lets an app do
  // to itself; the operator presses Home, and from there the window belongs to
  // the system. Whether the MediaStream keeps rendering in PiP once the app is
  // backgrounded is the open question for the device: read `live:pip`
  // (presentation mode changes) against `live:lifecycle` (player torn down).
  /** One-finger fling: just leave, through the one destination back always has. */
  const onSwipeBack = useCallback((): void => {
    backToCameras(router, forgetLastCamera)
  }, [router, forgetLastCamera])

  /**
   * Two-finger fling: hand THIS camera to the on-demand overlay at the instant
   * on screen, then leave. `resolveReelInstant` turns the machine's live edge
   * (`activeEpoch === null`) into `'live'`, so a live stream opens live — the
   * same rule the reel cards use.
   *
   * Leaving goes through `backToCameras`, never a bare pop: back from a camera
   * always lands on the cameras tab, and a bare pop is a no-op on a cold start
   * and leaves a grid mounted underneath with WebRTC still running. That rule
   * has its own guard, and it caught this on the first run — including, on the
   * second, the literal spelling inside this very comment.
   *
   * The overlay outlives the route change by construction, which is what makes
   * "overlay e vai indietro" one gesture instead of two.
   */
  const onSwipeToOverlay = useCallback((): void => {
    openOnDemandPlayer({
      deviceId,
      atMs: resolveReelInstant(selectActiveEpoch(playback.state)),
    })
    log.info('live:ondemand', 'swipe → on-demand overlay', { deviceId })
    backToCameras(router, forgetLastCamera)
  }, [deviceId, playback.state, router, forgetLastCamera])

  // The fling-to-PiP handler is GONE (2026-09-13). The PiP disc on the toolbar
  // is the one way to ask, and it is the only one that can work: PiP started
  // without a user interaction is refused by WebKit, so an automatism has
  // nothing to offer here (`camera-detail/pip-handoff.ts` carries the device
  // trace and Apple's rule).
  //
  // Its absence is guarded by source text, so do not name the removed handler
  // here — the guard cannot tell a comment from a call, and it is right not to.

  const videoGesture = useMemo(() => {
    // Single tap → toggle controls; double tap → zoom (Exclusive so a double
    // never also fires a single).
    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .onEnd(() => {
        runOnJS(onToggleControls)()
      })
    // Double tap, anchored on the TAP: from the whole picture it zooms in until
    // the video fills the player (no bars); from any zoom it returns to the
    // whole picture. One tap in, one tap out (operator, 2026-10-22).
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd((e) => {
        // A worklet: every input of the step lives on the UI thread, and the
        // JS thread it used to hop through re-renders on every playhead tick.
        zoom.doubleTapZoomAt(e.x, e.y)
      })
    const taps = Gesture.Exclusive(doubleTap, singleTap)
    // ONE-finger downward fling → leave the screen. Nothing else: the operator
    // removed the finger-PiP, so this is the plain back affordance.
    const swipeToBack = Gesture.Pan()
      .minPointers(BACK_SWIPE_POINTERS)
      .maxPointers(BACK_SWIPE_POINTERS)
      .activeOffsetY(40)
      .failOffsetX([-32, 32])
      .onEnd((e) => {
        if (
          shouldGoBackOnSwipe({
            translationY: e.translationY,
            velocityY: e.velocityY,
            zoomScale: zoom.scale.value,
          })
        ) {
          runOnJS(onSwipeBack)()
        }
      })
    // TWO-finger downward fling → this camera continues in the on-demand
    // overlay and the screen goes back. The overlay survives navigation, which
    // is what makes "overlay e torna indietro" one gesture instead of two.
    const swipeToOverlay = Gesture.Pan()
      .minPointers(OVERLAY_SWIPE_POINTERS)
      .maxPointers(OVERLAY_SWIPE_POINTERS)
      .activeOffsetY(40)
      .failOffsetX([-32, 32])
      .onEnd((e) => {
        if (
          shouldOpenOverlayOnSwipe({
            translationY: e.translationY,
            velocityY: e.velocityY,
            zoomScale: zoom.scale.value,
          })
        ) {
          runOnJS(onSwipeToOverlay)()
        }
      })
    // Everything runs simultaneously: pinch+pan (zoom), the tap pair, both flings.
    return Gesture.Simultaneous(zoom.composeWith(swipeToOverlay), swipeToBack, taps)
  }, [zoom, onToggleControls, onSwipeBack, onSwipeToOverlay])

  // Pinch-driven height grow is OPT-IN (Settings → Stream, default off). When
  // off, the box stays a clean 16:9 (whole frame, no bars, no crop). When on,
  // it follows the LIVE pinch scale under the fingers — analytically, no
  // animation of its own — cropping the side edges past 16:9. The rule itself
  // is `zoomBoxHeightFor`, shared with the zoom hook.
  const liveBoxHeight = useDerivedValue(() => {
    // FILL wins over everything. Reanimated does not reset a property that
    // merely disappears between renders, so "just don't apply the animated
    // style in fill mode" leaves the last portrait height STUCK on the shared
    // Animated.View — the box keeps 242pt (= 430/16*9, the portrait 16:9
    // height) in landscape and the screen background shows through below it.
    // That exact failure was documented here, mitigated by omission, and came
    // back the moment an operator pinched before rotating. The style is now
    // ALWAYS applied and carries the fill height itself.
    return zoomBoxHeightFor(zoom.scale.value)
  }, [zoomBoxHeightFor, zoom.scale])

  // Trace: the height the box is ACTUALLY given, frame by frame, into the same
  // trace as the gesture — the follow-through after a release is the part the
  // hook cannot see on its own.
  const traceBox = zoom.traceBox
  useAnimatedReaction(
    () => liveBoxHeight.value,
    (h, prev) => {
      if (zoomTraceOn && prev !== null && h !== prev) traceBox(h)
    },
    [zoomTraceOn, traceBox],
  )

  // Always returns the SAME property (`height`), and is always APPLIED (see the
  // JSX and `liveBoxHeight` above): reanimated does not reset a property that
  // merely disappears between frames, so a style that flipped between `{flex:1}`
  // and `{height}` left a stale `height` stuck on the view — in landscape the box
  // stayed 242px tall (the portrait height) instead of filling, leaving a white
  // band below (the "rettangolone bianco") and a stuck zoom on return.
  const boxAnimStyle = useAnimatedStyle(() => ({ height: liveBoxHeight.value }))

  // BESIDE the stream: the picture's box gives up the timeline column's width
  // (0 → 1 over the sheet duration; Reduce Motion jumps). Applied to the OUTER
  // box (its right edge, so every overlay laid over it — discs, name tag,
  // gestures — follows) and to the cover that sizes the player, from the one
  // shared value so the two can never disagree. The player keeps its aspect
  // (`contain`) inside the narrower box.
  const sideReduced = useReducedMotion()
  const sideProgress = useSharedValue(timelineBeside ? 1 : 0)
  useEffect(() => {
    sideProgress.set(timingTo(timelineBeside ? 1 : 0, MOTION.sheet.ms, sideReduced))
  }, [timelineBeside, sideProgress, sideReduced])
  const sideReserve = sideTimelineWidth(winWidth)
  // ALWAYS applied, same property: `right` is a no-op on the in-flow boxes of
  // the other layouts (relative offset 0), and a vanished animated property
  // would stay stuck (see `videoCoverStyle`).
  const boxSideStyle = useAnimatedStyle(() => ({
    right: fill ? sideProgress.get() * sideReserve : 0,
  }), [fill, sideReserve])

  // The player's WRAPPER: a constant per layout mode, never the animated box.
  // Fill takes the window, wide the rail box, the stacked box the 16:9 box at
  // rest (`defaultHeight`) whether or not the pinch may grow the box — the
  // growth is folded into `zoom.videoStyle` (see `zoomBoxHeightFor`), so the
  // WKWebView underneath keeps one frame for the life of the layout mode.
  // Keeping the wrapper a true 16:9 area also aligns normalized detection
  // boxes to the real video pixels (no letterbox offset).
  //
  // ALWAYS applied, and always returns the SAME property set — the third time
  // this exact trap has been paid for in this file, and the first two comments
  // about it are a few lines up.
  //
  // Reanimated writes these properties straight onto the native view and does
  // NOT clear one that merely disappears between renders. Swapping this style
  // for a static `StyleSheet.absoluteFill` in fill mode therefore left the
  // portrait values STUCK: measured on 2026-07-31, after rotating into a
  // 932x430 landscape with `fill: true`, the player's container still measured
  // 574x323 — the portrait cover box — so the embed kept sizing its video to it
  // and the picture turned without expanding.
  //
  // So fill and wide are expressed HERE, in the same properties, instead of by
  // withholding the style.
  const videoCoverStyle = useAnimatedStyle(() => {
    // ALWAYS the same properties. Reanimated leaves a vanished one stuck — a
    // branch that returned `right`/`bottom` instead would pin the portrait
    // cover box after restore, the same trap fill mode already paid for.
    if (fill) {
      return {
        position: 'absolute',
        top: 0,
        left: 0,
        width: winWidth - sideProgress.get() * sideReserve,
        height: winHeight,
      }
    }
    if (isWideDetail) {
      return { position: 'absolute', top: 0, left: 0, width: wideStreamW, height: wideStreamH }
    }
    return { position: 'absolute', top: 0, left: 0, width: winWidth, height: defaultHeight }
  }, [winWidth, winHeight, fill, isWideDetail, wideStreamW, wideStreamH, defaultHeight, sideReserve])

  // No `panelTopOffset` any more. Every panel this screen used to anchor is a
  // panel of the TIMELINE, laid out by its column — so nothing derives a
  // position from the animated video-box height, and no branch has to say what
  // that height means on the wide rail.

  // Web Fullscreen API — on web, `toggle()` requests/exits native browser
  // fullscreen on the screen root; `ref` is attached below. On native this is a
  // no-op; `useTheaterOrientation` below handles the native fullscreen path.
  const {
    ref: fullscreenRef,
    isFullscreen: webIsFullscreen,
    supported: webFullscreenSupported,
    mode: webFullscreenMode,
    toggle: toggleWebFullscreen,
  } = useWebFullscreen()
  // A touch browser that cannot force landscape gets NO fullscreen button —
  // the native button's promise is landscape, and an iPhone has no fullscreen
  // API at all (`decideWebFullscreenMode`). Native always offers it.
  const fullscreenOffered = Platform.OS !== 'web' || webFullscreenButtonShown(webFullscreenMode)

  // Orientation: manual fullscreen LOCKS landscape. Otherwise we UNLOCK so the
  // page follows the phone's physical orientation — rotating to landscape makes
  // `isLandscape` true and the stream fills the screen (auto-rotate). On unmount
  // we unlock so we never strand another screen in a forced orientation.
  //
  // Web takes the browser API only where it EXISTS. iPhone Safari (browser and
  // installed PWA) has no `Element.requestFullscreen`, and routing it there
  // left the fullscreen disc silently dead — the only way to a big picture was
  // to rotate. Without the API the app's own `fill` is the fullscreen: the
  // layout resolves 'fill', the rail hides, the picture takes the window, and
  // a standalone PWA has no browser chrome to hide anyway.
  const onToggleFullscreen = useCallback((): void => {
    if (Platform.OS === 'web' && webFullscreenSupported) {
      toggleWebFullscreen()
      return
    }
    setFullscreen((f) => !f)
  }, [toggleWebFullscreen, webFullscreenSupported])
  // On web, mirror the browser fullscreen state back into `fullscreen` so the
  // `fill` style and the overlay icon stay in sync (e.g. when user presses Esc).
  // Only where the API is supported: with it absent `fullscreenElement` is
  // always null, and an unguarded mirror wrote `false` over the manual flag.
  useEffect(() => {
    if (Platform.OS === 'web' && webFullscreenSupported) setFullscreen(webIsFullscreen)
  }, [webIsFullscreen, webFullscreenSupported])

  // Re-asserted on every FOCUS, not just on a `fullscreen` change: this screen
  // stays mounted under a pushed route (`freezeOnBlur: false`), and
  // `lockAsync` is app-wide — so a route on top could leave a lock behind that
  // nothing here ever re-ran to undo. See `use-theater-orientation.ts`.
  useTheaterOrientation(fullscreen, { screenMinSide })

  // The screen-owned snapshot capture went with the timebar's capture menu on
  // 2026-09-02 (`TimelineToolbarInline`): it was that button's only caller, and
  // a screen holding a capture nothing can trigger is the leftover that reads
  // as a working feature. `git show 27d0d98` has it, `buildSnapshotMediaUrl`
  // and all.

  // Playback status chip (LIVE vs the playhead clock) + Go-Live affordance,
  // derived purely from the machine state (a pure selector). GO_LIVE resets the
  // machine to live+null-playhead and the sink remounts the player; there is no
  // stray-report race (POSITION_REPORT is ignored while `mode === 'live'`).
  const status = selectPlaybackStatus(playback.state)
  // LIVE-only overlay gate: motion highlight border, the live motion badge, and
  // the detection bounding boxes are meaningful ONLY on the live edge — they
  // describe what the camera sees RIGHT NOW. During recorded playback, scrubbing,
  // or a paused-seek (mode ≠ 'live', or a live pause on a frozen poster) the
  // frame under them is historical, so drawing live boxes/flash over it is wrong.
  // Mirrors the OccupancyBadge gate (`status.isLive && !paused`).
  const liveOverlaysVisible = status.isLive && !paused
  // The robot moves only with its monitor open: the drive overlay is drawn
  // over a picture that is PLAYING on the live edge — the player's own report,
  // not a flag of this screen's — never over a poster, a paused edge or a
  // recorded playhead, where a stick would drive nothing.
  const drivePlaying = liveOverlaysVisible && playerStatus.state === 'playing'
  // Live motion poll — only while the live overlays would actually paint.
  // An unconditional `true` kept getStatus ticking during recorded/scrub on
  // the same socket as the feeder. Shared with the grid tile + card.
  const motionActive = useMotionHighlight(deviceId, liveOverlaysVisible)
  const highlightType = detActive
    ? 'detection'
    : audioActive || audioPreview
      ? 'audio'
      : cameraHighlight.motion && motionActive
        ? 'motion'
        : null
  // The WebView embed draws its OWN highlight/boxes; disable them (enabled:false)
  // + zeroed triggers) whenever we're not on the live edge so the embed stops
  // painting live overlays over recorded footage. Re-enabled on go-live.
  const activeEmbedHighlight = useMemo<GridHighlightEmbedConfig>(
    () => gateLiveHighlight(embedHighlight, liveOverlaysVisible),
    [embedHighlight, liveOverlaysVisible],
  )
  // What the WALL draws until its bar says otherwise: the primary's documents,
  // ungated — `WorkspaceStage` merges the bar's session choices over them and
  // applies the same live-edge gate (`workspace-wall-options.ts`).
  const wallPrimary = useMemo<WorkspaceWallPrimary>(
    () => ({ quality, highlight: embedHighlight, showBoxes: detectionBoxesOn }),
    [quality, embedHighlight, detectionBoxesOn],
  )

  // ── ONE transport state, TWO affordances ──────────────────────────────────
  // Play/pause is offered both on the video (StreamOverlayControls) and in the
  // timeline's playback bar: in fill mode the timeline sits in a drawer that
  // starts closed, so a transport that existed only there would be unreachable
  // in the default fullscreen view.
  //
  // The duplication must stay in the AFFORDANCE and never reach the state. LIVE
  // pause is a poster teardown; RECORDED pause is a real server rate-0 hold on
  // the same session (frame-step ready) — resolved here, once, and handed to
  // both surfaces. A second `useState` behind either button would let the two
  // disagree about whether the stream is paused, which is a bug with no visible
  // cause. `docked-timeline-chrome.spec` asserts this single binding.
  //
  // A CLIP is paused by the rate whatever the machine says (`clip-transport.ts`):
  // it leaves the machine where it was, so a clip opened from the live edge
  // used to get the LIVE pause — a poster teardown that unmounted the player
  // and the clip with it — and on a held battery camera the bar drew ▶ over a
  // file that was playing, because the live hold reads as paused.
  const pausedByRate =
    resolvePauseAuthority({ mode: playback.state.mode, clipHeld: clipStage.stage.kind === 'clip' }) ===
    'rate'
  const effectivePaused = pausedByRate ? recPaused : paused
  const onToggleEffectivePause = (): void => {
    // Live pause UNMOUNTS the player (poster). Stop the capture first so the
    // blob is flushed while the WebView still exists, then pause, then ask.
    if (capturingRef.current && !pausedByRate) {
      void (async () => {
        const result = await finishLiveCapture()
        onTogglePause()
        if (result) promptKeepLiveClip(result)
      })()
      return
    }
    if (pausedByRate) onToggleRecPause()
    else onTogglePause()
  }
  // Ring the play button wherever it is drawn: a LIVE stream still connecting,
  // or a recorded seek in flight. A PAUSED live surface has no mounted player
  // at all (live pause is teardown, and the battery hold never mounts one), so
  // `playerStatus` sits at its `connecting` initial value forever — gating on
  // `paused` keeps the ring off a transport that is simply stopped.
  // With the wall up there is no `<LiveView>` to report a state, so
  // `playerStatus` is whatever it last was — `connecting` forever on a screen
  // that opened straight into a wall. A play button that rings for ever is a
  // fault the operator cannot clear, so the live branch is the picture's alone.
  //
  // A CLIP on the frame has a wait of its own (`use-clip-stage`, `loading`):
  // the machine is deliberately untouched by a clip, so its branches say
  // nothing about the file being fetched — and on a held battery camera the
  // live branch could never ring, which left a 7.9 s cold fetch with no sign
  // at all (measured 2026-09-22).
  const transportLoading = clipStage.stage.kind === 'clip'
    ? !wallShowing && clipStage.loading
    : isRecorded
      ? playback.state.mode === 'seeking'
      : !wallShowing && !paused && playerStatus.state === 'connecting'
  // The manual half of "auto riprovare in ogni caso": the loop inside the
  // player keeps running either way — this only makes the next attempt now (and
  // resets its budget). It is logged, per camera, inside the player's loop.
  const onRetryStream = useCallback(() => {
    liveRef.current?.retry()
  }, [])
  // The PICTURE's health, handed to the timeline, which reduces it together with
  // the recordings and events loads into its ONE fault slot. The failure used to
  // travel as a bare string that the playback band rendered itself, in its own
  // grammar, beside a second notice for the events query.
  //
  // A RECORDED clip that could not be read counts too: the machine adopts the
  // embed's `error` while in playback, and until now nothing rendered that mode
  // at all — a failed recording looked exactly like a normal one.
  const streamFailed = playerStatus.state === 'error' || playback.state.mode === 'error'
  const playerReason = playerStatus.reason
  const playerState = playerStatus.state
  const streamFaultBinding: TimelineStreamFaultBinding = useMemo(
    () => (wallShowing ? NO_PICTURE_FAULT : {
      failed: streamFailed,
      fetching: playerState === 'connecting',
      // The player's own words when it gave any. Null lets the notice fall back
      // to its generic string — an error with no text reads as a UI glitch
      // rather than as a stream that is down, so SOMETHING is always said.
      reason: playerState === 'error' ? (playerReason ?? null) : null,
      onRetry: onRetryStream,
    }),
    [wallShowing, streamFailed, playerState, playerReason, onRetryStream],
  )
  // ±10s jog routes THROUGH the machine (re-arms the seek anchor so the reconcile
  // holds the new position) rather than a raw imperative seek. The jog BASE is
  // the playhead, but during a settling seek the playhead can briefly be null —
  // fall back to the indicator's active epoch (seek preview) so the jog never
  // silently no-ops. Debug logging lets on-device captures show exactly why a
  // jog resolved to null when it does.
  const onJogBack = useCallback(() => {
    const active = selectActiveEpoch(playback.state)
    const base = jogBaseFor(playback.state.selectionAnchor !== null, playback.state.playhead, active)
    const target = jogTarget(base, -1)
    log.debug('playback:jog', 'jogBack', {
      playhead: playback.state.playhead,
      active,
      base,
      target,
      mode: playback.state.mode,
    })
    if (target != null) onSeek(target, 'timeline')
  }, [playback, onSeek])
  const onJogForward = useCallback(() => {
    const active = selectActiveEpoch(playback.state)
    const base = jogBaseFor(playback.state.selectionAnchor !== null, playback.state.playhead, active)
    const target = jogTarget(base, +1)
    log.debug('playback:jog', 'jogForward', {
      playhead: playback.state.playhead,
      active,
      base,
      target,
      mode: playback.state.mode,
    })
    if (target != null) onSeek(target, 'timeline')
  }, [playback, onSeek])

  // Stream block. Default 16:9, drag-growable; fills the window when
  // fullscreen OR naturally landscape WITHOUT remounting LiveView (single
  // WebRTC session).
  //
  // Box sizing. In fill mode a plain absolute-fill style (no animated height
  // — reanimated leaves a vanished animated `height` STUCK on the shared
  // Animated.View instance, which made the SECOND rotation report 242px and
  // black-band the landscape). On wide the box is statically sized (mouse has
  // no pinch — height-grow disabled by branch order). The pinch height-grow
  // (opt-in) is the ONLY case that needs the animated style; otherwise a plain
  // `height` that React fully controls/resets.
  // Prev / next through the clip list — what "navigate the clips" means on a
  // camera whose clips are files and which therefore has no time axis to
  // anchor navigation to (`clips-surface.ts`). Null at the ends of the list:
  // the control greys out rather than wrapping, so reaching the end reads as
  // reaching the end.
  const stageClipId = clipStage.stage.kind === 'clip' ? clipStage.stage.clipId : null
  const framePrev = useMemo<(() => void) | null>(() => {
    if (stageClipId === null) return null
    if (clipStageStep(frameClips, stageClipId, -1) === null) return null
    return () => clipStage.step(frameClips, -1)
  }, [stageClipId, frameClips, clipStage])
  const frameNext = useMemo<(() => void) | null>(() => {
    if (stageClipId === null) return null
    if (clipStageStep(frameClips, stageClipId, 1) === null) return null
    return () => clipStage.step(frameClips, 1)
  }, [stageClipId, frameClips, clipStage])

  const streamBox = (
      <Animated.View
        style={
          fill
            ? [styles.videoWrapFull, boxAnimStyle, boxSideStyle]
            : isWideDetail
              ? [styles.videoWrap, { width: wideSizes.streamWidth, height: wideSizes.streamHeight }]
              : pinchExpandsHeight
                ? [styles.videoWrap, boxAnimStyle]
                : [styles.videoWrap, { height: defaultHeight }]
        }
      >
        <View style={styles.videoContent}>
          {/* Video (transform applied to the inner RTCView via `videoStyle`). */}
          {/* Zoom transform on a WRAPPER, never on the native video layer:
              react-native-webrtc's Metal-backed video view goes BLACK when a
              scale transform is applied to it directly (V1 documented this).
              Transforming the surrounding Animated.View keeps the frame intact.
              The detection-box overlay rides inside the wrapper so boxes scale
              and pan in lockstep with the video.
              `videoCoverStyle` sizes it in EVERY mode — 16:9 cover when the
              box is pinch-grown, the window in fill, the rail box when wide.
              It must never be swapped for a static style: reanimated leaves the
              properties it last wrote stuck on the view, which pinned the
              player to the portrait box across a rotation. */}
          <Animated.View style={[videoCoverStyle, zoom.videoStyle]}>
            {/* The snapshot poster is a LIVE-pause affordance ONLY. In recorded
                mode pause is a server rate-0 hold on the SAME session — the
                player keeps showing the exact held frame, never a snapshot
                (and unmounting LiveView here would kill the feeder). */}
            {disabled ? (
              /* Out of service. The hub has stopped the stream, the detections
                 and the recording, so mounting a player here would negotiate
                 against a device that will never send a frame — a spinner
                 forever, which reads as a fault rather than as a choice. */
              <View style={styles.disabledStage}>
                <PowerOff size={34} color="#9aa0a6" /> {/* ui-check-ok: video stage — a camera picture sits on black in both themes */}
                <Text style={styles.disabledTitle}>{t('v2.cameras.disabledTitle')}</Text>
                <Text style={styles.disabledHint}>{t('v2.cameras.disabledHint')}</Text>
              </View>
            ) : !mountLiveView ? (
              /* The poster path is also the BATTERY path, and it works by not
                 mounting `LiveView` at all — nothing is negotiated, nothing is
                 woken. `useSnapshot` inside never sets `force`, the one flag
                 that walks past the hub's sleep gate, so the picture here is
                 the last frame the camera produced however old it is.
                 A scrub into a gap used to mount the player (the live-pause
                 boolean flipped on the first seeking frame) and then fall
                 through to live; `shouldMountLiveView` is the rule that
                 stops that. */
              <PausedPoster deviceId={deviceId} fill={fill} enabled={status.isLive} />
            ) : (
              <LiveView
                key={liveReloadKey}
                ref={liveRef}
                deviceId={deviceId}
                muted={muted}
                target={liveTarget}
                highlight={useWebViewPlayer ? activeEmbedHighlight : undefined}
                initialSeekMs={embedInitialSeek}
                initialClip={embedInitialClip}
                onPlaybackState={onEmbedPlaybackState}
                onPlayerState={setPlayerStatus}
                onPosition={onPlayerPosition}
                onLiveCaptureError={onLiveCaptureError}
                onScrubDrawn={onScrubDrawn}
                onServedProfile={setServedTier}
                onClipDuration={clipStage.reportDuration}
                onClipAudio={clipStage.reportAudio}
                // The camera cut this clip's replay short (D623). Routed into
                // the stage, which is the only thing that knows WHICH clip the
                // report is about — it arrives when the stream ends, so the
                // pointer may already have moved.
                onClipIncomplete={clipStage.reportIncomplete}
                onPeerReconnect={onPeerReconnect}
              />
            )}
            {/* Motion REGIONS under the detection boxes — "where did the
                picture change" beneath "what is it". Drawn first so a detection
                box always reads on top of the area that triggered it. */}
            {motionRegionsOn && liveOverlaysVisible ? (
              <MotionRegionsOverlay deviceId={deviceId} enabled={motionRegionsOn} />
            ) : null}
            {detectionBoxesOn && liveOverlaysVisible ? (
              <MotionBoxesOverlay deviceId={deviceId} enabled={detectionBoxesOn} />
            ) : null}
            {/* The PARKED objects — a layer of their own since 2026-08-18.
                Drawn under the discarded ghosts and over the live boxes: a
                parked car is a standing fact about the picture, not an event. */}
            {stationaryBoxesOn && liveOverlaysVisible ? (
              <StationaryBoxesOverlay deviceId={deviceId} enabled={stationaryBoxesOn} />
            ) : null}
            {/* What the pipeline DISCARDED
                (dashed red ghosts + the model/kept count pill). On top of the
                surviving boxes so the gap between "model saw" and "overlay
                drew" is visible in one glance, and so a subject the filters
                keep dropping still carries a continuous box. */}
            {discardedBoxesOn && liveOverlaysVisible ? (
              <DiscardedBoxesOverlay deviceId={deviceId} enabled={discardedBoxesOn} />
            ) : null}
          </Animated.View>

          {/* Transparent gesture-catcher ON TOP of the video. A native video view
              (RTCPIPView) swallows touches, so the detector must wrap a plain
              View — not the video — for pinch/pan/tap to register. It sits below
              the `box-none` controls so the pills still capture their own taps. */}
          <GestureDetector gesture={videoGesture}>
            <Animated.View style={StyleSheet.absoluteFill} />
          </GestureDetector>

          {/* ACTIVE zone filter — the drawn rect stays visible on the player
              (live AND playback) while the filter applies. Non-interactive;
              same un-transformed box coordinates as the drawing overlay.
              Hidden while drawing mode shows its own (editable) rect. */}
          {timelineZone !== null && !zoneDrawing ? (
            <ZoneActiveOverlay zone={timelineZone} />
          ) : null}

          {/* No-recording placeholder — shown when the navigated time has no
              footage (the server feeder reports a gap). Non-interactive so the
              scrub/seek controls underneath still work. */}
          {playback.state.mode === 'gap' ? (
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.noRecOverlay]}>
              <VideoOff size={28} color="#9aa0a6" /> {/* ui-check-ok: video stage — a camera picture sits on black in both themes */}
              <Text style={styles.noRecTitle}>{t('v2.theater.noRecording')}</Text>
              <Text style={styles.noRecHint}>{t('v2.theater.noRecordingHint')}</Text>
            </View>
          ) : null}

          {/* Per-camera highlight border — NATIVE player only (the WebView embed
              draws its own; a native border is occluded by its video layer).
              Color/thickness from the global highlight appearance settings. */}
          {highlightType && !useWebViewPlayer && liveOverlaysVisible && overlay.highlightBorder ? (
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  borderWidth: settings.highlight.thickness,
                  borderColor:
                    highlightType === 'motion'
                      ? settings.highlight.motionColor
                      : highlightType === 'audio'
                        ? settings.highlight.audioColor
                        : settings.highlight.detectionColor,
                },
              ]}
            />
          ) : null}

          {/* Camera name — shown only while the controls overlay is visible. */}
          {controlsVisible ? (
            <Animated.View entering={namePop.entering} exiting={namePop.exiting} style={styles.nameTag} pointerEvents="none">
            {/* `dense` for the on-video discs' reason (`OverlayDiscButton`):
                it pops in from opacity 0, over the picture. */}
            <GlassSurface
              contentStyle={styles.nameTagRow}
              pointerEvents="none"
              dense
            >
              {cameraSleeping && !disabled ? (
                <Moon size={12} color={colors.foreground} />
              ) : (
                <CameraStatusDot deviceId={deviceId} online={online} disabled={disabled} size={9} />
              )}
              <Text style={[styles.nameText, { color: colors.foreground }]} numberOfLines={1}>
                {name}
              </Text>
            </GlassSurface>
            </Animated.View>
          ) : null}


          {/* Go-Live: the timeline's horizontal "Go to live" pill is the single
              return-to-live affordance (it remounts the player via onGoLive). The
              old over-video pill was removed to avoid duplication. */}

          {/* Recorded transport controls were relocated OFF the video onto the
              timeline (see TimelineTransportControls, floating above the now-line
              in TheaterTimeline). The over-video jog row was removed so the nav
              controls no longer sit on the stream. */}

          {/* Everything the operator pins ON the picture — audio meter, device
              info, doorbell, occupancy, readouts, stream stats, live viewers —
              in ONE frame laid over the VIDEO's rendered rectangle (letterbox
              excluded, `fit` as the player fits it). The frame is the anchor
              space and carries the device's overlay size, so a landscape or
              fullscreen picture and a portrait one scale the same way. The
              meter sits above the gesture layer (not inside the zoom
              transform) so the operator can tap it to reposition inline. */}
          <OverlayFrame fit={fill || isWideDetail ? 'contain' : 'cover'} aspect={streamAspect}>
            {/* Live audio-level meter — adaptive VU overlay, toggled from the
                view-options menu (like the bounding-box overlay). Pinned to the
                player FRAME (a sibling above the gesture layer, not inside the
                zoom transform) so the operator can tap it to reposition inline.
                Live-edge only (the dBFS stream is the current frame). */}
            {audioPosition !== 'off' && liveOverlaysVisible ? (
              <AudioLevelMeter
                deviceId={deviceId}
                position={audioPosition}
                onSetPosition={onSetAudioPosition}
              />
            ) : null}

            {/* Phone battery — global setting, same corner vocabulary as the meter. */}
            {deviceInfoPosition !== 'off' ? (
              <DeviceInfoOverlay position={deviceInfoPosition} />
            ) : null}

            {/* Live doorbell badge — top-left, non-interactive sibling overlay.
                Pulses while ringing (a press within RING_WINDOW_MS), otherwise a
                subtle "last ring N ago" pill. Gated on the `doorbell-button`
                feature so non-doorbell cameras render nothing (the hook stays idle
                when `enabled` is false, and self-hides when it never rang). */}
            <DoorbellBadge deviceId={deviceId} enabled={hasDoorbell && liveOverlaysVisible} />

            {/* Live occupancy — class chips (glyph + count) from the
                zone-analytics current snapshot. LIVE only: the snapshot is the
                current frame, and occupancy for a recorded playhead / the events
                page needs DURABLE server-side history (60-min ring today → a
                server task). Self-hides when there is no occupancy. */}
            <OccupancyBadge
              deviceId={deviceId}
              enabled={overlay.occupancy !== 'off' && status.isLive && !paused}
              corner={overlay.occupancy === 'off' ? 'bottom-left' : overlay.occupancy}
            />

            {/* The operator's pinned readouts — the live dBFS, and any live field
                of this camera or a device linked to it. Non-interactive, so the
                corners still belong to the picture's gestures. */}
            <OverlayReadouts
              deviceId={deviceId}
              config={overlay}
              enabled={liveOverlaysVisible && status.isLive}
            />

            {/* Stream-stats read-out — toggled from the view-options menu. On
                iOS the numbers come from the WebView embed's own samples
                (`LiveViewWebView.getStats`), so ONE overlay serves every
                platform and honours the chosen position. */}
            {statsPosition !== 'off' ? (
              <StreamStatsOverlay getStats={getStats} position={statsPosition} />
            ) : null}

            {/* Live viewers — how many people watch this camera right now. */}
            <LiveViewersBadge
              deviceId={deviceId}
              position={overlay.viewers}
              enabled={liveOverlaysVisible && status.isLive}
            />
          </OverlayFrame>

          {/* The battery hold uses the ORDINARY transports (the stream controls'
              play and the playback bar's play) — the dedicated centre disc +
              "sleeping" hint duplicated both and read as three play buttons
              (operator call, 2026-08-15). `batteryHold` still gates the stream
              mount itself; only the extra overlay is gone. */}

          {/* Per-player controls in the GRID TILE's on-video style: the
              controls that belong to the STREAM (play/pause · mute · talk ·
              history in fill · PiP · fullscreen). The ones that belong to TIME — go-live, ±10s,
              frame-step, speed — live in the timeline's playback bar, which
              also carries its own play/pause over the SAME binding used here.
              Visibility is parent-owned — the stage's single-tap gesture
              toggles it. */}
          <StreamOverlayControls
            visible={controlsVisible}
            onRequestHide={onHideControls}
            paused={effectivePaused}
            onTogglePause={onToggleEffectivePause}
            showPlayPause={showOverlayPlayPause}
            muted={muted}
            onToggleMute={onToggleMute}
            /* Why the clip on the frame is silent, when the SPEED is why
               (D621). Resolved by the stage — it is the only thing that knows
               which clip the report is about — and passed through, never
               re-derived here. */
            audio={clipStage.audioNotice}
            hasTwoWayAudio={hasTwoWayAudio}
            talking={talking}
            onToggleTalk={onToggleTalk}
            onStartSystemPip={onStartSystemPip}
            fullscreen={fullscreen}
            onToggleFullscreen={fullscreenOffered ? onToggleFullscreen : undefined}
            edgePad={fill ? { left: insets.left, right: timelineBeside ? 0 : insets.right, bottom: insets.bottom } : undefined}
            timelineToggle={fill ? { dock: timelineDock, onSet: setTimelineDock } : undefined}
            ptzToggle={fullscreenPtz ? { open: ptzOverlayOpen, onToggle: onTogglePtzOverlay } : undefined}
            activity={chromeActivity}
          />

          {/* The fullscreen PTZ pad (operator, 2026-10-23): the same
              `PtzControls` the timeline's panel mounts, on glass, above the
              left disc cluster. A SIBLING of the disc group like the drive
              overlay, sharing its visibility and safe-area. */}
          {fullscreenPtz && ptzOverlayOpen ? (
            <PtzOverlay
              deviceId={deviceId}
              visible={controlsVisible}
              edgePad={{ left: insets.left, right: timelineBeside ? 0 : insets.right, bottom: insets.bottom }}
              onInteract={onChromeActivity}
            />
          ) : null}

          {/* The robot camera's landscape drive: joystick + four buttons
              (operator, 2026-09-06). A SIBLING of the disc group, sharing its
              visibility and safe-area, because it must outlive auto-hide
              while the thumb is down. Gated on the picture actually
              playing — see `drivePlaying`. */}
          {fill && hasNavigation && drivePlaying ? (
            <DriveOverlay
              deviceId={deviceId}
              visible={controlsVisible}
              edgePad={{ left: insets.left, right: insets.right, bottom: insets.bottom }}
              onOpenControls={onOpenDriveControls}
              drawer={{ open: timelineDock === 'overlay', width: drawerWidth(winWidth) }}
            />
          ) : null}

          {/* Zone-filter DRAWING MODE — topmost over the stage. The stream keeps
              playing; while mounted the overlay claims the whole touch stream
              (video tap/pinch intentionally swallowed for the drawing session). */}
          {zoneDrawing ? (
            <ZoneDrawOverlay
              zone={timelineZone}
              onConfirm={onZoneConfirm}
              onCancel={onZoneCancel}
            />
          ) : null}
        </View>
      </Animated.View>
  )

  // The two discs the WALL carries in `fill`, and the only two.
  //
  // Everything else `StreamOverlayControls` offers acts on `liveRef` — mute,
  // talk, PiP, the play/pause that pauses one session — and `liveRef` is null
  // while the wall is up. A disc that stayed visible and did nothing is the
  // failure this screen keeps hitting, so those are simply absent and the
  // per-cell equivalents live in the cells (`GridCellPanelOverlay`), while
  // transport belongs to the drawer's playback bar.
  //
  // These two survive because neither touches the player. The timeline toggle
  // is the drawer's only opener and is REQUIRED here (see `wallStage`).
  // Fullscreen is offered for the state it would otherwise trap: `fill` is also
  // what explicit fullscreen resolves to, and an operator who builds a view
  // while in fullscreen would have no way out of it — the exit lived on the
  // picture that the wall replaced.
  const wallFillDiscs: readonly OverlayDisc[] = [
    {
      // BACK. In `fill` the toolbar — and with it the only back button — lives
      // inside the edge drawer, and the swipe that used to serve here belongs
      // to the picture's gesture stage, which the wall replaced: the WebView
      // owns its own touches, so the gesture is simply gone while it is up.
      // Without this the way out of a wall built on a phone in landscape is
      // two taps behind a drawer, where a moment earlier it was one gesture.
      // Not a dead end, but a regression, and it is one disc to undo.
      id: 'back',
      icon: ArrowLeft,
      label: t('v2.common.back'),
      active: false,
      onPress: () => backToCameras(router, forgetLastCamera),
      cluster: 'left',
    },
    timelineDockDisc({ dock: timelineDock, onSet: setTimelineDock, cluster: 'left', t }),
    // Kept while fullscreen is ON even where the button is not offered: it is
    // the way out of the state, whatever entered it.
    ...(fullscreenOffered || fullscreen
      ? [
          {
            id: 'fullscreen',
            icon: fullscreen ? Minimize2 : Maximize2,
            label: fullscreen ? t('v2.streamBar.exitFullscreen') : t('v2.streamBar.fullscreen'),
            active: fullscreen,
            onPress: onToggleFullscreen,
            cluster: 'right' as const,
          },
        ]
      : []),
  ]

  // The WALL, in the picture's slot. Everything above that belongs to the
  // single picture — the zoom gestures, the overlays, the on-video control
  // pills, the poster — is inside `streamBox` and therefore simply not mounted
  // while this is. See the module docblock for what each of those controls gets
  // instead.
  //
  // Three appearance props are the primary's documents applied WALL-WIDE. The
  // embed takes one tier, one highlight and one box switch for the whole page,
  // and the primary is the only camera whose preferences this screen owns —
  // so the alternative to stating them here is a quality chip and a
  // view-options menu that edit a picture nobody is looking at.
  //
  // ## Rotation is a RESTYLE, never a re-parent (2026-09-02)
  //
  // The wall is now reached in all three shapes, so a phone rotating from
  // landscape to portrait moves it from a window-filling box to the picture's
  // box in the portrait column. That must not cost a renegotiation. It does
  // not, and the reason is structural rather than careful: `TheaterTimeline`
  // holds ONE stream slot at index 1 of its column in every shape
  // (`stream-slot.ts`), this element is `props.stream`'s only child in every
  // shape, and the shape is expressed as a STYLE on this same `View`
  // (`wallBoxStyle`). Same element, same parent chain, new style — React
  // reconciles it in place and `GridLiveEmbed` keeps its document, its peers
  // and its `<video>`s. Proved by identity in `workspace-grid-mount.spec.ts`.
  //
  // The fill-only disc group is the SECOND child for the same reason. In `fill`
  // the timeline lives in the compact edge drawer and its ONLY opener is a disc
  // inside `StreamOverlayControls` — which is inside `streamBox`, and therefore
  // gone the moment the wall goes up. Without this the operator would build a
  // view in landscape and lose the timeline, the camera selector and the way
  // back in one commit. It is held open (`holdOpen`, no auto-hide) because the
  // stage's single-tap gesture belongs to the picture and is not mounted here:
  // a disc that hid itself after 3.5s could not be brought back.
  const wallStage = wallShowing ? (
    <View
      testID={WALL_STAGE_TEST_ID}
      style={[
        styles.wallWrap,
        fill && timelineBeside ? { marginRight: sideTimelineWidth(winWidth) } : null,
        wallBoxStyle({
          mode: layoutMode,
          wideStreamWidth: wideSizes.streamWidth,
          portraitStreamHeight: portraitSplit.streamHeight,
        }),
      ]}
    >
      <WorkspaceStage
        devices={onScreenIds}
        primary={wallPrimary}
        liveOverlaysVisible={liveOverlaysVisible}
        onGoTo={onSwitchCamera}
        onCellPanel={onShelfPanel}
      />
      {fill ? (
        <OverlayDiscGroup
          visible
          holdOpen
          onRequestHide={NEVER_HIDE}
          items={wallFillDiscs}
          edgePad={{ left: insets.left, right: timelineBeside ? 0 : insets.right, bottom: insets.bottom }}
        />
      ) : null}
    </View>
  ) : null

  // Every transport command the timebar still carries, mirrored onto the wall.
  //
  // Unconditional: with no wall mounted the bus has no sinks and this costs one
  // empty iteration — a gate on "is the wall up" would be a second answer to a
  // question `GridLiveEmbed`'s own mount already answers by registering.
  //
  // Built plainly rather than memoised, on purpose. `onToggleEffectivePause` is
  // a bare function in this scope and always has been, and `stream` below is a
  // fresh element every render, so `TheaterTimeline`'s `memo` has never been
  // load-bearing here. Wrapping it in `useMemo` would have meant `useCallback`
  // on that function and on the three it closes over, which the compiler then
  // reports as four new bailouts in the file with the most bailouts in the repo.
  const wallPlayback = fanOutPlaybackToWall({
    primary: {
      onSeek,
      onScrubBegin: playback.beginScrub,
      onScrubMove: playback.moveScrub,
      onScrubCommit,
      onGoLive: leaveClipToLive,
      onTogglePlayPause: onToggleEffectivePause,
      onSelectRate,
    },
    broadcast: gridPlaybackBus.broadcast,
    paused: effectivePaused,
  })

  /**
   * Leaving clips mode lands on the recorded axis AT THE CLIP'S INSTANT.
   *
   * > *"quando chiudo la modalità clip deve tornare sul playback sul punto che
   * > lasciamo dalla modalità clip"*
   *
   * Two actions, in this order and not the other: the clip is RELEASED first,
   * because while it holds the frame the scrub family is routed to the clip
   * feeder on the file's own axis (`timeline-session.ts`) — seeking first
   * would drive the clip, not the recording, and the operator would watch the
   * clip jump instead of leaving it.
   *
   * `null` means no clip was on the frame: nothing to resume to, so nothing is
   * seeked and the recorded playhead is left exactly where it was.
   */
  const onLeaveClipsMode = useCallback(
    (resumeAtMs: number | null): void => {
      closeClipStage()
      if (resumeAtMs === null) return
      wallPlayback.onSeek(resumeAtMs, 'timeline')
    },
    [closeClipStage, wallPlayback],
  )

  // The theater timeline: fills the remaining height in the mobile stack, or
  // the fixed right rail on wide. Unmounts entirely in fill mode (where the
  // landscape drawer mounts its own copy). Panels are laid out by whichever of
  // those columns is hosting it — there is no `align` / `maxWidth` to choose.
  const renderTimeline = () => (
    <TheaterTimeline
      ref={timelineRef}
      navBarVisible={showNavBar}
      layoutMode={layoutMode}
      railWidth={wideSizes.railWidth}
      stream={wallStage ?? streamBox}
      // A clip that is a FILE comes UP here rather than opening a player of its
      // own down there: the frame is this screen's, and so is the machine that
      // has to be detached for it (D570).
      onOpenClipInFrame={clipStage.open}
      onClipsChange={publishFrameClips}
      // The REEL — the ~38% under the picture that `STREAM_MAX_HEIGHT_FRACTION`
      // has reserved and left empty since it was written: the other cameras'
      // snapshots, reduced to one scrolling row as soon as the wall is up
      // (`BelowStreamArea`, rules in `workspace-grid.ts`).
      //
      // `wide` only, and that is now the ONLY thing this predicate decides. In
      // `stack` the timeline already owns the space under the picture and in
      // `fill` the picture owns the window, so a phone has no reel in either
      // shape — while having a WALL in both. Those two answers stopped being
      // the same one on 2026-09-02; `shouldShowCameraShelf` is the reel's, and
      // `canHostWorkspaceWall` is the wall's (asserted by value in
      // `camera-shelf.spec.ts` and `workspace-grid.spec.ts`, and at the mount
      // in `workspace-grid-mount.spec.ts`).
      belowStream={
        shouldShowCameraShelf(layoutMode) ? (
          <BelowStreamArea
            // The PICTURE's width, not the column's. Everything under the
            // picture is drawn to the same number the picture is drawn to, so
            // the reel ends exactly where the wall above it ends — see
            // `BelowStreamArea` for the two sources that used to disagree.
            width={wideSizes.streamWidth}
            currentDeviceId={deviceId}
            wallShowing={wallShowing}
            onGoTo={onSwitchCamera}
            onCellPanel={onShelfPanel}
            onOpenPlayback={onShelfOpenPlayback}
          />
        ) : null
      }
      deviceId={deviceId}
      // The whole view, picture first. With no view this is `[deviceId]` and
      // every read below takes its singular path — camera-detail unchanged.
      scopeIds={onScreenIds}
      hideBack={isWideDetail}
      drawerExpanded={landscapeDrawerOpen}
      drawerBeside={timelineBeside}
      name={name}
      onBack={() => backToCameras(router, forgetLastCamera)}
      deviceBinding={{
        cameraName: name,
        hasPtz,
        hasBattery,
        hasNetworkLink,
        hasNavigation,
        // The camera panel's three callbacks travel as ONE group — see
        // `TimelineCameraJumpBinding`. This screen always has somewhere to
        // jump; whether the BUTTON is drawn is the timeline's own tablet
        // question, not this screen's.
        cameraJump: {
          onSwitchCamera,
          onOpenAdhocGrid: onCameraSelection,
          cameraSelection,
        },
      }}
      // The controls that act on THIS camera, in one group — the grid page
      // omits it entirely (`TimelineSingleCameraBindings`).
      singleCamera={{
        // The chip shows the PREFERENCE the operator picked — not
        // `effectiveQuality`. Off the LAN the stream is clamped to `low`
        // (`liveTarget` / `qualityForRoute`); showing the clamp on the chip
        // made every pick look like it failed ("stays on the previous value").
        //
        // With the wall up the chip states the WALL's tier — the same session
        // value the wall's bar sets, so the two can never disagree, and never
        // written into this camera's preferences (`workspace-wall-options.ts`).
        streamBinding: wallShowing
          ? { quality: wallQualityPick ?? quality, onSelectQuality: onWallQualityChange }
          : { quality, onSelectQuality: onQualityChange },
        viewOptionsBinding: {
          highlight: cameraHighlight,
          onSetHighlight: onSetCameraHighlight,
        },
        overlayBinding: { config: overlay, onChange: onSetOverlay },
        // The linked-devices route the 2026-09-02 toolbar removal assumed was
        // already covered. It was not on THIS screen: the surfaces it named —
        // the shelf and the wall tile — are the two the single-camera player
        // does not mount, so the button vanished entirely. It posts the SAME
        // intent a wall tile posts, answered by the same host.
        onOpenLinkedDevices: () => {
          onShelfPanel('devices', deviceId)
        },
        // The chip acknowledges the press. Derived from the SAME state the host
        // renders from, so "lit" and "open" cannot disagree.
        linkedDevicesOpen: shelfPanel?.kind === 'devices' && shelfPanel.deviceId === deviceId,
        // The zone rect is DRAWN on the picture (`ZoneDrawOverlay`) and only
        // filtered by the timeline. With the wall up there is no picture to
        // draw it on and no single frame it would be normalised against, so the
        // binding is withheld and the zone button is not drawn — rather than
        // left visible over a control that could do nothing.
        ...(wallShowing
          ? {}
          : { zone: { zoneRect: timelineZone, drawing: zoneDrawing, onRequestZoneDraw, onClearZone } }),
      }}
      mode={playback.state.mode}
      // While a CLIP holds the frame the chrome names the clip, not the
      // session. The machine is deliberately untouched by a clip, so
      // `selectActiveEpoch` goes on reporting wherever the timeline was left —
      // which is how a card labelled 16:00 came to sit under a frame saying
      // 21:00, and read as the list being wrong (2026-09-21).
      activeEpoch={clipEpochOnFrame ?? selectActiveEpoch(playback.state)}
      seekAnchor={playback.state.seekAnchor}
      onSeek={wallPlayback.onSeek}
      onLeaveClipsMode={onLeaveClipsMode}
      onScrubBegin={wallPlayback.onScrubBegin}
      onScrubMove={wallPlayback.onScrubMove}
      onScrubCommit={wallPlayback.onScrubCommit}
      onGoLive={wallPlayback.onGoLive}
      liveLocked={playback.state.liveLocked}
      onToggleLiveLock={playback.toggleLiveLock}
      // The live clip is written by the picture's `<LiveView>`; with the wall up
      // there is no handle to start one on, so the flow is withheld — and with
      // no camera to export from either, the bar draws no record control at all
      // (`resolveRecordControl` returns undefined when the mode's flow is
      // absent).
      // Neither flow while a CLIP holds the frame: a live capture would record
      // the stored file off the <video>, and an export selection would cut the
      // recorder's footage under a picture that is not it. The file on screen
      // already has its own download (`clip-download.ts`). Absent binding ⇒
      // absent control, never a disabled one (`record-control.ts`).
      liveCapture={wallShowing || clipHeld ? undefined : liveCaptureBinding}
      exportSelection={wallShowing || clipHeld ? undefined : exportSelection}
      // The frame on screen into the Activity list. Not while a clip holds the
      // frame (a stored file has its own download) nor behind the wall.
      onSnapshot={wallShowing || clipHeld ? undefined : takeSnapshot}
      playbackRate={speed}
      // The SAME binding the on-video overlay receives — see the declaration.
      paused={effectivePaused}
      servedTier={servedTier}
      onTogglePlayPause={wallPlayback.onTogglePlayPause}
      loading={transportLoading}
      streamFault={streamFaultBinding}
      scrubDirection={selectScrubDirection(playback.state)}
      onJogBack={onJogBack}
      onJogForward={onJogForward}
      // A clip in the camera's own frame (D575) turns the jog pair into clip
      // stepping. These handlers already existed for the clip SHEET, which a
      // frame clip no longer draws — so `clipStage.step` went unreachable and
      // there was no way from one clip to the next but the list.
      clipHeld={clipStage.stage.kind === 'clip'}
      // WHICH clip, not just that there is one: the clips list highlights the
      // running row and draws its progress on it, and a boolean cannot say
      // which row that is.
      clipOnFrameId={clipStage.stage.kind === 'clip' ? clipStage.stage.clipId : null}
      onClipPrev={framePrev}
      onClipNext={frameNext}
      // Where inside the file the picture is, and the drag along it. The
      // timeline forwards it only while its surface says a FILE is on screen.
      clipProgress={{ progress: clipStage.progress, controls: clipStage.controls, ...clipStage.seek }}
      // The switch and the state it drives are ONE value: the chip is lit from
      // the same `clipLoop` the hook above is acting on.
      clipLoop={{ enabled: clipLoop, onToggle: onToggleClipLoop }}
      // The camera's own answer about its clips (D612) — the speed menu reads
      // it whether or not a file is on the frame, which is why it is a prop of
      // its own rather than a field of `clipProgress`.
      clipControls={clipStage.controls}
      // The verdict on the held clip's replay, already resolved against the
      // clip on the stage. Drawn in the chrome stack under the playback bar,
      // where this screen already says the stream is in trouble — and with no
      // retry beside it, because a second dial contends for the camera's
      // single replay lane (the operator's own choice, 2026-09-24).
      clipIncomplete={clipStage.incompleteNotice}
      onStepFrame={onStepFrame}
      onSelectRate={wallPlayback.onSelectRate}
    />
  )
  return (
    <View style={styles.screenRow}>
      {/* The side navigation stays on screen here.
          This route is a STACK route pushed OVER the tabs, so it never had the
          tab navigator's rail — open a camera on a tablet or a wide browser
          window and the navigation simply vanished, on the surface an operator
          sits in longest. Same `SideNavRail` the tabs mount, same list, same
          highlight rule (`nav-items.ts` maps `/camera/<id>` back to Cameras).

          `fill` is the deliberate-fullscreen gate and is left intact: an
          explicit fullscreen, and a phone in landscape, still own the whole
          window. On web the browser Fullscreen API elevates `fullscreenRef`
          below — which does NOT contain this rail — so that path hides it too,
          without a second rule. */}
      {showSideNav && !fill ? <SideNavRail pathname={pathname} compact={sidebarCompact} /> : null}
      <View
        ref={fullscreenRef}
        onLayout={onRootLayout}
        style={{
          flex: 1,
          minWidth: 0,
          backgroundColor: colors.background,
          paddingTop: fill ? 0 : insets.top,
        }}
      >
      {/* Over the black video (fill) the bar text is always light; in portrait it
          sits over the themed background, so follow the theme to stay legible. */}
      <StatusBar hidden={fill} style={fill ? 'light' : mode === 'dark' ? 'light' : 'dark'} />

      {/* The camera-detail column, whole. `TheaterTimeline` owns the toolbar,
          the picture slot, the body, the landscape drawer and the wide rail —
          because that is the only arrangement in which the player has ONE
          parent across every layout. Two attempts to keep the picture here and
          the chrome there both remounted it (1.0.263 by re-parenting on
          rotation, 1.0.265 by positioning an absolute host from a
          parent-relative `onLayout` offset). The screen no longer places the
          picture at all. */}
      {renderTimeline()}

      {/* The same bar the tab navigator draws, off the tab tree — the narrow
          half of what `SideNavRail` above does for a wide window.

          Inside the COLUMN, not floating over it: a bar that overlapped the
          picture would be the touch-eating absolute chain this screen has been
          burned by before. It costs no wrapper because the bar and the rail can
          never both be on screen (`stream-nav-bar.spec.ts` proves it by value),
          so the column IS the full width whenever this renders. */}
      {showNavBar ? <BottomNavBar pathname={pathname} insetBottom={insets.bottom} /> : null}

      {/* Nothing that belongs to THIS camera floats here. Every panel that used
          to be rendered at this point — PTZ, linked devices, the camera
          switcher, the view-options menu, the quality picker — and both
          management `<Modal>`s take over the TIMELINE body
          (`TimelineBodyPanel`), laid out by the column that hosts it, and no
          `topOffset` is derived from the video box's animated height.

          The one exception is a panel about ANOTHER camera, opened from the
          shelf. It cannot live in the timeline body: that body is bound to
          `deviceId`. It is the wall's host, unchanged, and it centres itself —
          so it needs no offset and the rule above is intact for everything it
          was written about. */}
      <GridCellPanelOverlay
        panel={shelfPanel}
        cameraName={shelfPanelCameraName}
        hasPtz={shelfPanelHasPtz}
        onSelect={(kind) => setCellPanel({ kind, deviceId: shelfPanel?.deviceId ?? deviceId })}
        onClose={closeCellPanel}
      />

      {/* The clip player. A SHEET, deliberately: it is a second player and says
          so, and it holds no opinion about the playback machine — which is
          exactly what 1.0.512 got wrong. Renders nothing while idle. */}
      <ClipStageView
        stage={clipStage.stage}
        playback={clipStage.playback}
        onPrev={framePrev}
        onNext={frameNext}
        onClose={closeClipStage}
      />

      </View>
    </View>
  )
}

/** Top ladder rung — a full-bleed poster never benefits from more. */
const POSTER_SNAPSHOT_WIDTH = 960

/** Frozen stream surface shown while paused: the server-owned snapshot over
 *  black. The platform image cache shows the last-fetched frame instantly (even
 *  cold-start) — no client-side poster store. */
function PausedPoster({
  deviceId,
  fill,
  enabled,
}: {
  deviceId: number
  fill: boolean
  /** Enrol keep-warm capture only on the live edge. A recorded gap still
   *  paints this poster, but naming the camera in getSnapshotLinks would
   *  recapture the live restream while the operator is in the archive. */
  enabled: boolean
}) {
  // Full-bleed, but still not the 4 K capture: the top ladder rung is a
  // 960-wide frame, which is more than any phone or tablet can show and about
  // 5% of the bytes. Anything that genuinely needs the frame AS CAPTURED (the
  // zone-drawing overlay, which derives geometry from it) asks for no width.
  const snapshot = useSnapshot(deviceId, enabled, POSTER_SNAPSHOT_WIDTH)
  return (
    <View style={styles.poster}>
      {/* While the snapshot link resolves (a few seconds against a cold hub),
          the stage was raw BLACK — which on a sleeping camera read as "broken"
          (operator report, 2026-08-15). The shimmer fills exactly the box the
          frame will paint. */}
      {snapshot.uri === null ? <SkeletonBox /> : null}
      <SnapshotImage
        source={snapshot}
        deviceId={deviceId}
        style={StyleSheet.absoluteFill}
        // Match the VIDEO's fit, or pausing visibly re-frames the scene. In
        // fill (landscape / fullscreen) the stream letterboxes inside the
        // window — `contain` — while the poster was covering, so a paused
        // camera jumped to a cropped, full-bleed still. Outside fill the box
        // already carries 16:9 and `cover` is the right choice.
        contentFit={fill ? 'contain' : 'cover'}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  /** Rail + screen. The rail is OUTSIDE the element the web Fullscreen API
   *  elevates, which is what makes deliberate fullscreen hide it for free. */
  screenRow: { flex: 1, flexDirection: 'row' },
  videoWrap: {
    position: 'relative',
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#000', // ui-check-ok: video stage — a camera picture sits on black in both themes
  },
  /** The WALL's wrapper. The BOX is `wallBoxStyle(...)`, composed over this —
   *  it differs per layout shape and every shape must state one, which is why
   *  no width, height or flex is written here.
   *
   *  In `wide` that box is the picture's width and every point of height the
   *  reel below it does not take: the picture is a 16:9 box with the snapshot
   *  rows filling the rest of the column, while the wall takes the column down
   *  to `SHELF_STRIP_HEIGHT` and the reel becomes the one-row strip that
   *  reserves exactly that (`workspace-grid.ts`). `BelowStreamArea` drops its
   *  own `flex` in that state, or the two would split the column instead. */
  wallWrap: { overflow: 'hidden' },
  /** Fill mode. No zIndex: the picture's stacking order belongs to the SLOT
   *  that hosts it (`STREAM_SLOT_Z` in `stream-slot.ts`) — here it would only
   *  rank the player against siblings it does not have, while the comparison
   *  that matters (picture vs the landscape drawer) happens one level up. */
  videoWrapFull: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000', // ui-check-ok: video stage — a camera picture sits on black in both themes
  },
  videoContent: {
    flex: 1,
    overflow: 'hidden',
  },
  disabledStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#000', // ui-check-ok: video stage — a camera picture sits on black in both themes
  },
  disabledTitle: { color: '#e8eaed', fontSize: 15, fontWeight: '700' }, // ui-check-ok: video stage — a camera picture sits on black in both themes
  disabledHint: { color: '#9aa0a6', fontSize: 12 }, // ui-check-ok: video stage — a camera picture sits on black in both themes
  noRecOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)', // ui-check-ok: video stage — a camera picture sits on black in both themes
  },
  noRecTitle: {
    color: '#e8eaed', // ui-check-ok: video stage — a camera picture sits on black in both themes
    fontSize: 15,
    fontWeight: '600',
  },
  noRecHint: {
    color: '#9aa0a6', // ui-check-ok: video stage — a camera picture sits on black in both themes
    fontSize: 12,
  },
  poster: {
    flex: 1,
    backgroundColor: '#000', // ui-check-ok: video stage — a camera picture sits on black in both themes
  },
  nameTag: {
    position: 'absolute',
    top: 8,
    left: 8,
    maxWidth: '70%',
  },
  nameTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  nameText: {
    fontSize: 13,
    fontWeight: '600',
  },
})
