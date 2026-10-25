/**
 * tile-controls — which SECONDARY actions a grid tile draws at its measured
 * size.
 *
 * A tile carries up to five stream discs already (play/pause, listen, talk,
 * PTZ, open). The linked-device actions and the per-camera view-options menu
 * add two more, and on a phone's 3×3 wall (~130 CSS px per cell) that row
 * neither fits nor can be hit. Below the threshold the two collapse behind ONE
 * "more" button whose tap the HOST answers with a list of the same panels.
 *
 * This mirrors `src/grid/cell-controls.ts` (the native wall's copy) — the embed
 * is a separate bundle and cannot import the app's modules, the same mirroring
 * the grid message contract already lives with. Keep the thresholds equal: a
 * wall rendered by the embed and one rendered natively must not disagree about
 * when a button disappears.
 */

/** A secondary tile action — each opens a host panel shared with the app's
 *  single-camera view. */
export type TileAction = 'devices' | 'viewOptions'

/** Smallest cell width (CSS px) that can carry the secondary buttons inline.
 *  Sized against the WHOLE bottom row (5 discs of 40 with 8 between, plus the
 *  opposite "open" disc), not the two additions alone. */
export const TILE_INLINE_MIN_W = 300
/** Smallest cell height (CSS px) that can carry them. */
export const TILE_INLINE_MIN_H = 130

export interface TileControlLayout {
  /** Actions drawn as their own in-tile button, in display order. */
  readonly inline: readonly TileAction[]
  /** True when the cell is too small: draw ONE "more" button instead. */
  readonly overflow: boolean
}

const ACTIONS: readonly TileAction[] = ['devices', 'viewOptions']

const INLINE: TileControlLayout = { inline: ACTIONS, overflow: false }
const COMPACT: TileControlLayout = { inline: [], overflow: true }

/** Resolve a tile's secondary-control layout from its measured cell size. An
 *  unmeasured cell (0×0 before the first layout) resolves to COMPACT. */
export function resolveTileControls(cellW: number, cellH: number): TileControlLayout {
  return cellW >= TILE_INLINE_MIN_W && cellH >= TILE_INLINE_MIN_H ? INLINE : COMPACT
}

// ── The editable wall ────────────────────────────────────────────────────────

/**
 * Smallest cell that carries the "take this camera off the wall" control.
 *
 * Deliberately far below the secondary-button thresholds above: taking a camera
 * off is the one action the operator has NO other route to (the host's close
 * button empties the whole view, and `open` promotes instead of removing), so it
 * should survive down to a cell where a disc still has somewhere to sit. Below
 * this the cell is a thumbnail and a destructive control on it is a mis-tap.
 */
export const TILE_REMOVE_MIN_W = 120
export const TILE_REMOVE_MIN_H = 68

/**
 * Does this cell draw the remove control?
 *
 * `editable` is the HOST's answer to "is this wall a view the operator is
 * building, or a saved grid whose membership belongs to the grid" — the page
 * cannot know, and a remove that silently did nothing (or edited a saved grid
 * nobody asked to edit) is worse than no button. An unmeasured cell (0×0 before
 * the first layout) draws nothing.
 */
export function drawsRemoveControl(editable: boolean, cellW: number, cellH: number): boolean {
  return editable && cellW >= TILE_REMOVE_MIN_W && cellH >= TILE_REMOVE_MIN_H
}
