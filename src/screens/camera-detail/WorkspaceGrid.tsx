/**
 * WorkspaceGrid — the view the operator built, drawn IN THE PICTURE'S PLACE.
 *
 * ## It is the wall that already exists, not a second one
 *
 * The operator settled this: the workspace extends THE GRID — one embed drawing
 * N cameras — rather than mounting N native players. So this file mounts the
 * same two components `GridViewScreen` mounts, behind the same platform split:
 * `GridLiveEmbed` on iOS/web (one `WKWebView`/iframe, N peers, one SPA boot) and
 * `GridWall` on Android. Nothing about the wall is reimplemented here; this is
 * the box it is put in and the props it is given.
 *
 * Two consequences of that choice, both load-bearing:
 *
 * - **Adding a camera does not remount anything.** `GridLiveEmbed` is not keyed
 *   on the device set — it pushes `setDevices` when the page announced the
 *   command — and inside the page `GridWallSurface` holds every tile as an
 *   absolutely-positioned sibling of one parent, keyed by device id. A camera
 *   that stays on the wall keeps its `<video>` and its peer.
 * - **The host's session registry never sees this wall.** N `LiveView`s here
 *   would take it from two sessions to N; one WebView keeps it at two.
 *
 * ## The route camera is `devices[0]`, and it is a CELL (2026-09-02)
 *
 * The wall used to be drawn under the picture and to exclude the camera the
 * screen was routed to. It no longer does: the operator asked for the single
 * view to be REPLACED by the grid, accepting the one renegotiation that costs
 * ("Non fa niente se riconnette"). The head of `devices` is therefore the
 * PRIMARY — `workspaceOnScreenCameras` puts it there — and this file gives it
 * more of the wall than an even split would (see the span, below).
 *
 * ## Why the reflow is not animated
 *
 * Adding a third camera shrinks the other two. That reflow is NOT animated, and
 * the reason is that there is nothing here to animate: on iOS and web the cells
 * live inside the WebView, so React Native cannot touch them. Animating this
 * container instead would resize the WebView's viewport on every frame, and
 * each intermediate size makes the page re-run its own fit for every tile —
 * paying a full relayout per frame to smooth a change React Native is not the
 * one making. Whether the CELLS ease into their new rects is the page's
 * decision, in `embed/`, on the embed's own shipping chain; it is deliberately
 * not opened here.
 *
 * ## The primary's span, and the ONE measurement behind it
 *
 * `resolvePrimaryWallSpan` needs the wall's box, so the content box is measured
 * here — once, for both platform branches, because two `onLayout`s over the
 * same rectangle is how two surfaces end up disagreeing about it. The
 * measurement is stamped with the WINDOW it was taken in: an `onLayout` value
 * parked in `useState` outlives the shape it described (this route stays
 * mounted while another is pushed over it, `freezeOnBlur: false`), so a stale
 * box can survive a rotation and size the wall to a window that is gone.
 *
 * The plan's COLUMN COUNT is pinned onto the wall (`layout={cols}`) rather than
 * left at `'auto'`. The page packs spans into the column count ITS box implies,
 * and the host's box and the page's viewport are not the same rectangle — a
 * span computed against three columns and packed into two leaves a hole beside
 * live video. Pinning removes the disagreement instead of hoping it is small.
 *
 * An arrangement the OPERATOR made (a resize grip) always wins: the automatic
 * span is what the wall does until they say otherwise, never something that
 * overwrites what they said.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Pressable,
  StyleSheet,
  Platform,
  type LayoutChangeEvent,
} from 'react-native'
import { useViewportSize } from '../../hooks/use-viewport-size.js'
import { useTranslation } from 'react-i18next'

import { X } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS, type ColorTokens } from '../../theme/tokens.js'
import { FEATURE, useCameras, type CameraInfo } from '../../data/use-cameras.js'
import { useCanActuate } from '../../hooks/use-user-scope.js'
import { GridLiveEmbed } from '../../grid-embed/GridLiveEmbed.js'
import { GridWall } from '../../components/grid/GridWall.js'
import { computeGridLayout, resolvePrimaryWallSpan } from '../../grid/auto-layout.js'
import type { OverlayLayer } from '../../components/camera/overlay/overlay-config.js'
import type { GridCellPanelKind } from '../../grid/cell-controls.js'
import type { GridCellSpan } from '../../grid-embed/embed-messages.js'
import {
  buildTileOverlayMap,
  type GridHighlightEmbedConfig,
  type TileOverlayEmbedConfig,
} from '../../grid-embed/embed-config.js'
import { OVERLAY_DEFAULTS } from '../../components/camera/overlay/overlay-config.js'
import { useCameraPrefsStore } from '../../store/camera-prefs-store.js'
import { useDeviceSettingsStore } from '../../store/device-settings-store.js'
import type { GridLayout } from '../../store/grid-store.js'
import type { StreamQuality } from '../../store/settings-store.js'

/** Marker for the wall's root — the mount specs assert its presence and, for
 *  the claim that matters, the IDENTITY of the surface inside it across a
 *  device-set change. */
export const WORKSPACE_GRID_TEST_ID = 'workspace-grid'
/** The row under the cells that hosts the docked control bar. */
export const WORKSPACE_GRID_FOOTER_TEST_ID = 'workspace-grid-footer'

/**
 * The same split `GridViewScreen` makes, for the same reason: on iOS and web
 * the wall is one embedded page (N peers, one SPA boot); on Android it is
 * native tiles. Read per render rather than frozen at module load, because the
 * mount harness picks the platform branch per spec.
 */
function useEmbeddedWall(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'web'
}

/** Stable empty arrays — a fresh literal in a prop would give the wall a new
 *  identity every render, which is exactly what this surface exists not to do. */
const NO_IDS: readonly number[] = []

/** A box that has been measured, and the window it was measured in. */
interface WallBox {
  readonly w: number
  readonly h: number
  readonly stamp: string
}

export interface WorkspaceGridProps {
  /** The cameras on the wall, in order, PICTURE FIRST
   *  (`workspaceOnScreenCameras`). The head is the primary. */
  readonly devices: readonly number[]
  /**
   * The stream tier for every camera on the wall.
   *
   * Wall-wide, because the embed takes one tier and the wall is one page. The
   * timeline's quality chip states it — see the screen for why that control is
   * scoped to the wall rather than hidden.
   */
  readonly quality: StreamQuality
  /** The highlight border config, wall-wide. The primary's document states it:
   *  it is the only camera whose preferences this screen owns. */
  readonly highlight?: GridHighlightEmbedConfig
  /**
   * The box layers on every tile — the bar's layer chips, or the primary's
   * `objects` layer until the bar is touched (`workspace-wall-options.ts`).
   * The embed draws the `objects` layer only; the Android wall draws them all.
   * Before the Android branch received this it accepted a box switch and threw
   * it away, so the toggle said on and drew nothing.
   */
  readonly layers: readonly OverlayLayer[]
  /**
   * The bar's layout pick. `'auto'` is the wall's own split — the primary
   * enlarged; a number is the operator asking for that many even columns, so
   * the automatic primary span stands aside (a span planned for one column
   * count and packed into another leaves a hole beside live video).
   */
  readonly layoutChoice: GridLayout
  /** The bar's active-only filter. */
  readonly activeOnly: boolean
  /** A cell asked to become the picture — `router.replace('/camera/<id>')`,
   *  the same call the shelf's `goTo` makes. The camera does not leave the
   *  wall; it moves to the head of it and becomes the primary. */
  readonly onGoTo: (deviceId: number) => void
  /** A cell asked for one of the screen's per-camera panels — answered by the
   *  same `GridCellPanelOverlay` the shelf's bar already reaches. */
  readonly onCellPanel: (kind: GridCellPanelKind, deviceId: number) => void
  /** Close the view: the wall goes back to being the single picture. */
  readonly onClose: () => void
  /** A cell asked to leave the wall. The one per-cell verb that removes
   *  anything: `onGoTo` promotes a camera and `onClose` empties the whole view,
   *  so without this there is no way to say "this one no, the others yes". */
  readonly onRemove: (deviceId: number) => void
  /** A cell's resize grip: this camera should be `cw × ch` TRACKS. */
  readonly onResize: (deviceId: number, cw: number, ch: number) => void
  /** The OPERATOR's arrangement, keyed by device id as a STRING — the shape the
   *  wire uses. Empty means they have arranged nothing, and the wall then
   *  chooses the primary's span itself. */
  readonly spans: Readonly<Record<string, GridCellSpan>>
  /**
   * The cells the operator is LISTENING to, and the ones held/paused.
   *
   * These were `NO_IDS` with no handlers, and that was not a policy — the
   * embed's tile draws the listen disc and the pause disc unconditionally
   * (`GridTilePlayer` gates them on overlay visibility and nothing else) and
   * posts on every press, so the wall shipped two dead controls per cell and a
   * speaker icon permanently stuck off. Owned by {@link WorkspaceStage} for the
   * session, never persisted — a view is not a saved grid.
   */
  readonly audioOnIds: readonly number[]
  readonly pausedIds: readonly number[]
  readonly onAudioToggle: (deviceId: number) => void
  readonly onPauseToggle: (deviceId: number) => void
  /**
   * Drawn over the CELLS (not the footer) — the layer that swallows a tap on
   * the wall while a bar popover is open (`GridTapDismiss`), exactly as the
   * grid page stacks it: above the picture, below the bar.
   */
  readonly cellsOverlay?: React.ReactNode
  /**
   * A row of its own UNDER the cells, inside the wall's frame — the docked
   * control bar. It takes height from the cells rather than floating over
   * them, so no live picture is ever covered by it; the measured box below is
   * what is left, and the cells are fit to that.
   */
  readonly footer?: React.ReactNode
}

export function WorkspaceGrid({
  devices,
  quality,
  highlight,
  layers,
  layoutChoice,
  activeOnly,
  onGoTo,
  onCellPanel,
  onClose,
  onRemove,
  onResize,
  spans,
  audioOnIds,
  pausedIds,
  onAudioToggle,
  onPauseToggle,
  cellsOverlay,
  footer,
}: WorkspaceGridProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { data: cameras } = useCameras()
  const canActuate = useCanActuate()
  const embedded = useEmbeddedWall()

  const wallCameras = useMemo<readonly CameraInfo[]>(() => {
    const known = new Map((cameras ?? []).map((c) => [c.id, c]))
    return devices.flatMap((id) => {
      const camera = known.get(id)
      return camera === undefined ? [] : [camera]
    })
  }, [cameras, devices])

  const ptzIds = useMemo(
    () =>
      canActuate ? wallCameras.filter((c) => c.features.includes(FEATURE.ptz)).map((c) => c.id) : NO_IDS,
    [canActuate, wallCameras],
  )

  const wallDeviceIds = useMemo(() => wallCameras.map((c) => c.id), [wallCameras])

  // Per-camera indicators (motion regions, motion pill, audio meter, occupancy,
  // stats). The native tile reads each camera's prefs itself; the EMBED cannot
  // — it is a separate bundle behind a WebView — so the host resolves the map
  // and pushes it. Without this every per-camera view-options menu the wall
  // offers, the PRIMARY's included, would edit a document nothing paints.
  const prefsById = useCameraPrefsStore((s) => s.prefs.byId)
  const hydratePrefs = useCameraPrefsStore((s) => s.hydrate)
  // Device-local: how big the wall's indicators are drawn on THIS screen.
  const overlaySize = useDeviceSettingsStore((s) => s.settings.overlaySize)
  useEffect(() => {
    void hydratePrefs()
  }, [hydratePrefs])
  const overlays = useMemo<Readonly<Record<string, TileOverlayEmbedConfig>>>(
    () =>
      buildTileOverlayMap(
        wallDeviceIds.map((id) => ({ deviceId: id, overlay: prefsById[id]?.overlay ?? OVERLAY_DEFAULTS })),
        overlaySize,
      ),
    [wallDeviceIds, prefsById, overlaySize],
  )

  // ONE measurement of the content box, for both branches. See the docblock for
  // why it expires with the window rather than latching.
  const { width: winWidth, height: winHeight } = useViewportSize()
  const stamp = `${winWidth}x${winHeight}`
  const [rawBox, setRawBox] = useState<WallBox | null>(null)
  const onLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      const { width, height } = event.nativeEvent.layout
      if (width <= 0 || height <= 0) return
      setRawBox((prev) =>
        prev !== null && prev.w === width && prev.h === height && prev.stamp === stamp
          ? prev
          : { w: width, h: height, stamp },
      )
    },
    [stamp],
  )
  const box = rawBox !== null && rawBox.stamp === stamp ? rawBox : null

  // The operator's own arrangement, if they made one. `resizeMember` stores the
  // default as ABSENCE, so any entry at all is a size they chose.
  const operatorArranged = Object.keys(spans).length > 0

  const columnsPicked = layoutChoice !== 'auto'
  const plan = useMemo(
    () =>
      operatorArranged || columnsPicked || box === null
        ? null
        : resolvePrimaryWallSpan(wallDeviceIds.length, box.w, box.h),
    [operatorArranged, columnsPicked, box, wallDeviceIds.length],
  )
  const primaryId = wallDeviceIds[0]
  const effectiveSpans = useMemo<Readonly<Record<string, GridCellSpan>>>(() => {
    if (plan === null || plan.span <= 1 || primaryId === undefined) return spans
    return { [String(primaryId)]: { cw: plan.span, ch: plan.span } }
  }, [plan, primaryId, spans])
  // Pinned only when a span rides on it — otherwise the page keeps deciding its
  // own split from its own box, which is what it does best. A column count the
  // operator picked on the bar is passed straight through.
  const layout: GridLayout = plan !== null && plan.span > 1 ? plan.cols : layoutChoice
  const showBoxes = layers.includes('objects')

  return (
    <View testID={WORKSPACE_GRID_TEST_ID} style={styles.root}>
      <View style={styles.content} onLayout={onLayout}>
        {embedded ? (
          <GridLiveEmbed
            devices={wallDeviceIds}
            quality={quality}
            layout={layout}
            showName
            audioOnIds={audioOnIds}
            pausedIds={pausedIds}
            onAudioToggle={onAudioToggle}
            onPauseToggle={onPauseToggle}
            ptzIds={ptzIds}
            highlight={highlight}
            showBoxes={showBoxes}
            activeOnly={activeOnly}
            overlays={overlays}
            onTileOpen={onGoTo}
            onPtzOpen={(id) => onCellPanel('ptz', id)}
            onCellPanelOpen={onCellPanel}
            // This wall IS the operator's view, so its cells carry the two verbs
            // a saved grid's cells must not: leave the wall, and change size.
            editable
            spans={effectiveSpans}
            onTileRemove={onRemove}
            onTileResize={onResize}
          />
        ) : (
          <NativeWorkspaceWall
            cameras={wallCameras}
            quality={quality}
            ptzIds={ptzIds}
            layers={layers}
            layout={layoutChoice}
            audioOnIds={audioOnIds}
            pausedIds={pausedIds}
            box={box}
            onCellPanel={onCellPanel}
          />
        )}
        {cellsOverlay}
      </View>

      {footer !== undefined ? (
        <View testID={WORKSPACE_GRID_FOOTER_TEST_ID} style={styles.footer}>
          {footer}
        </View>
      ) : null}

      {/* Closing the whole view. The per-cell remove now lives in the cells
          themselves (the embed page draws it and posts `tileRemove`), so this
          is no longer the only way out of the wall — it is the one that empties
          it in a single step, returning the screen to the single picture. It
          floats over the wall's black border rather than taking a header row:
          every point it does not occupy is a point of live picture. */}
      <Pressable
        onPress={onClose}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('v2.cameraShelf.closeView')}
        style={({ pressed }) => [styles.close, { opacity: pressed ? 0.7 : 1 }]}
      >
        <X size={16} color="#fafaf9" />
      </Pressable>
    </View>
  )
}

export interface NativeWorkspaceWallProps {
  readonly cameras: readonly CameraInfo[]
  readonly quality: StreamQuality
  readonly ptzIds: readonly number[]
  /** The wall-wide box layers (see `WorkspaceGridProps.layers`). */
  readonly layers: readonly OverlayLayer[]
  /** The bar's column pick; absent ⇒ `'auto'`. */
  readonly layout?: GridLayout
  /** The per-cell sets, COLLAPSED: `GridWall` has no per-tile transport, only
   *  one `muted` and one `paused` for the whole wall — the same shape the grid
   *  page gives it. iOS/web keep the per-cell answer through the embed. */
  readonly audioOnIds: readonly number[]
  readonly pausedIds: readonly number[]
  /** The measured content box, or null until it has been. */
  readonly box: WallBox | null
  readonly onCellPanel: (kind: GridCellPanelKind, deviceId: number) => void
}

/**
 * The Android branch. `GridWall` is a pure layout shell — the sizing decision is
 * the caller's — so it is handed the box the parent measured.
 *
 * It draws the EVEN wall, always. `GridWall` lays cells out row by row from an
 * `AutoLayout` and has no notion of a track grid, so the primary's span is an
 * iOS/web answer; an Android tablet gets every camera the same size, with the
 * primary simply first. That is a smaller wall for the primary, never a broken
 * one — and it is stated here rather than left to be discovered.
 */
export function NativeWorkspaceWall({
  cameras,
  quality,
  ptzIds,
  layers,
  layout: layoutChoice = 'auto',
  audioOnIds,
  pausedIds,
  box,
  onCellPanel,
}: NativeWorkspaceWallProps): React.JSX.Element {
  const layout = useMemo(
    () => (box === null ? null : computeGridLayout(cameras.length, box.w, box.h, layoutChoice)),
    [cameras.length, box, layoutChoice],
  )

  return (
    <View style={styles.nativeBox}>
      {layout !== null && layout.cellW > 0 ? (
        <GridWall
          cameras={cameras}
          layout={layout}
          showName
          quality={quality}
          ptzIds={ptzIds}
          layers={layers}
          muted={audioOnIds.length === 0}
          paused={pausedIds.length > 0}
          onCellPanelOpen={onCellPanel}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  nativeBox: { flex: 1, minHeight: 0, backgroundColor: '#000' },
})

function makeStyles(colors: ColorTokens) {
  return StyleSheet.create({
    root: {
      flex: 1,
      minHeight: 0,
      alignSelf: 'stretch',
      borderRadius: RADIUS.md,
      overflow: 'hidden',
      backgroundColor: '#000',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    /** The measured box. It is the wall's own rectangle — inside the border, so
     *  the number handed to `resolvePrimaryWallSpan` is the one the cells
     *  actually get, and the number the embed is `fit()` to. */
    content: { flex: 1, minHeight: 0 },
    /** The bar's row: centred, on the wall's own black, never over a cell. */
    footer: {
      alignItems: 'center',
      paddingVertical: SPACING.xs,
      paddingHorizontal: SPACING.xs,
    },
    close: {
      position: 'absolute',
      top: SPACING.xs,
      right: SPACING.xs,
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
  })
}
