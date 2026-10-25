/**
 * GridWall — the locked (non-reorder) auto-layout wall of live tiles.
 *
 * A CONTIGUOUS block of fixed cellW×cellH cells, centred in the content box.
 * The sizing decision is the caller's (`computeGridLayout`, 16:9
 * area-maximizing) and arrives whole, block included, so this component stays a
 * pure layout shell. Each cell is a memoized `GridTile` keyed by camera id
 * (stable key → no stream teardown on re-render).
 *
 * ## Rows, not `flexWrap`
 *
 * This was one wrap container spanning the whole content box. A wrap container
 * distributes leftover height over its LINES, which put a black band BETWEEN two
 * portrait cameras and half-bands at the edges — the operator's report. The wall
 * now renders `layout.wallW × layout.wallH` of explicit rows and centres THAT:
 * cells touch, and every leftover pixel is a border. Explicit rows also remove
 * the wrap boundary, which was a float comparison at paint time — a row of cells
 * a fraction wider than its block silently dropped its last cell to the next
 * line.
 */
import React, { useMemo } from 'react'
import { View, StyleSheet } from 'react-native'
import { GridTile } from './GridTile.js'
import { GridDeviceInfo } from './GridDeviceInfo.js'
import { CameraSwitchedOffProvider } from '../../data/CameraSwitchedOffProvider.js'
import type { CameraInfo } from '../../data/use-cameras.js'
import type { GridQuality } from '../../store/grid-store.js'
import type { OverlayLayer } from '../camera/overlay/overlay-config.js'
import type { GridCellPanelKind } from '../../grid/cell-controls.js'
import { splitIntoRows, type AutoLayout } from '../../grid/auto-layout.js'

/** Stable empty default — a fresh array literal in the signature would give
 *  every tile a new prop identity on each wall render. */
const EMPTY_LAYERS: readonly OverlayLayer[] = []

interface GridWallProps {
  readonly cameras: readonly CameraInfo[]
  /** The computed wall: cell size, column split AND the contiguous block to
   *  centre. One value so the cells and the block can never disagree. */
  readonly layout: AutoLayout
  readonly showName: boolean
  /** Stream-quality hint applied to every tile. */
  readonly quality: GridQuality
  /** Mute every tile's audio (grid-wide control). Defaults muted. */
  readonly muted?: boolean
  /** Pause every tile (tears down peers, shows snapshots). */
  readonly paused?: boolean
  /** Live detection bounding-box mode applied to every tile (session scale:
   *  off / survivors / everything the model saw). */
  readonly layers?: readonly OverlayLayer[]
  /** Device ids with PTZ — the tile leads its revealed row with a PTZ button
   *  (or, on a compact cell, the host's list does). */
  readonly ptzIds?: readonly number[]
  /** A tile asked for one of the screen's cell panels (linked devices, the
   *  shared view-options menu, or the compact list). */
  readonly onCellPanelOpen?: (kind: GridCellPanelKind, deviceId: number) => void
}

/** Renders the cameras as a centred, contiguous block of live tiles. */
export function GridWall({
  cameras,
  layout,
  showName,
  quality,
  muted = true,
  paused = false,
  layers = EMPTY_LAYERS,
  ptzIds,
  onCellPanelOpen,
}: GridWallProps) {
  // The wall knows its cameras, so the switched-off fan-out is mounted HERE
  // rather than in each of the two screens that render a wall — one provider,
  // one set of ids, and a tile that stays a leaf. Gated on the name overlay
  // because that is the only place the badge is drawn: a wall with the labels
  // hidden asks for nothing.
  const deviceIds = useMemo(() => cameras.map((c) => c.id), [cameras])
  const rows = useMemo(() => splitIntoRows(cameras, layout.cols), [cameras, layout.cols])
  return (
    <CameraSwitchedOffProvider deviceIds={deviceIds} enabled={showName}>
      <View style={styles.wrap}>
        <View style={[styles.block, { width: layout.wallW, height: layout.wallH }]}>
          {rows.map((row) => (
            // Keyed by the row's first camera: stable across re-renders, and it
            // changes only when the wall's composition does — an index key would
            // reuse the row that a removal shifted and tear down its peers.
            <View key={row[0]?.id ?? 'empty'} style={styles.row}>
              {row.map((camera) => (
                <GridTile
                  key={camera.id}
                  camera={camera}
                  width={layout.cellW}
                  height={layout.cellH}
                  showName={showName}
                  quality={quality}
                  muted={muted}
                  paused={paused}
                  layers={layers}
                  onCellPanel={onCellPanelOpen}
                  hasPtz={ptzIds?.includes(camera.id) ?? false}
                />
              ))}
            </View>
          ))}
          {/* One device-information pill for the whole wall — not per tile. */}
          <GridDeviceInfo />
        </View>
      </View>
    </CameraSwitchedOffProvider>
  )
}

const styles = StyleSheet.create({
  // The backdrop. Pure black (video-wall look) and the ONLY place leftover space
  // is allowed to live: it centres the block, so the black is a border.
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  // The block itself is exactly its cells (cols×cellW by rows×cellH) — no
  // justify/align space to distribute, so nothing can open a gap inside it.
  // `position: 'relative'` anchors the device-information overlay to the wall, not
  // the screen.
  block: { flexDirection: 'column', position: 'relative' },
  // A partial last row centres on its own within the block's width.
  row: { flexDirection: 'row', justifyContent: 'center' },
})
