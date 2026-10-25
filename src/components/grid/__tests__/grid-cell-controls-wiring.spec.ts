import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Source guards for the properties of the grid's cell controls that no
 * behavioural test in this repo can hold (there is no renderer here).
 *
 * What a future edit could silently undo:
 *
 *  1. REUSE. The linked-device actions and the view-options menu in a cell are
 *     the components the single-camera view already mounts. A grid-local copy
 *     of either would look identical on the day it is written and drift on the
 *     next edit — which is the whole reason the operator asked for one surface.
 *  2. ONE CONFIGURATION. Both hosts of the surface are driven by
 *     `useCameraViewOptions`. Sharing the COMPONENT but resolving the document
 *     twice is the failure this hook exists to prevent: a host that forgets to
 *     hydrate, or writes a replace where the other writes a patch, shows the
 *     same menu over different values.
 *  3. NOTHING PER CELL. A wall is N tiles. The panels are mounted by the SCREEN,
 *     once, behind `panel !== null` — a menu (and its linked-device query, its
 *     live-field catalogue, its cap reads) instantiated per tile is a jank
 *     source that no profiler run would forgive.
 *  4. THE TILE ASKS, THE HOST MOUNTS. The embed page cannot render the app's
 *     components; its tiles post an intent. A button added there that tries to
 *     render a panel itself would be a second, worse copy of the surface.
 */

const SRC = join(process.cwd(), 'src')
const OVERLAY = join(SRC, 'components', 'grid', 'GridCellPanelOverlay.tsx')
const TILE = join(SRC, 'components', 'grid', 'GridTile.tsx')
const SCREEN = join(SRC, 'screens', 'GridViewScreen.tsx')
const DETAIL = join(SRC, 'screens', 'CameraDetailScreen.tsx')
const SURFACE = join(SRC, 'components', 'camera', 'CameraViewOptionsSurface.tsx')
const THEATER_PANEL = join(SRC, 'components', 'camera', 'theater', 'TimelineViewOptionsPanel.tsx')
const EMBED_TILE = join(process.cwd(), 'embed', 'src', 'components', 'GridTilePlayer.tsx')

/** Strip block and line comments — a guard must police CODE, not prose that
 *  merely mentions the thing it forbids. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the cell panels REUSE the single-camera surfaces', () => {
  it('mounts the same accessory panel, PTZ pad and view-options surface', () => {
    const src = code(OVERLAY)
    expect(src).toContain("from '../camera/accessory-panel/CameraAccessoryPanel.js'")
    expect(src).toContain("from '../camera/PtzControls.js'")
    expect(src).toContain("from '../camera/CameraViewOptionsSurface.js'")
  })

  it('re-implements no accessory control of its own', () => {
    // The linked-device rows and their controls come from `CameraAccessoryPanel`
    // (which picks them from the registry). A control imported HERE would mean
    // the grid grew its own siren/light button.
    const src = code(OVERLAY)
    expect(src).not.toContain('accessory-controls/')
  })

  it('re-implements no overlay/switch section of its own', () => {
    const src = code(OVERLAY)
    expect(src).not.toContain('OverlaySettingsSections')
    expect(src).not.toContain('CameraSwitchGroup')
  })
})

describe('ONE configuration surface, two hosts', () => {
  it('the theater panel is a host over the shared surface', () => {
    const src = code(THEATER_PANEL)
    expect(src).toContain('CameraViewOptionsSurface')
    expect(src).toContain('TimelinePanelHost')
    // The content moved out: the sections must not be pasted back here.
    expect(src).not.toContain('OverlaySettingsSections')
  })

  it('the surface itself owns the sections — and no longer the switch group', () => {
    const src = code(SURFACE)
    expect(src).toContain('OverlaySettingsSections')
    expect(src).toContain('ClusterLabelRow')
    // The function switches moved to `CameraAccessoryPanel` (2026-09-22): a
    // group mounted here too would be the second home the panel removed.
    expect(src).not.toContain('CameraSwitchGroup')
  })

  it('both hosts read the SAME binding hook', () => {
    expect(code(DETAIL)).toContain('useCameraViewOptions')
    expect(code(OVERLAY)).toContain('useCameraViewOptions')
  })

  it('the camera screen no longer resolves the document a second time', () => {
    // `withHighlightDefaults(stored)` / `stored ?? OVERLAY_DEFAULTS` here is the
    // duplicate resolution the hook replaced — the shape that let two hosts of
    // one document disagree.
    const src = code(DETAIL)
    expect(src).not.toContain('withHighlightDefaults(')
    expect(src).not.toContain('OVERLAY_DEFAULTS')
  })
})

describe('nothing heavy is mounted per cell', () => {
  it('the overlay renders nothing at all while no panel is open', () => {
    expect(code(OVERLAY)).toContain('if (panel === null) return null')
  })

  it('the screen mounts exactly one cell-panel overlay', () => {
    const occurrences = code(SCREEN).match(/<GridCellPanelOverlay/g) ?? []
    expect(occurrences).toHaveLength(1)
  })

  it('the native tile hosts no panel of its own — it only asks', () => {
    const src = code(TILE)
    expect(src).not.toContain('DevicesPanel')
    expect(src).not.toContain('CameraViewOptionsSurface')
    expect(src).toContain('onCellPanel')
  })

  it('the tile chrome is revealed by a tap, not drawn permanently', () => {
    const src = code(TILE)
    expect(src).toContain('actionsOn')
    expect(src).toContain('ACTIONS_HIDE_MS')
  })
})

describe('the small-cell rule is the pure one, on both walls', () => {
  it('the native tile asks the pure rule with its measured size', () => {
    // The call moved behind `cameraActionBarForCell` when the bar was extracted
    // for the tablet shelf; it still passes the CELL's measured box, which is
    // the whole point of the rule.
    expect(code(TILE)).toContain('cameraActionBarForCell(width, height, hasPtz)')
  })

  it('the embed tile asks its mirrored copy with the measured cell size', () => {
    const src = code(EMBED_TILE)
    expect(src).toContain('resolveTileControls(cellW ?? 0, cellH ?? 0)')
    expect(src).toContain('secondary.inline.map')
    expect(src).toContain('secondary.overflow')
  })

  it('PTZ collapses with the rest on a compact cell, on both walls', () => {
    // The PTZ disc is the first one that stops fitting, and the compact list
    // offers it (`cellActionRows`). A wall that kept it inline while hiding the
    // other two would still overflow the cell it was measured for.
    expect(code(EMBED_TILE)).toContain('!onCellPanel || !secondary.overflow')
    // The native side now proves this BY VALUE — see
    // `grid/__tests__/camera-action-bar.spec.ts`, which asserts a compact bar
    // is exactly `['actions']` whether or not the camera has PTZ. The source
    // guard here only has to show the tile still goes through that list.
    expect(code(TILE)).toContain('<CameraActionBar')
  })

  it('the embed tile posts an intent instead of rendering a panel', () => {
    const src = code(EMBED_TILE)
    expect(src).toContain('onCellPanel(deviceId,')
    expect(src).not.toContain('DevicesPanel')
  })
})

describe('a panel never outlives the camera it describes', () => {
  it('the screen filters the open panel against the wall', () => {
    expect(code(SCREEN)).toContain('resolveCellPanel(openPanel, wallIds)')
  })
})
