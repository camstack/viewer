/**
 * GridViewScreen — immersive live multi-camera wall for a saved grid, OR for an
 * ON-THE-FLY (ad-hoc) grid built from a device-id list.
 *
 * AD-HOC MODE (`gridId === null` + `adhocCameraIds`): the camera switcher's
 * multiselect opens `/grid/adhoc?devices=1,2,3` — a TRANSIENT grid that never
 * touches the grid store. The grid object lives in local component state and
 * every store write (quality / layout / highlight / audio) is redirected
 * through the SAME pure reducers onto that local copy, so the whole control
 * bar works identically; on exit the state simply unmounts (nothing to clean
 * up, nothing appears in the grids list). The builder ("edit") and share
 * actions are hidden — there is no persisted grid to edit or snapshot.
 *
 * No screen header: the grid is a full-bleed surface and the wall's own chrome
 * is the collapsible `GridControlBar` (back, title, pause, mute, quality,
 * layout, highlight, active-only, edit). Camera management (reorder / hide /
 * remove) lives entirely in the builder ("edit") — there is no separate reorder
 * mode.
 *
 * On a tablet-class surface the wall is additionally hosted BY the timeline —
 * the theater's, scoped to this grid's cameras (`GridWallTimeline`). The page's
 * own band of per-camera lanes was deleted on 2026-09-02; a phone still has no
 * timeline here at all, and its tree is unchanged.
 *
 * iOS/web render the shared server embed (one WebView, N peers, decodes H265);
 * Android keeps the native per-tile wall (`react-native-webrtc` has no HEVC).
 *
 * SIZING — the wall is seeded deterministically from `Dimensions` minus the
 * safe-area insets (no header now), then refined by `onLayout`, so it's never
 * blank on first paint.
 */
import React, { useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { useViewportSize } from '../hooks/use-viewport-size.js'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import * as ScreenOrientation from 'expo-screen-orientation'
import { ChevronLeft } from '../lib/icons.js'
import { GlassButton } from '../components/ui/GlassButton.js'
import { HEADER_BUTTON_SIZE, HEADER_PADDING_TOP, HEADER_PADDING_X } from '../components/screen-header-metrics.js'
import { useTheme } from '../theme/theme-provider.js'
import { GridWall } from '../components/grid/GridWall.js'
import { GridWallBackButton } from '../components/grid/GridWallBackButton.js'
import { createWallTouchRelay } from '../grid/wall-back-visibility.js'
import { GridWallTimeline } from '../components/grid/GridWallTimeline.js'
import {
  gridWallStackHeight,
  shouldMountGridTimeline,
} from '../grid/grid-timeline-surface.js'
import { resolveDetailLayoutMode } from '../screens/camera-detail/detail-layout.js'
import { computeWideDetailSizes } from '../screens/camera-detail/wide-detail-sizes.js'
import { shouldRestorePortraitLock, useScreenMinSide } from '../hooks/use-responsive.js'
import { GridLiveEmbed } from '../grid-embed/GridLiveEmbed.js'
import { GridControlBar } from '../components/grid/GridControlBar.js'
import { GridShareDialog } from '../components/grid/GridShareDialog.js'
import { useServer } from '../app/ServerProvider.js'
import { GridCellPanelOverlay } from '../components/grid/GridCellPanelOverlay.js'
import { resolveCellPanel, type GridCellPanel, type GridCellPanelKind } from '../grid/cell-controls.js'
import { GridTapDismiss } from '../components/grid/GridTapDismiss.js'
import { shouldInterceptGridTap, type GridPanelsOpen } from '../grid/panel-dismiss.js'
import { useCanActuate } from '../hooks/use-user-scope.js'
import {
  OVERLAY_DEFAULTS,
  type OverlayLayer,
} from '../components/camera/overlay/overlay-config.js'
import { useCameraPrefsStore } from '../store/camera-prefs-store.js'
import { SPACING, RADIUS } from '../theme/tokens.js'
import { computeGridLayout } from '../grid/auto-layout.js'
import {
  useGridStore,
  resolveGridOptions,
  withHighlightDefaults,
  setGridOptionsEntry,
  setGridHighlightEntry,
  type Grid,
  type GridOptions,
  type GridLayout,
  type GridHighlightSettings,
  findServerGrid,
} from '../store/grid-store.js'
import { useActiveServerId } from '../store/server-scope.js'
import {
  EMPTY_GRID_LOCAL,
  resolveGridLayout,
  resolveGridQuality,
  useGridLocalStore,
  withAllGridAudio,
  withGridAudioInitial,
  withGridLayout,
  withGridQuality,
  type GridLocal,
} from '../store/grid-local-store.js'
import type { StreamQuality } from '../store/settings-store.js'
import { useDeviceSettingsStore } from '../store/device-settings-store.js'
import { buildTileOverlayMap, type GridHighlightEmbedConfig } from '../grid-embed/embed-config.js'
import { useCameras, FEATURE, type CameraInfo } from '../data/use-cameras.js'
import { heldTileIds, toggleTileTransport, toggleWallTransport } from '../live/battery-stream-gate.js'
import { useSettings } from '../data/use-settings.js'
import { useScreenActive } from '../hooks/use-screen-active.js'
import { backToCameras } from '../navigation/back-to-cameras.js'
import { HeaderBackButton } from '../components/ScreenHeader.js'

interface GridViewScreenProps {
  /** Persisted grid id, or null for an ad-hoc (on-the-fly, unpersisted) grid. */
  readonly gridId: string | null
  /** Camera ids for the ad-hoc grid (only read when `gridId` is null). */
  readonly adhocCameraIds?: readonly number[]
}

/** Local id stamped on the transient ad-hoc grid object (never persisted). */
const ADHOC_GRID_ID = 'adhoc'

/** iOS/web render the shared server embed (one WebView, N peers, decodes H265);
 *  Android keeps the native per-tile wall (`react-native-webrtc` has no HEVC). */
const USE_EMBED = Platform.OS === 'ios' || Platform.OS === 'web'

export function GridViewScreen({ gridId, adhocCameraIds }: GridViewScreenProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width: winW, height: winH } = useViewportSize()

  const grids = useGridStore((s) => s.grids)
  const hydrate = useGridStore((s) => s.hydrate)
  const hydrated = useGridStore((s) => s.hydrated)
  const setGridOptions = useGridStore((s) => s.setGridOptions)
  const setGridHighlight = useGridStore((s) => s.setGridHighlight)
  // A wall's LAYOUT, SOUND and TIER are device settings (`grid-local-store`):
  // they never travel with the account, so a tablet signed in as the same
  // user keeps its own.
  const hydrateGridLocal = useGridLocalStore((s) => s.hydrate)
  const storedLocal = useGridLocalStore((s) => (gridId === null ? undefined : s.local.byId[gridId]))
  const setGridAudioInitial = useGridLocalStore((s) => s.setGridAudioInitial)
  const setAllGridAudio = useGridLocalStore((s) => s.setAllGridAudio)
  const setGridQuality = useGridLocalStore((s) => s.setGridQuality)
  const setGridLayout = useGridLocalStore((s) => s.setGridLayout)

  // `data === undefined` means the camera list has NOT been answered yet — by
  // the cold-launch cache OR by the hub. It is not the same as "there are no
  // cameras", and the difference is load-bearing below.
  const { data: cameras } = useCameras()
  const camerasKnown = cameras !== undefined
  const cameraList = cameras ?? []
  const { settings } = useSettings()
  const { server } = useServer()
  const serverUrl = server?.serverUrl ?? null
  const screenActive = useScreenActive()

  // Ad-hoc mode: the grid object lives in LOCAL state (never the store). Store
  // writes are redirected through the same pure reducers onto this copy below.
  const isAdhoc = gridId === null
  const [adhocGrid, setAdhocGrid] = useState<Grid>(() => ({
    id: ADHOC_GRID_ID,
    name: '',
    cameraIds: adhocCameraIds ?? [],
  }))

  // A grid of ANOTHER hub is "not found" here: its camera ids name that hub's
  // cameras, and this hub's camera with the same id is a different camera.
  const serverId = useActiveServerId()
  const grid = useMemo(
    () => (isAdhoc ? adhocGrid : findServerGrid(grids, gridId, serverId)),
    [isAdhoc, adhocGrid, grids, gridId, serverId],
  )
  // The ad-hoc wall's sound and tier: screen state, like the rest of it.
  const [adhocLocal, setAdhocLocal] = useState<GridLocal>(EMPTY_GRID_LOCAL)
  const gridLocal: GridLocal = isAdhoc ? adhocLocal : (storedLocal ?? EMPTY_GRID_LOCAL)

  // One dispatcher per store writer: persisted grids go through the zustand
  // store; the ad-hoc grid applies the SAME pure reducer to the local copy.
  const applyAdhocEdit = (reduce: (all: readonly Grid[]) => readonly Grid[]): void => {
    setAdhocGrid((prev) => reduce([prev])[0] ?? prev)
  }
  const updateGridOptions = (patch: GridOptions): void => {
    if (gridId === null) applyAdhocEdit((all) => setGridOptionsEntry(all, ADHOC_GRID_ID, patch))
    else setGridOptions(gridId, patch)
  }
  const updateGridHighlight = (highlight: GridHighlightSettings): void => {
    if (gridId === null) applyAdhocEdit((all) => setGridHighlightEntry(all, ADHOC_GRID_ID, highlight))
    else setGridHighlight(gridId, highlight)
  }
  const updateGridAudioInitial = (deviceId: number, on: boolean): void => {
    if (gridId === null) setAdhocLocal((prev) => withGridAudioInitial(prev, deviceId, on))
    else setGridAudioInitial(gridId, deviceId, on)
  }
  const updateAllGridAudio = (deviceIds: readonly number[], on: boolean): void => {
    if (gridId === null) setAdhocLocal((prev) => withAllGridAudio(prev, deviceIds, on))
    else setAllGridAudio(gridId, deviceIds, on)
  }
  const updateGridQuality = (quality: StreamQuality): void => {
    if (gridId === null) setAdhocLocal((prev) => withGridQuality(prev, quality))
    else setGridQuality(gridId, quality)
  }
  const updateGridLayout = (layout: GridLayout): void => {
    if (gridId === null) setAdhocLocal((prev) => withGridLayout(prev, layout))
    else setGridLayout(gridId, layout)
  }

  // All grid display options are PER-GRID with built-in defaults — no global
  // grid settings — so the builder and the wall resolve identically. The layout
  // is this device's (`grid-local-store`).
  const wallLayout = resolveGridLayout(gridLocal)
  const options = useMemo(() => resolveGridOptions(grid?.options, wallLayout), [grid?.options, wallLayout])
  const quality = resolveGridQuality(gridLocal)

  // Paused tiles — the one genuinely transient control. The bar's mass button
  // shows Play if ANY is paused (grid-wide or individual) → resumes all; else
  // pauses all. In-tile pause toggles one. Host owns the set so the embed
  // reflects it. Deliberately NOT persisted: a wall that reopens frozen looks
  // broken, and pausing is an action rather than a preference.
  const [pausedIds, setPausedIds] = useState<ReadonlySet<number>>(new Set())
  /**
   * Battery tiles the operator explicitly STARTED.
   *
   * A battery camera's default on this wall is stopped — opening a grid must
   * never wake one (`live/battery-stream-gate.ts`). That default cannot live in
   * `pausedIds`: seeding it there would make `anyPaused` true, flip the bar's
   * mass button to Play on a wall nobody paused, and blanket-pause the Android
   * native wall (which reads the aggregate, not per-tile). So the operator's
   * consent is its own set, and the two resolve through the shared gate.
   */
  const [startedIds, setStartedIds] = useState<ReadonlySet<number>>(new Set())
  /**
   * The wall's view switches — master border highlight, active-only filter and
   * the live bounding-box overlay — are PER-GRID SETTINGS, read straight off
   * the resolved options and written back through `updateGridOptions`.
   *
   * They used to be `useState` seeded from literals, which is why they "did not
   * persist": there was no write path at all, so every reopen re-seeded them
   * off. Anything the bar can change must land in the grid, or the grid is not
   * where the answer lives.
   */
  const highlightOn = options.highlightOn
  const activeOnly = options.activeOnly
  const layers: readonly OverlayLayer[] = options.layers
  /** Share-builder dialog visibility (bar's Share button). */
  const [shareOpen, setShareOpen] = useState(false)
  /**
   * The control bar's OPEN POPOVER — audio / quality / layout / highlight menu.
   *
   * It lived inside `FloatingControlBar` until a tap on the wall was asked to
   * close it: a component that cannot see the wall cannot be told the operator
   * tapped it. The page owns the three things it can have open, in one place
   * (`grid/panel-dismiss`), and every surface that dismisses calls the same
   * `dismissPanels` — the bar's own close, the cell card's backdrop, the share
   * modal's backdrop and the body layer below.
   */
  const [barPanelKey, setBarPanelKey] = useState<string | null>(null)
  // Combinable audio — the bar selector and the builder pre-selection point to
  // the SAME per-grid, device-local setting (`grid-local` audioOnIds): the
  // selector updates it at runtime, and it drives which cameras open with
  // audio on. No transient state.
  const storedAudioOnIds = gridLocal.audioOnIds
  const audioOnIds = useMemo(() => new Set(storedAudioOnIds ?? []), [storedAudioOnIds])
  const audioOnArray = useMemo(() => [...(storedAudioOnIds ?? [])], [storedAudioOnIds])
  const toggleAudio = (id: number): void => updateGridAudioInitial(id, !audioOnIds.has(id))

  useEffect(() => {
    void hydrate()
    void hydrateGridLocal()
  }, [hydrate, hydrateGridLocal])

  // Immersive: allow free rotation while the grid is open. The StatusBar is
  // hidden for a full-bleed wall.
  //
  // On leave we restore the portrait lock ONLY on a phone. `lockAsync` is
  // APP-WIDE, and this cleanup used to run unconditionally: closing a grid on a
  // tablet held in landscape rotated the whole app to portrait, so the screen
  // underneath — usually the camera theater, since the adhoc grid is opened FROM
  // its timeline — saw portrait dimensions and correctly resolved to the stacked
  // layout. The operator saw the timeline drop under the picture "a volte", and
  // it stayed there: a detail screen still mounted never re-runs its own
  // `unlockAsync`. See `shouldRestorePortraitLock`.
  const screenMinSide = useScreenMinSide()
  useEffect(() => {
    void ScreenOrientation.unlockAsync()
    return () => {
      if (shouldRestorePortraitLock({ screenMinSide, isWeb: Platform.OS === 'web' })) {
        void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
        return
      }
      void ScreenOrientation.unlockAsync()
    }
  }, [screenMinSide])

  const memberCameras = useMemo<readonly CameraInfo[]>(() => {
    if (!grid) return []
    const byId = new Map(cameraList.map((c) => [c.id, c]))
    const resolved: CameraInfo[] = []
    for (const id of grid.cameraIds) {
      const cam = byId.get(id)
      if (cam) resolved.push(cam)
    }
    return resolved
  }, [grid, cameraList])

  const hiddenIds = useMemo(() => new Set(grid?.hiddenCameraIds ?? []), [grid?.hiddenCameraIds])
  const wallCameras = useMemo<readonly CameraInfo[]>(
    () => (hiddenIds.size === 0 ? memberCameras : memberCameras.filter((c) => !hiddenIds.has(c.id))),
    [memberCameras, hiddenIds],
  )

  /**
   * The per-camera INDICATORS the wall must draw — motion regions, the motion
   * pill, the audio meter, the occupancy chips, the stream read-out.
   *
   * The native wall reads each camera's prefs in the tile itself; the EMBED
   * cannot (it is a separate bundle behind a WebView), so the host resolves the
   * map here and pushes it. Only cameras that placed something appear
   * (`buildTileOverlayMap`), and only cameras on the wall are asked — a grid of
   * three does not carry the prefs of forty.
   *
   * Hydrated here as well as in the tiles: on a cold launch straight into a
   * wall the store is empty, and an empty store resolves to the DEFAULT overlay
   * — a wall that silently draws factory settings over configured cameras.
   */
  const prefsById = useCameraPrefsStore((s) => s.prefs.byId)
  const hydratePrefs = useCameraPrefsStore((s) => s.hydrate)
  // Device-local: how big the wall's indicators are drawn on THIS screen.
  const overlaySize = useDeviceSettingsStore((s) => s.settings.overlaySize)
  useEffect(() => {
    void hydratePrefs()
  }, [hydratePrefs])
  const tileOverlays = useMemo(
    () =>
      buildTileOverlayMap(
        wallCameras.map((c) => ({
          deviceId: c.id,
          overlay: prefsById[c.id]?.overlay ?? OVERLAY_DEFAULTS,
        })),
        overlaySize,
      ),
    [wallCameras, prefsById, overlaySize],
  )

  // PTZ: which wall cameras support it (drives the in-tile PTZ buttons).
  // A session the hub would refuse gets an EMPTY list, so neither the in-tile
  // disc nor the compact sheet's PTZ row is drawn — the same `actuate` gate
  // the single-camera theater applies, at the one place the wall computes it.
  const canActuate = useCanActuate()
  const ptzIds = useMemo(
    () =>
      canActuate
        ? wallCameras.filter((c) => c.features.includes(FEATURE.ptz)).map((c) => c.id)
        : [],
    [wallCameras, canActuate],
  )

  // ONE cell panel over the wall — PTZ, the camera's linked devices, its
  // view-options menu, or the compact list that offers them on a small cell.
  // A single union (kind + device in one value) rather than a boolean per
  // surface: "a panel is open" and "there is a camera to open it for" cannot
  // disagree, and only one thing is ever mounted (see GridCellPanelOverlay for
  // why that matters on an N-tile wall).
  const [openPanel, setOpenPanel] = useState<GridCellPanel | null>(null)
  const wallIds = useMemo(() => wallCameras.map((c) => c.id), [wallCameras])
  // A camera hidden / removed / filtered out from under an open panel closes it.
  const cellPanel = useMemo(() => resolveCellPanel(openPanel, wallIds), [openPanel, wallIds])
  const panelCamera = useMemo(
    () => (cellPanel ? (wallCameras.find((c) => c.id === cellPanel.deviceId) ?? null) : null),
    [wallCameras, cellPanel],
  )
  const openCellPanel = (kind: GridCellPanelKind, deviceId: number): void =>
    setOpenPanel({ kind, deviceId })

  // ONE answer to "is something open over this wall", and ONE dismiss. A fourth
  // panel adds a field here and is covered everywhere at once, instead of
  // arriving with an outside-tap rule that disagrees with the other three.
  const panelsOpen: GridPanelsOpen = {
    barPanel: barPanelKey,
    cellPanel: cellPanel !== null,
    share: shareOpen,
  }
  const dismissPanels = (): void => {
    setBarPanelKey(null)
    setOpenPanel(null)
    setShareOpen(false)
  }

  // Pause aggregation: any paused (grid or individual) → mass button shows Play
  // and resumes ALL; none paused → shows Pause and pauses ALL.
  const anyPaused = pausedIds.size > 0
  /** Every battery camera on this wall — the gate's only per-camera input. */
  const batteryIds = useMemo(
    () => new Set(wallCameras.filter((c) => c.features.includes(FEATURE.battery)).map((c) => c.id)),
    [wallCameras],
  )
  /**
   * What the EMBEDDED wall (iOS + web) boots paused, and is pushed on change.
   *
   * `pausedIds` is seeded into the injected config, so a tile in this list never
   * negotiates at all — which is the property that keeps a sleeping camera
   * asleep. The embed tile already draws a Play button while paused, so the
   * explicit start the operator has to make is the affordance that is already
   * there. (The Android native wall does not use this: `GridTile` runs the same
   * gate per tile, because its `paused` prop is a wall-wide aggregate.)
   */
  const wallPausedIds = useMemo(() => {
    if (screenActive) return pausedIds
    return new Set([...pausedIds, ...wallCameras.map((c) => c.id)])
  }, [screenActive, pausedIds, wallCameras])
  const embedPausedIds = useMemo(
    () =>
      heldTileIds(
        wallCameras.map((c) => ({ id: c.id, batteryPowered: batteryIds.has(c.id) })),
        { pausedIds: wallPausedIds, startedIds },
      ),
    [wallCameras, batteryIds, wallPausedIds, startedIds],
  )
  const togglePauseTile = (id: number): void => {
    // ONE decision, taken in the gate: on a battery tile that has never run,
    // this press means START (and wakes the camera); everywhere else it is the
    // ordinary pause/resume it always was.
    const next = toggleTileTransport(
      { pausedIds, startedIds },
      id,
      batteryIds.has(id),
    )
    setPausedIds(next.pausedIds)
    setStartedIds(next.startedIds)
  }
  const toggleMassPause = (): void => {
    // The SAME mass toggle the camera-detail wall's bar runs
    // (`toggleWallTransport`): one meaning of "pause all" for every wall.
    const next = toggleWallTransport({ pausedIds, startedIds }, wallIds, batteryIds)
    setPausedIds(next.pausedIds)
    setStartedIds(next.startedIds)
  }

  // Audio aggregation: any camera with audio on → master row mutes ALL; none on
  // → unmutes ALL visible cameras. Persisted via the per-grid, device-local audioOnIds set (grid-local).
  const anyAudioOn = audioOnIds.size > 0
  const toggleMassAudio = (): void =>
    updateAllGridAudio(anyAudioOn ? [] : wallCameras.map((c) => c.id), !anyAudioOn)

  const seedBox = useMemo(
    () => ({ width: winW, height: Math.max(0, winH - insets.top - insets.bottom) }),
    [winW, winH, insets.top, insets.bottom],
  )
  const [box, setBox] = useState(seedBox)

  /**
   * THE timeline — the theater's, scoped to this grid's cameras.
   *
   * Not a region beside the wall any more: the wall is its CHILD (the stream
   * slot), which is what keeps the wall's parent chain fixed across a rotation.
   * Two consequences, both deliberate:
   *
   *  - the clock button is back, but it HIDES rather than unmounts. Mounting
   *    the timeline around the wall would tear down every peer on it, so "off"
   *    is a state of the always-mounted host (`chromeHidden`) — the chrome
   *    stops drawing and stops reading, the wall takes the whole surface, and
   *    nothing is re-parented.
   *  - the shape is `resolveDetailLayoutMode`'s, not a second placement rule:
   *    a tablet in landscape gets the right rail, in portrait the stacked
   *    column. A PHONE gets no timeline at all, in either orientation, which is
   *    the same exclusion the deleted band's gate made.
   */
  const viewportInput = useMemo(
    () => ({
      width: winW,
      height: winH,
      screenMinSide,
      isWeb: Platform.OS === 'web',
      fullscreen: false,
    }),
    [winW, winH, screenMinSide],
  )
  const showTimeline = shouldMountGridTimeline(viewportInput) && wallCameras.length > 0
  /**
   * The clock button's state — SESSION state, and OFF at open.
   *
   * Off is what this page did before the substitution (`useState(false)` on the
   * deleted band), and it is what the operator opens the page for: the wall.
   * Not persisted, for the same reason `pausedIds` is not — a wall that reopens
   * with a timeline nobody asked for is the surface deciding, and the button is
   * one tap away.
   *
   * It never unmounts anything. `showTimeline` above — the tablet gate — is
   * what decides whether `GridWallTimeline` is MOUNTED, and it answers a
   * viewport, so a tap cannot change it. This flag only tells the mounted host
   * whether to draw its chrome; the wall stays exactly where it is in the tree
   * across every toggle, which is what keeps its peers alive.
   */
  const [timelineOn, setTimelineOn] = useState(false)
  const timelineShape = resolveDetailLayoutMode(viewportInput)
  const wideSizes = useMemo(
    () => computeWideDetailSizes({ containerWidth: winW, viewportHeight: winH }),
    [winW, winH],
  )

  const layout = useMemo(
    () => computeGridLayout(wallCameras.length, box.width, box.height, options.layout),
    [wallCameras.length, box.width, box.height, options.layout],
  )

  // Persisted per-grid highlight triggers (defaults filled) — edited live from
  // the bar's runtime menu; writes go through the store so they survive
  // close/reopen (the same object the builder used to edit).
  const highlightSettings = useMemo(() => withHighlightDefaults(grid?.highlight), [grid?.highlight])

  // Highlight config for the embed: per-grid triggers + the bar's master toggle.
  // Memoized so the embed only re-injects when something actually changes.
  const highlightConfig = useMemo<GridHighlightEmbedConfig>(
    () => ({
      enabled: highlightOn,
      ...highlightSettings,
      appearance: settings.highlight,
      motionHoldSec: settings.grid.motionHoldSec,
    }),
    [highlightOn, highlightSettings, settings.highlight, settings.grid.motionHoldSec],
  )

  // Ad-hoc grids have no builder to edit — the action is hidden entirely.
  const goEdit = gridId !== null ? (): void => router.push(`/grid/${gridId}/edit`) : undefined
  const goBack = (): void => backToCameras(router)
  const [touches] = useState(createWallTouchRelay)
  const title = isAdhoc
    ? t('v2.gridView.adhocTitle')
    : (grid?.name ?? t('v2.gridView.fallbackTitle'))

  // Grid not found (deleted, or never hydrated yet).
  if (hydrated && !grid) {
    return (
      <View style={[styles.fill, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <BackChip onPress={goBack} />
        <View style={styles.center}>
          <Text style={{ color: colors.foregroundMuted, fontSize: 15 }}>{t('v2.gridView.notFound')}</Text>
        </View>
      </View>
    )
  }

  const controlBar = (
    <GridControlBar
      title={title}
      onBack={goBack}
      onEdit={goEdit}
      anyPaused={anyPaused}
      onTogglePause={toggleMassPause}
      cameras={wallCameras}
      audioOnIds={audioOnIds}
      onToggleAudio={toggleAudio}
      anyAudioOn={anyAudioOn}
      onToggleMassAudio={toggleMassAudio}
      quality={quality}
      onSelectQuality={updateGridQuality}
      layout={options.layout}
      onSelectLayout={updateGridLayout}
      highlightOn={highlightOn}
      onToggleHighlight={() => updateGridOptions({ highlightOn: !highlightOn })}
      highlightSettings={highlightSettings}
      onSetHighlightSettings={(patch) => updateGridHighlight({ ...highlightSettings, ...patch })}
      layers={layers}
      onToggleLayer={(layer) =>
        updateGridOptions({
          layers: layers.includes(layer)
            ? layers.filter((l) => l !== layer)
            : [...layers, layer],
        })
      }
      activeOnly={activeOnly}
      onToggleActiveOnly={() => updateGridOptions({ activeOnly: !activeOnly })}
      onShare={serverUrl !== null && !isAdhoc ? () => setShareOpen(true) : undefined}
      // No button at all on a phone: there is no timeline here to show.
      timelineOn={showTimeline ? timelineOn : undefined}
      onToggleTimeline={showTimeline ? () => setTimelineOn((v) => !v) : undefined}
      panelKey={barPanelKey}
      onPanelKey={setBarPanelKey}
    />
  )

  /**
   * The bar, over the layer that swallows a tap on the wall while anything is
   * open. Order matters and is the mechanism, not a detail: the layer is a
   * sibling ABOVE the picture and BELOW the bar, so the dismissing tap never
   * reaches a tile (it does not "also act"), and the popover stays hittable.
   * With nothing open the layer is not rendered, so the wall's own gestures —
   * tile press, long-press, pinch, the cell controls — are untouched.
   */
  const chrome = (
    <>
      <GridTapDismiss
        active={shouldInterceptGridTap(panelsOpen)}
        onDismiss={dismissPanels}
        accessibilityLabel={t('v2.cameraDetail.close')}
      />
      {controlBar}
    </>
  )

  // The wall, exactly as it was: the same subtree, the same `onLayout`, so the
  // cells still reflow to the box that is actually LEFT — whether that box is
  // the whole screen or what the timeline's rail / column does not take.
  const wall = (
    <View
      style={styles.content}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout
        if (width > 0 && height > 0) {
          setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
        }
      }}
    >
      {memberCameras.length === 0 && !camerasKnown && (grid?.cameraIds.length ?? 0) > 0 ? (
        /* The grid names cameras and we do not yet have a camera list to
           resolve them against. Saying "this grid is empty, add cameras" here
           is a claim we cannot support — and it is what a cold launch showed,
           on a grid that was full, until the list arrived and the whole
           subtree was swapped for the player. Wait instead. */
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <BackChip onPress={goBack} />
          <ActivityIndicator color={colors.foregroundMuted} />
        </View>
      ) : memberCameras.length === 0 ? (
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <BackChip onPress={goBack} />
          <Text style={{ color: colors.foregroundMuted, fontSize: 15 }}>{t('v2.gridView.emptyGrid')}</Text>
          <Pressable
            onPress={goEdit}
            style={({ pressed }) => ({
              marginTop: SPACING.md,
              paddingVertical: SPACING.md,
              paddingHorizontal: SPACING.xl,
              borderRadius: RADIUS.md,
              backgroundColor: pressed ? colors.surfaceHover : colors.primary,
            })}
          >
            <Text style={{ color: colors.primaryForeground, fontSize: 15, fontWeight: '600' }}>
              {t('v2.gridView.addCameras')}
            </Text>
          </Pressable>
        </View>
      ) : wallCameras.length === 0 ? (
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <BackChip onPress={goBack} />
          <Text style={{ color: colors.foregroundMuted, fontSize: 15, textAlign: 'center' }}>
            {t('v2.gridView.allHidden')}
          </Text>
          {chrome}
        </View>
      ) : USE_EMBED ? (
        <>
          <GridLiveEmbed
            devices={wallCameras.map((c) => c.id)}
            quality={quality}
            layout={options.layout}
            showName={options.showName}
            audioOnIds={audioOnArray}
            pausedIds={embedPausedIds}
            highlight={highlightConfig}
            activeOnly={activeOnly}
            // The hosted embed player draws SURVIVORS only — it has neither a
            // discarded nor a parked layer — so only the `objects` chip
            // reaches it. The other two are native-wall/single-view for now.
            showBoxes={layers.includes('objects')}
            // Each camera's OWN indicators — the per-cell menu offers them
            // per camera, so the wall paints them per camera.
            overlays={tileOverlays}
            ptzIds={ptzIds}
            onTileOpen={(id) => router.replace(`/camera/${id}`)}
            onAudioToggle={toggleAudio}
            onPauseToggle={togglePauseTile}
            onPtzOpen={(id) => openCellPanel('ptz', id)}
            // Linked devices / view-options menu / the compact list — the
            // tile asks, the host mounts one of ITS panels (the embed has no
            // access to the app's components).
            onCellPanelOpen={openCellPanel}
          />
          {chrome}
        </>
      ) : layout.cellW > 0 ? (
        <>
          {/* Android native wall: combinable per-tile audio isn't wired yet —
              unmute all when any camera is selected (iOS uses the embed). */}
          <GridWall
            cameras={wallCameras}
            layout={layout}
            showName={options.showName}
            quality={quality}
            muted={audioOnIds.size === 0}
            paused={anyPaused || !screenActive}
            layers={layers}
            ptzIds={ptzIds}
            onCellPanelOpen={openCellPanel}
          />
          {chrome}
        </>
      ) : null}
    </View>
  )

  return (
    // ui-check-ok: video wall — live pictures sit on black in both themes
    <View style={[styles.fill, { backgroundColor: '#000' }]} onTouchStart={touches.notify}>
      <StatusBar hidden style="light" />
      {/* THE timeline, scoped to this grid's cameras — and the wall inside it.
          The wall is its child rather than its sibling because the timeline
          hosts the picture in every layout (`stream-slot.ts`), which is what
          keeps a rotation from re-parenting and renegotiating the session.
          Without a timeline (a phone, in either orientation) the tree is
          exactly what it was. */}
      {showTimeline ? (
        <GridWallTimeline
          deviceIds={wallIds}
          wall={wall}
          title={title}
          onBack={goBack}
          layoutMode={timelineShape}
          railWidth={wideSizes.railWidth}
          wallStackHeight={gridWallStackHeight(seedBox.height)}
          chromeHidden={!timelineOn}
          // The control bar over the wall already owns Back on this page — the
          // same reason the wide theater hides it, arrived at from the other
          // side: there, the app sidebar navigates.
          hideBack
        />
      ) : (
        wall
      )}

      {/* The ONE cell panel over the wall — PTZ, the camera's linked devices,
          its view-options menu, or the compact list. Every body is a component
          the single-camera view already owns; nothing is mounted until a tile
          asks (an N-tile wall must not carry N menus). */}
      <GridCellPanelOverlay
        panel={cellPanel}
        cameraName={panelCamera?.name ?? ''}
        hasPtz={panelCamera !== null && ptzIds.includes(panelCamera.id)}
        onSelect={(kind) => {
          if (cellPanel) openCellPanel(kind, cellPanel.deviceId)
        }}
        onClose={dismissPanels}
      />

      {/* Only over a wall that is drawn: the empty / loading states carry their
          own BackChip. Exits exactly like the control bar's back. */}
      {wallCameras.length > 0 ? <GridWallBackButton onBack={goBack} touches={touches} /> : null}

      {/* Share-builder dialog — mints a scoped view token and copies the
          standalone frozen-view link (seeded from the grid's persisted settings). */}
      <GridShareDialog grid={shareOpen && grid ? grid : null} local={gridLocal} onClose={dismissPanels} />
    </View>
  )
}

/** The back button of the non-wall states (no header there): the SAME glass
 *  button and position the header uses, floating over the page. */
function BackChip({ onPress }: { readonly onPress: () => void }) {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: insets.top + HEADER_PADDING_TOP, left: HEADER_PADDING_X }}
    >
      <HeaderBackButton onPress={onPress} />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING['2xl'],
  },
})
