/**
 * Source guards for the two grid properties this repo has no renderer to test:
 * WHO offers an overlay, and WHERE the black pixels go.
 *
 *  1. ONE MENU PER OVERLAY. The grid's control bar and a cell's view-options
 *     menu both offered the highlight border, its triggers, the box scale and
 *     the cluster label — the bar against the GRID's document, the cell against
 *     the CAMERA's prefs. The cell now hides them, and neither side decides
 *     which rows those are: `grid/view-options-scope` does. A host that answers
 *     the question locally (`context === 'grid-cell' ? …`) is the divergence
 *     starting again, one file at a time.
 *  2. THE BLOCK IS CENTRED, NOT WRAPPED. Both walls (native and embed) lay out
 *     the contiguous block the layout publishes. A `flexWrap` container hands
 *     its leftover cross-axis space to its LINES, which is precisely how two
 *     portrait cameras ended up with the biggest black band between them.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const SURFACE = join(SRC, 'components', 'camera', 'CameraViewOptionsSurface.tsx')
const SECTIONS = join(SRC, 'components', 'camera', 'theater', 'TimelineOverlayPanel.tsx')
const THEATER_PANEL = join(SRC, 'components', 'camera', 'theater', 'TimelineViewOptionsPanel.tsx')
const CELL_OVERLAY = join(SRC, 'components', 'grid', 'GridCellPanelOverlay.tsx')
const BAR_MENU = join(SRC, 'components', 'grid', 'GridMenuPanel.tsx')
const WALL = join(SRC, 'components', 'grid', 'GridWall.tsx')
const TILE = join(SRC, 'components', 'grid', 'GridTile.tsx')
const SCREEN = join(SRC, 'screens', 'GridViewScreen.tsx')
const HOST_EMBED = join(SRC, 'grid-embed', 'GridLiveEmbed.tsx')
const EMBED_PAGE = join(process.cwd(), 'embed', 'src', 'pages', 'EmbedGridPage.tsx')
const EMBED_TILE = join(process.cwd(), 'embed', 'src', 'components', 'GridTilePlayer.tsx')
const EMBED_CONFIG_SCHEMA = join(process.cwd(), 'embed', 'src', 'embed', 'embed-grid-config.ts')
const EMBED_WALL = join(process.cwd(), 'embed', 'src', 'components', 'GridWallSurface.tsx')
const EMBED_LAYOUT = join(process.cwd(), 'embed', 'src', 'embed', 'grid-layout.ts')

/** Strip block and line comments — a guard must police CODE, not the prose that
 *  explains what it forbids. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('one menu per overlay', () => {
  it('every host of the shared surface declares WHERE it is mounted', () => {
    expect(code(THEATER_PANEL)).toContain('context="single"')
    expect(code(CELL_OVERLAY)).toContain('context="grid-cell"')
  })

  it('the surface and its sections ask the shared list, not the context', () => {
    const surface = code(SURFACE)
    expect(surface).toContain("from '../../grid/view-options-scope.js'")
    expect(surface).toContain("isRowVisible('clusterLabel', context)")

    const sections = code(SECTIONS)
    expect(sections).toContain("from '../../../grid/view-options-scope.js'")
    expect(sections).toContain('isRowVisible(row, context)')
    // The rows themselves are gated by the predicate. A section that tested the
    // context itself would be a second opinion on what "common" means.
    expect(sections).not.toContain("=== 'grid-cell'")
  })

  it('the grid bar draws exactly the rows the list assigns to it', () => {
    const bar = code(BAR_MENU)
    expect(bar).toContain("from '../../grid/view-options-scope.js'")
    // Keyed by the derived union: promote a row to the bar and this file stops
    // compiling until it is drawn here.
    expect(bar).toContain('Readonly<Record<GridBarRow, React.JSX.Element>>')
    // …and it walks the shared GROUPS, so the bar wears the same headers as the
    // per-camera menu instead of inventing its own vocabulary.
    expect(bar).toContain('GRID_BAR_GROUPS.map(')
    expect(bar).toContain('barRowsInGroup(group).map(')
    expect(bar).toContain('GROUP_HEADER_KEY[group]')
  })

  it('the per-camera menu draws the same group headers', () => {
    // The operator's requirement: a row that is wall-wide in a grid did not
    // stop being a detection overlay, and one that is per-camera is still found
    // under the header it was learned under.
    const sections = code(SECTIONS)
    expect(sections).toContain('GROUP_HEADER_KEY.detection')
    expect(sections).toContain('GROUP_HEADER_KEY.liveIndicators')
    expect(sections).toContain('GROUP_HEADER_KEY.sensors')
    expect(code(SURFACE)).toContain('GROUP_HEADER_KEY.timeline')
    expect(code(SURFACE)).toContain('GROUP_HEADER_KEY.management')
  })

  it('the cell menu no longer draws the bar-owned rows itself', () => {
    // They are gone from the CELL by the gate above, not by a copy of the
    // surface: the overlay host must still mount the shared component.
    expect(code(CELL_OVERLAY)).toContain('CameraViewOptionsSurface')
    expect(code(CELL_OVERLAY)).not.toContain('HighlightTriggerRows')
  })
})

describe('what the cell menu offers, the TILE draws', () => {
  /**
   * The rule that replaced the hidden `unpainted` class. A row the per-camera
   * menu offers in a grid must be painted by BOTH walls — the native one and
   * the hosted embed — or the operator is turning on something invisible.
   */
  it('the native tile paints every per-camera indicator', () => {
    const tile = code(TILE)
    expect(tile).toContain('useCameraOverlay(camera.id)')
    expect(tile).toContain('<MotionRegionsOverlay')
    expect(tile).not.toContain('<MotionBadge')
    expect(tile).toContain('<AudioLevelMeter')
    expect(tile).toContain('<OccupancyBadge')
    expect(tile).toContain('<StreamStatsOverlay')
  })

  it('the native tile subscribes ONLY where the indicator was placed', () => {
    // A wall is N tiles; an unconditional mount would open N audio
    // subscriptions, N occupancy polls and N stats timers for chrome nobody
    // asked for.
    const tile = code(TILE)
    expect(tile).toContain("overlay.audioMeter !== 'off'")
    expect(tile).toContain("overlay.occupancy !== 'off'")
    expect(tile).toContain("hasLayer(overlay, 'motion') && live")
    expect(tile).toContain("overlay.stats !== 'off' && live")
  })

  it('the embed tile paints the same five, from the per-device config', () => {
    const tile = code(EMBED_TILE)
    expect(tile).toContain('<TileMotionRegionsOverlay')
    expect(tile).not.toContain('<TileMotionBadge')
    expect(tile).toContain('<TileAudioMeter')
    expect(tile).toContain('<TileOccupancy')
    expect(tile).toContain('<TileStats')
    expect(tile).toContain('overlay?.motionBoxes === true')
    expect(tile).toContain('overlay?.stats === true')
  })

  it('the protocol carries the per-device map, and the host pushes it', () => {
    expect(code(EMBED_CONFIG_SCHEMA)).toContain('overlays: z.record(z.string(), tileOverlaySchema)')
    expect(code(EMBED_PAGE)).toContain('overlay={overlays[String(deviceId)]}')
    expect(code(EMBED_PAGE)).toContain("case 'setOverlays':")
    const host = code(HOST_EMBED)
    expect(host).toContain("kind: 'setOverlays'")
    // Keyed by the SERIALISED map: the host rebuilds it every render, and an
    // identical map must not cross the bridge again.
    expect(host).toContain('const overlaysKey = JSON.stringify(overlays ?? {})')
    expect(code(SCREEN)).toContain('buildTileOverlayMap(')
  })
})

describe('the wall centres a contiguous block', () => {
  it('the native wall lays out rows of the published block', () => {
    const wall = code(WALL)
    expect(wall).toContain('splitIntoRows(cameras, layout.cols)')
    expect(wall).toContain('width: layout.wallW, height: layout.wallH')
    // The shape that put a band between the rows.
    expect(wall).not.toContain('flexWrap')
  })

  it('the screen hands the wall the whole layout, cells and block together', () => {
    expect(code(SCREEN)).toContain('layout={layout}')
  })

  it('the embed wall does the same, on its own bundle', () => {
    // The rows moved into `GridWallSurface` when the tiles became siblings of
    // one parent (a camera joining the wall must not re-parent the others), but
    // the block is still exactly its cells and still not a wrap container.
    const wall = code(EMBED_WALL)
    // The geometry moved once more, into `resolveWall`: a cell the operator
    // resized changes where every OTHER cell sits, so the surface takes the
    // wall already resolved instead of deriving it from a uniform cell size it
    // no longer has. The block is still exactly its cells, and still not a wrap
    // container.
    expect(wall).toContain('width: wall.wallW, height: wall.wallH')
    expect(wall).not.toContain('flexWrap')
    expect(wall).not.toContain('flex-wrap')
    // …and with no custom span `resolveWall` still DELEGATES to the flat
    // placement, which still derives its rows from the same helper the native
    // wall uses — so an unarranged wall and the native one cannot disagree.
    const layout = code(EMBED_LAYOUT)
    expect(layout).toContain('splitIntoRows(devices, grid.cols)')
    expect(layout).toContain('placements: computeTilePlacements(devices, grid)')
    expect(code(EMBED_PAGE)).toContain('<GridWallSurface')
  })
})
