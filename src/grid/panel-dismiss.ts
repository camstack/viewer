/**
 * panel-dismiss — what a tap on the grid BODY dismisses, and what counts as a
 * tap.
 *
 * ## One place that knows what is open
 *
 * The grid page can have three things open over the wall, and they arrived at
 * different times with different owners:
 *
 *   • the control bar's POPOVER — audio / quality / layout / the highlight menu
 *     (`FloatingControlBar`'s `panelKey`);
 *   • the CELL panel — PTZ / linked devices / view options / the compact list
 *     (`GridCellPanelOverlay`);
 *   • the SHARE dialog (`GridShareDialog`).
 *
 * The last two each carried their own full-screen backdrop and dismissed
 * themselves; the popover carried nothing at all, so a tap on the wall left it
 * standing — and, on the embed, that tap went THROUGH to a tile and opened a
 * camera. Three surfaces, two answers, one of them missing.
 *
 * The fix is not a fourth backdrop. {@link GridPanelsOpen} is the page's whole
 * answer to "is something open", {@link gridDismissTargets} is the whole answer
 * to "what does a tap close", and both backdrops plus the body scrim call the
 * SAME dismiss. A fourth panel adds a field here and is covered everywhere at
 * once, instead of shipping with its own outside-tap that disagrees with the
 * other three.
 *
 * ## The tap must not also act
 *
 * The body scrim is mounted ONLY while something is open, and while it is
 * mounted it is the top of the wall's subtree. So the first tap is CONSUMED —
 * it never reaches a tile, a WebView cell or the wall's own gestures — and when
 * nothing is open the scrim does not exist, so pinch, long-press and the cell
 * controls are untouched. That property is structural, not a flag someone has
 * to remember to check.
 *
 * Pure — no React, no I/O.
 */

/** What the grid page currently has open over the wall. */
export interface GridPanelsOpen {
  /** The control bar's popover, by action key, or null. */
  readonly barPanel: string | null
  /** A per-cell panel is mounted over the wall. */
  readonly cellPanel: boolean
  /** The share-builder dialog is up. */
  readonly share: boolean
}

/** One dismissable surface. */
export type GridDismissTarget = 'barPanel' | 'cellPanel' | 'share'

/** Nothing open — the page's resting state, and what a dismiss produces. */
export const NO_GRID_PANELS: GridPanelsOpen = { barPanel: null, cellPanel: false, share: false }

/**
 * Everything a dismiss must close, in the order they stack over the wall
 * (bar popover innermost, share dialog outermost). Empty ⇒ nothing is open.
 *
 * Returned as a list rather than a boolean so a caller can SAY what it closed —
 * a dismiss that silently closes two things is the bug this module replaces.
 */
export function gridDismissTargets(open: GridPanelsOpen): readonly GridDismissTarget[] {
  const targets: GridDismissTarget[] = []
  if (open.barPanel !== null) targets.push('barPanel')
  if (open.cellPanel) targets.push('cellPanel')
  if (open.share) targets.push('share')
  return targets
}

/**
 * Should the grid body swallow the next tap?
 *
 * True exactly when there is something to dismiss. The caller mounts the scrim
 * on this and nothing else: mounting it any wider would eat a tile press, and
 * any narrower would let the dismissing tap fall through and act.
 */
export function shouldInterceptGridTap(open: GridPanelsOpen): boolean {
  return gridDismissTargets(open).length > 0
}

/** Maximum finger travel (pt) between press and release that still reads as a
 *  tap. Beyond it the operator was dragging — scrubbing the timeline, panning,
 *  reordering — and a drag is not a dismissal. */
export const DISMISS_TAP_MAX_MOVE_PT = 12

/** Maximum press duration (ms) that still reads as a tap. A long-press is its
 *  own gesture and must not be spent closing a menu. */
export const DISMISS_TAP_MAX_MS = 600

/** One end of a press: where the finger was, and when. */
export interface DismissTapPoint {
  readonly x: number
  readonly y: number
  readonly t: number
}

/**
 * Was this press a TAP (so: dismiss), or a drag / long-press / stray gesture
 * (so: leave everything open)?
 *
 * An absolutely-positioned scrim fills the wall, so a drag never leaves its
 * bounds and `Pressable` would report every one of them as a press. The
 * decision therefore cannot come from the press itself; it comes from the two
 * endpoints, here, where it can be tested.
 *
 * A missing or non-finite coordinate (it happens on web synthetic events)
 * resolves to "tap": the scrim exists only while a panel is open, and refusing
 * to close on a press we cannot measure is the worse failure.
 */
export function isDismissTap(down: DismissTapPoint, up: DismissTapPoint): boolean {
  const dt = up.t - down.t
  if (Number.isFinite(dt) && dt > DISMISS_TAP_MAX_MS) return false
  const dx = up.x - down.x
  const dy = up.y - down.y
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return true
  return Math.hypot(dx, dy) <= DISMISS_TAP_MAX_MOVE_PT
}
