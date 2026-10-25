/**
 * cell-controls — what a GRID CELL offers beyond its stream controls, and which
 * host panel a tap opens.
 *
 * The wall's tiles used to carry exactly one action that was not about the
 * stream itself: PTZ, an in-tile button whose tap the host answers by mounting
 * `PtzControls` over the wall. That shape — a tile posts an intent, ONE host
 * panel is mounted on demand — is what the linked-device actions and the
 * per-camera view-options menu now reuse. Nothing about either surface is
 * re-implemented for the grid: the host mounts `DevicesPanel` and
 * `CameraViewOptionsSurface`, the same components the single-camera view
 * mounts (see `use-camera-view-options` for the shared configuration).
 *
 * ## Why the compact rule exists
 *
 * A 3×3 wall on a phone gives each cell ~130pt of width. The tile ALREADY draws
 * five 32-40pt discs (play/pause, listen, talk, PTZ, open); two more produce a
 * row that neither fits nor can be hit. Below the threshold the two secondary
 * actions therefore collapse behind ONE "more" button that opens them as a
 * list — the same panels, one extra tap, instead of chrome the operator cannot
 * use. `embed/src/embed/tile-controls.ts` mirrors this rule for the hosted
 * player (the embed is a separate bundle and cannot import this module — the
 * same mirroring the grid message contract already lives with).
 *
 * Pure — no React, no I/O.
 */

/** A secondary per-cell action: a surface SHARED with the single-camera view. */
export type GridCellAction = 'devices' | 'viewOptions'

/** Everything the host can mount over the wall for one cell. `actions` is the
 *  compact list itself (the "more" button's sheet). */
export type GridCellPanelKind = 'ptz' | GridCellAction | 'actions'

/** The open cell panel: a kind AND the camera it describes, in one value, so
 *  "a panel is open" and "there is a camera to open it for" cannot disagree
 *  (the discipline `TimelinePanel` uses in the theater). */
export interface GridCellPanel {
  readonly kind: GridCellPanelKind
  readonly deviceId: number
}

/** Smallest cell WIDTH (px/pt) that can carry the secondary buttons inline.
 *  Sized against the WHOLE bottom row, not the two new discs alone: listen +
 *  talk + PTZ + devices + menu is 5 × 40 with 8 between (232), and the "open"
 *  disc sits opposite them. A threshold that only counted the additions left a
 *  row that overflowed its own cell. */
export const CELL_INLINE_MIN_W = 300
/** Smallest cell HEIGHT (px/pt) that can carry them (wide 3-up landscape
 *  strips are broad but short, and the buttons sit on the bottom edge). */
export const CELL_INLINE_MIN_H = 130

/** Which secondary actions a cell of this size draws, and whether they are
 *  collapsed behind the single "more" button. */
export interface CellControlLayout {
  /** Actions drawn as their own in-tile button, in display order. */
  readonly inline: readonly GridCellAction[]
  /** True when the cell is too small: draw ONE "more" button instead. */
  readonly overflow: boolean
}

/** The two secondary actions, in display order. */
const ACTIONS: readonly GridCellAction[] = ['devices', 'viewOptions']

const INLINE: CellControlLayout = { inline: ACTIONS, overflow: false }
const COMPACT: CellControlLayout = { inline: [], overflow: true }

/**
 * Resolve the cell's secondary-control layout from its measured size.
 *
 * An unmeasured cell (0×0 on the first paint) resolves to COMPACT: one button
 * that is always reachable beats a row sized from a number we do not have yet.
 */
export function resolveCellControls(cellW: number, cellH: number): CellControlLayout {
  return cellW >= CELL_INLINE_MIN_W && cellH >= CELL_INLINE_MIN_H ? INLINE : COMPACT
}

/**
 * Smallest cell that can carry the FULL stats panel (150-220pt wide, ~7 rows).
 * Below it the read-out still draws — as the one-line form — because the
 * operator turned it on per camera and a control that silently does nothing on
 * a small cell is the dead knob this feature exists to avoid.
 */
export const CELL_STATS_PANEL_MIN_W = 340
export const CELL_STATS_PANEL_MIN_H = 240

/** Does this cell have room for the full stats panel, or does it get the line? */
export function statsPanelFits(cellW: number, cellH: number): boolean {
  return cellW >= CELL_STATS_PANEL_MIN_W && cellH >= CELL_STATS_PANEL_MIN_H
}

/** What the compact "more" sheet lists for this camera. */
export interface CellActionRowsInput {
  readonly hasPtz: boolean
}

/**
 * The rows of the compact sheet. PTZ leads when the camera has it: it is the
 * one action that MOVES the camera, and on a compact cell its own in-tile
 * button is the first thing that stops fitting.
 */
export function cellActionRows(input: CellActionRowsInput): readonly GridCellPanelKind[] {
  return input.hasPtz ? ['ptz', ...ACTIONS] : [...ACTIONS]
}

/**
 * Keep the open panel only while its camera is still on the wall.
 *
 * The wall's camera set moves under an open panel — active-only filtering, a
 * hide in the builder, a removal. A panel left mounted for a camera that is no
 * longer shown describes something the operator cannot see, and its linked
 * devices would be actionable from a wall that does not contain them.
 *
 * Returns the SAME object when nothing changed, so the caller's memo does not
 * churn every render.
 */
export function resolveCellPanel(
  panel: GridCellPanel | null,
  visibleIds: readonly number[],
): GridCellPanel | null {
  if (panel === null) return null
  return visibleIds.includes(panel.deviceId) ? panel : null
}
