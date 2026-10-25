/**
 * GridTile — one camera cell in the live grid wall.
 *
 * Renders the live `<LiveView>` at a fixed cell size and, when enabled, a
 * gradient-free name/status overlay pinned to the bottom (online dot + name),
 * mirroring V1's CameraCard footer but composited ON the video (the wall is
 * dense, so a separate footer row would steal tile area). Memoized so a sibling
 * reorder / re-render does not tear down this tile's WebRTC peer connection —
 * the `deviceId`/size are the only deps that should restart anything.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, StyleSheet, Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Pause } from '../../lib/icons.js'
import { statsPanelFits, type GridCellPanelKind } from '../../grid/cell-controls.js'
import {
  cameraActionBarForCell,
  isCameraPanelAction,
} from '../../grid/camera-action-bar.js'
import { CameraActionBar } from '../camera/CameraActionBar.js'
import { hapticTap } from '../../lib/haptics.js'
import { useTheme } from '../../theme/theme-provider.js'
import { LiveView } from '../../live/LiveView.js'
import type { LiveViewHandle } from '../../live/live-view-types.js'
import { MotionBoxesOverlay } from '../camera/MotionBoxesOverlay.js'
import { StationaryBoxesOverlay } from '../camera/StationaryBoxesOverlay.js'
import { DiscardedBoxesOverlay } from '../camera/DiscardedBoxesOverlay.js'
import { MotionRegionsOverlay } from '../camera/MotionRegionsOverlay.js'
import { AudioLevelMeter } from '../camera/AudioLevelMeter.js'
import { OccupancyBadge } from '../camera/OccupancyBadge.js'
import { StreamStatsOverlay } from '../camera/StreamStatsOverlay.js'
import { LiveViewersBadge } from '../camera/LiveViewersBadge.js'
import { OverlayFrame } from '../camera/overlay/OverlayFrame.js'
import { useCameraOverlay } from '../../hooks/use-camera-view-options.js'
import { qualityToTarget } from '../../live/quality-target.js'
import { useSnapshot } from '../../data/use-snapshot.js'
import { SnapshotImage } from '../camera/SnapshotImage.js'
import { snapshotWidthForCssPx } from '../../hooks/use-responsive.js'
import { useMotionHighlight } from '../../data/use-motion.js'
import { useSettings } from '../../data/use-settings.js'
import { useSwitchedOffFor } from '../../data/CameraSwitchedOffProvider.js'
import { SwitchedOffBadge } from '../camera/SwitchedOffBadge.js'
import { SPACING } from '../../theme/tokens.js'
import { FEATURE, type CameraInfo } from '../../data/use-cameras.js'
import {
  resolveLivePaused,
  isBatteryHold,
  type LiveStreamGateInput,
} from '../../live/battery-stream-gate.js'
import { BatteryHoldOverlay } from '../camera/BatteryHoldOverlay.js'
import type { GridQuality } from '../../store/grid-store.js'
import { hasLayer, type OverlayLayer } from '../camera/overlay/overlay-config.js'

/** Stable empty default — see `GridWall`. */
const EMPTY_LAYERS: readonly OverlayLayer[] = []

interface GridTileProps {
  readonly camera: CameraInfo
  readonly width: number
  readonly height: number
  /** Overlay the camera name + status dot on the video. */
  readonly showName: boolean
  /** Stream-quality hint → the tile's WebRTC target. */
  readonly quality: GridQuality
  /** Mute the tile's remote audio (grid-wide control). Defaults muted. */
  readonly muted?: boolean
  /** When true the live peer is torn down and the last snapshot is shown — the
   *  grid-wide "pause all" that frees CPU/bandwidth. */
  readonly paused?: boolean
  /** The WALL's box-overlay layers — the same checkable set the camera-detail
   *  view uses, minus `motion` (that one is per camera and comes off this
   *  camera's own document below). Each layer mounts its own drawing component,
   *  so asking for the parked objects alone draws exactly those. */
  readonly layers?: readonly OverlayLayer[]
  /** A tap on the tile reveals the SECONDARY cell actions — the camera's
   *  linked devices and its view-options menu, both hosted by the screen (the
   *  same components the single-camera view mounts). Omitted → no chrome, no
   *  tap handling, exactly the tile as it was. */
  readonly onCellPanel?: (kind: GridCellPanelKind, deviceId: number) => void
  /** This camera can pan/tilt/zoom → the revealed row leads with a PTZ button
   *  (on a compact cell it is offered by the host's list instead, exactly as
   *  on the embed wall). */
  readonly hasPtz?: boolean
}

/** Ms the revealed cell actions stay up (matches the embed tile's overlay). */
const ACTIONS_HIDE_MS = 3500

/** A single live grid cell. Pure-ish: re-renders only when its props change. */
export const GridTile = React.memo(function GridTile({
  camera,
  width,
  height,
  showName,
  quality,
  muted = true,
  paused = false,
  layers = EMPTY_LAYERS,
  onCellPanel,
  hasPtz = false,
}: GridTileProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const { settings } = useSettings()
  // Which of this camera's functions an operator switched OFF (D62). The wall's
  // dot only separates online from offline; without this a tile whose detection
  // was deliberately turned off is pixel-identical to one whose detector died.
  const switchedOff = useSwitchedOffFor(camera.id)
  // A battery camera on the wall gets the SAME protection as the single-camera
  // player: opening a grid never wakes it. `paused` above is the wall-wide
  // operator toggle; this is per-tile, and the two compose — the wall can pause
  // a battery tile the operator already started, and un-pausing the wall does
  // not silently start one they never asked for.
  //
  // `cameraKnown: true` — a tile is only ever rendered FROM the camera list, so
  // by construction this camera's features are the ones the hub reported (the
  // cold-start ambiguity the detail screen guards against cannot arise here).
  const [tilePlayChoice, setTilePlayChoice] = useState<boolean | null>(null)
  const tileGate: LiveStreamGateInput = {
    operatorChoice: tilePlayChoice,
    cameraKnown: true,
    batteryPowered: camera.features.includes(FEATURE.battery),
  }
  const batteryHold = isBatteryHold(tileGate)
  const effectivePaused = paused || resolveLivePaused(tileGate)
  const onStartBatteryTile = useCallback(() => setTilePlayChoice(false), [])
  // Stable target reference (keyed on `quality`) so the memoized tile does not
  // restart its WebRTC peer on unrelated re-renders.
  const target = useMemo(() => qualityToTarget(quality), [quality])
  // When paused we render the last snapshot instead of the live peer; only fetch
  // while paused so we never poll — or wake a battery cam — live. Whether the
  // camera is up is NOT part of that question: the hub has a tile for every
  // camera state and paints the state into it (D190), and a tile that skipped
  // an offline camera was the same blank box the Cameras page used to show.
  // The tile already KNOWS its pixel size — `width` is the computed cell width
  // from the wall's auto-layout. It was still asking for the full 4K capture.
  const snapshot = useSnapshot(camera.id, effectivePaused, snapshotWidthForCssPx(width))
  // Live motion highlight (border/glow) — the SAME lingered source the card /
  // detail use. This is what opens the motion event subscription for the tile
  // (the native wall previously had none). Only while live + online (a paused or
  // offline tile shows no motion). iOS/web render the server embed which draws
  // its own highlight, so this native border only paints on the native wall.
  const motionOn = useMotionHighlight(camera.id, !effectivePaused && camera.online)

  /**
   * This camera's OWN overlay document — the per-camera half of the wall.
   *
   * The grid bar owns what is wall-wide (the box scale, the highlight border);
   * everything else in the cell's view-options menu is per camera, and the menu
   * may only offer what something DRAWS. That something is here. Each indicator
   * subscribes ONLY while the operator placed it (`!== 'off'`), so a wall of
   * nine tiles with no indicators opens no audio subscription, no occupancy
   * poll and no stats timer — the cost is paid per placed indicator, not per
   * tile. Live only: a paused or offline tile shows a snapshot, and an
   * indicator over a frozen frame describes a moment that has passed.
   */
  const overlay = useCameraOverlay(camera.id)
  const live = !effectivePaused && camera.online
  const liveRef = useRef<LiveViewHandle | null>(null)
  const getStats = useCallback(
    () => liveRef.current?.getStats() ?? Promise.resolve(null),
    [],
  )

  // Secondary cell actions, revealed by a tap (the wall is dense — permanent
  // chrome would cover the picture on every tile at once) and auto-hidden.
  // A cell too small to carry both buttons draws ONE "more" that opens them as
  // a list; the rule is the pure, unit-tested `resolveCellControls`.
  const [actionsOn, setActionsOn] = useState(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const arm = useCallback((): void => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setActionsOn(false), ACTIONS_HIDE_MS)
  }, [])
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
    },
    [],
  )
  const toggleActions = useCallback((): void => {
    hapticTap()
    setActionsOn((on) => {
      if (!on) arm()
      return !on
    })
  }, [arm])
  const openPanel = useCallback(
    (kind: GridCellPanelKind): void => {
      // Every `TileActionButton` press (PTZ, inline, overflow) lands here — the
      // ONE place the cell-panel openings are felt, so the atom stays silent
      // and a single press never buzzes twice.
      hapticTap()
      arm()
      onCellPanel?.(kind, camera.id)
    },
    [arm, onCellPanel, camera.id],
  )
  // WHICH controls this cell offers is `camera-action-bar.ts`; how big the
  // cell is, is still `cell-controls.ts`. One list, two surfaces.
  const barItems = useMemo(
    () => cameraActionBarForCell(width, height, hasPtz),
    [width, height, hasPtz],
  )

  return (
    <View style={[styles.cell, { width, height }]}>
      {effectivePaused ? (
        <View style={styles.pausedFill}>
          <SnapshotImage source={snapshot} deviceId={camera.id} style={styles.pausedFill} />
          {/* An operator pause keeps its glyph. The battery hold does NOT get
              one — it was never started, so a Pause badge would describe the
              wrong event — and its play disc is drawn LAST instead, see below. */}
          {batteryHold ? null : (
            <View style={styles.pauseBadge} pointerEvents="none">
              <Pause size={18} color="#fafaf9" fill="#fafaf9" />
            </View>
          )}
        </View>
      ) : (
        <LiveView ref={liveRef} deviceId={camera.id} target={target} muted={muted} />
      )}
      {layers.includes('objects') && !effectivePaused ? (
        <MotionBoxesOverlay deviceId={camera.id} enabled />
      ) : null}
      {layers.includes('discarded') && !effectivePaused ? (
        <DiscardedBoxesOverlay deviceId={camera.id} enabled />
      ) : null}
      {/* The parked objects, on a gate of their OWN — they used to be drawn
          inside `MotionBoxesOverlay`, so the only way to see a parked car was
          to turn the live detections on. */}
      {layers.includes('stationary') && !effectivePaused ? (
        <StationaryBoxesOverlay deviceId={camera.id} enabled />
      ) : null}

      {/* ── The PER-CAMERA indicators, exactly as the cell's view-options menu
          offers them. Everything below is mounted only when this camera placed
          it, so the subscription/poll it opens is the one the operator asked
          for. */}
      {hasLayer(overlay, 'motion') && live ? (
        <MotionRegionsOverlay deviceId={camera.id} enabled />
      ) : null}
      {/* The read-outs, laid over the picture's own rectangle (a spanned cell
          letterboxes it) at the device's overlay size. */}
      <OverlayFrame fit="contain">
        {overlay.audioMeter !== 'off' && live ? (
          // No `onSetPosition`: on a tile the meter is a read-out, and a picker
          // opening over a 200pt cell would swallow the tap that reveals the
          // tile's own controls.
          <AudioLevelMeter deviceId={camera.id} position={overlay.audioMeter} />
        ) : null}
        {overlay.occupancy !== 'off' ? (
          <OccupancyBadge deviceId={camera.id} enabled={live} corner={overlay.occupancy} />
        ) : null}
        {overlay.stats !== 'off' && live ? (
          // The full panel is 150-220pt wide: on a smaller cell it would cover
          // the picture it describes, so the read-out shrinks to one line rather
          // than disappearing.
          <StreamStatsOverlay
            getStats={getStats}
            position={overlay.stats}
            compact={!statsPanelFits(width, height)}
          />
        ) : null}
        <LiveViewersBadge deviceId={camera.id} position={overlay.viewers} enabled={live} />
      </OverlayFrame>
      {/* Motion highlight — a colored border/glow around the tile while motion is
          active (and for the configured linger after). Non-interactive; painted
          over the video edge-to-edge. Color/thickness from the global highlight
          appearance so it matches the embed + detail borders. */}
      {motionOn ? (
        <View
          pointerEvents="none"
          style={[
            styles.motionBorder,
            {
              borderWidth: settings.highlight.thickness,
              borderColor: settings.highlight.motionColor,
              shadowColor: settings.highlight.motionColor,
            },
          ]}
        />
      ) : null}
      {/* Tap-to-reveal cell actions. The Pressable covers the tile BELOW the
          buttons, so a tap anywhere toggles them and a tap on a button runs
          it. Mounted only when the screen offers the panels. */}
      {onCellPanel ? (
        <>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={toggleActions}
            accessibilityRole="button"
            accessibilityLabel={t('v2.gridView.cellActionsA11y')}
          />
          {actionsOn ? (
            /* The bar itself is shared with the tablet snapshot shelf — the
               tile owns only WHERE it sits and that it is revealed by a tap.
               See `grid/camera-action-bar.ts`. */
            <View style={styles.actions} pointerEvents="box-none">
              <CameraActionBar
                items={barItems}
                onAction={(kind) => {
                  if (isCameraPanelAction(kind)) openPanel(kind)
                }}
                variant="overlay"
              />
            </View>
          ) : null}
        </>
      ) : null}
      {showName ? (
        <View style={styles.overlay} pointerEvents="none">
          <View
            style={[
              styles.dot,
              { backgroundColor: camera.online ? colors.success : colors.foregroundDisabled },
            ]}
          />
          <Text style={styles.name} numberOfLines={1}>
            {camera.name}
          </Text>
          <SwitchedOffBadge
            switchedOff={switchedOff}
            accessibilityLabel={t('v2.cameraSwitches.badgeLabel', { count: switchedOff.length })}
          />
        </View>
      ) : null}
      {/* LAST in the cell, on purpose. The tap-to-reveal Pressable above covers
          the whole tile with `absoluteFill`, so a play disc drawn earlier is
          visible and untouchable — the operator presses it, the cell actions
          appear instead, and the camera never starts. Drawn here it wins the
          touch, and `box-none` on its backdrop leaves the reveal gesture
          working everywhere else in the cell. */}
      {batteryHold ? <BatteryHoldOverlay onStart={onStartBatteryTile} compact /> : null}
    </View>
  )
})

const styles = StyleSheet.create({
  // No padding → the video fills the cell edge-to-edge so adjacent tiles touch
  // (the "video wall" look). The wall backdrop is pure black behind the tiles.
  cell: {
    backgroundColor: '#000',
  },
  pausedFill: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseBadge: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0009',
  },
  // Edge-to-edge motion border + a soft glow (elevation on Android). Absolute
  // fill so it hugs the tile without shifting the video layout.
  motionBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 8,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    // Translucent scrim so the label stays legible over any frame. Flush to the
    // tile edges (no radius) to keep the wall seamless.
    backgroundColor: '#0009',
  },
  /** Placement only — the bar itself is `CameraActionBar` (overlay variant). */
  actions: {
    position: 'absolute',
    left: SPACING.sm,
    // Above the name strip when it is drawn (it is flush to the bottom edge).
    bottom: SPACING.xl,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { flex: 1, color: '#fafaf9', fontSize: 12, fontWeight: '600' },
})
