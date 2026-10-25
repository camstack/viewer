/**
 * camera-action-bar — WHICH per-camera controls a bar renders, as one list.
 *
 * ## Why this is extracted rather than reinvented
 *
 * The grid already shows a per-camera bar: the tap-to-reveal row of discs on a
 * `GridTile`. It is the right SET of controls and the wrong CHROME — translucent
 * discs sized for a video wall, in a language nothing else in the app speaks.
 * The tablet snapshot shelf needs the same set on an app-styled surface.
 *
 * The operator's instruction was to extract that bar, not to invent a second
 * one. So the split is: this module is the bar's CONTENT (pure, ordered,
 * testable by value) and `components/camera/CameraActionBar.tsx` is its FRAME,
 * with one variant per surface. Two callers, one list — and
 * `camera-action-bar.spec.ts` asserts they cannot diverge, because a bar that
 * has forked is exactly the defect this replaces.
 *
 * The size rule stays in `cell-controls.ts` where it was written and measured;
 * a bar on a roomy surface simply passes the inline layout.
 *
 * Pure — no React, no i18n, no icons. The frame maps `kind` to both.
 */
import {
  resolveCellControls,
  type CellControlLayout,
  type GridCellPanelKind,
} from './cell-controls.js'

/**
 * The controls a card ABOUT a camera has and the camera's own picture does not:
 * go there, put it in the view, and look at it in the on-demand player. They
 * are part of THIS bar rather than a second row beside it, so there is one
 * place that decides what a per-camera bar contains.
 *
 * `playback` opens the D483 overlay at the instant the operator is ALREADY
 * looking at (`live/ondemand-player.ts`, `resolveReelInstant`) — "camera B at
 * this moment", never "camera B live". Live is what `addToView` already does,
 * and two controls that reach the same picture is the fork this module exists
 * to prevent.
 */
export type CameraNavAction = 'goTo' | 'addToView' | 'playback'

/**
 * The nav actions, once.
 *
 * This list used to be spelled out twice — a local `nav` array inside
 * {@link cameraPanelActions} and a pair of `!==` comparisons inside
 * {@link isCameraPanelAction} — so adding a third member meant remembering both
 * and a miss would have been silent in the worse direction: `playback` would
 * have been narrowed INTO `GridCellPanelKind` and posted to the panel hosts,
 * which have no case for it.
 */
export const CAMERA_NAV_ACTIONS: readonly CameraNavAction[] = ['goTo', 'addToView', 'playback']

/** Every intent a per-camera bar can post. The panel kinds are the union
 *  `GridCellPanel` carries, so a bar press and a mounted panel can never mean
 *  different things. */
export type CameraActionKind = GridCellPanelKind | CameraNavAction

/** One control in the bar. `disabled` is only ever true for a control that
 *  describes a state the operator can SEE (a camera already in the view) —
 *  never for one that is merely unavailable, which is hidden instead. */
export interface CameraActionItem {
  readonly kind: CameraActionKind
  readonly disabled?: boolean
}

export interface CameraActionBarInput {
  /** PTZ is hidden, never greyed, when the camera (or the session) lacks it. */
  readonly hasPtz: boolean
  /** How much room the bar has. A cell passes its measured size; a surface
   *  that is roomy by construction passes {@link ROOMY}. */
  readonly layout: CellControlLayout
  /**
   * `true` on a surface that is a CARD about a camera (the tablet snapshot
   * shelf) and `false` on the camera's own live picture (a wall tile). "Go to
   * the camera you are already watching" is a control with nothing to do.
   */
  readonly canNavigate?: boolean
}

/**
 * The SHELF's secondary controls — `devices` only, and deliberately not the
 * wall's pair.
 *
 * ## Why the two surfaces no longer match (2026-09-12, D483)
 *
 * They did, and `camera-action-bar.spec.ts` asserted it control-for-control,
 * because the bar was extracted from `GridTile` precisely so it could not fork.
 * That invariant was right about the CONTROLS and wrong about one of them.
 *
 * `viewOptions` opens per-camera overlay + highlight configuration
 * (`useCameraViewOptions` via `GridCellPanelOverlay`). A wall tile is a live
 * picture and those overlays are drawn on it; a reel card is a SNAPSHOT
 * thumbnail, so on the shelf the control configures a picture that is not
 * there. The operator's judgement — "il pulsante delle settings che non è
 * necessario lì" — is about that, and it is theirs to make.
 *
 * Nothing is stranded by the removal. The same panel is reachable from
 * `GridTile` (the wall cell — where the overlays are visible, and where the
 * reel's own `addToView` sends the camera) and from `CameraDetailScreen` for
 * the camera in the picture. `devices` stays: linked lights are actionable
 * without a picture to draw on.
 *
 * This constant is the shelf's alone, so the WALL is untouched — the honest
 * shape for a divergence of one surface. Removing `viewOptions` from
 * `cell-controls.ts` would have changed the grid too, silently, which is the
 * thing worth more than the invariant.
 */
export const SHELF_CONTROLS: CellControlLayout = { inline: ['devices'], overflow: false }

/** The bar for a measured cell — the grid's own call. */
export function cameraActionBarForCell(
  cellW: number,
  cellH: number,
  hasPtz: boolean,
): readonly CameraActionItem[] {
  return cameraActionBarItems({ hasPtz, layout: resolveCellControls(cellW, cellH) })
}

/**
 * The bar's items, in display order.
 *
 * PTZ leads when the camera has it and there is room: it is the one control
 * that MOVES the camera. When the surface is too small everything secondary
 * collapses into the single `actions` sheet — the rule `cell-controls.ts`
 * measured against a 3x3 phone wall.
 */
export function cameraActionBarItems({
  hasPtz,
  layout,
  canNavigate = false,
}: CameraActionBarInput): readonly CameraActionItem[] {
  const items: CameraActionItem[] = []
  if (canNavigate) {
    items.push({ kind: 'goTo' })
    // Never disabled. It carried an `inWorkspace` flag that greyed it out for a
    // camera already in the view, and that state stopped existing when ONE
    // added camera started the wall (`workspace-grid.ts`): a member is drawn as
    // a CELL and dropped from the shelf by the same rule that drops the
    // picture, so a card offering the add is by construction a camera that is
    // not in the view. A greyed control nothing can reach reads as a promise
    // the surface does not keep.
    items.push({ kind: 'addToView' })
    // Third and last of the nav group: look at this camera in the on-demand
    // player, at the instant already on screen. After the add on purpose — the
    // two that change what the SCREEN shows come first, and the one that opens
    // a second picture over it last.
    items.push({ kind: 'playback' })
  }
  if (layout.overflow) {
    items.push({ kind: 'actions' })
    return items
  }
  if (hasPtz) items.push({ kind: 'ptz' })
  for (const action of layout.inline) items.push({ kind: action })
  return items
}

/** Narrow a bar intent to one the panel hosts answer. A surface that passes
 *  `canNavigate: false` never receives the other two, but the type has to say
 *  so — a cast would say it without checking. */
export function isCameraPanelAction(kind: CameraActionKind): kind is GridCellPanelKind {
  // Widened to the union rather than casting `kind` down to the nav type: the
  // nav actions ARE camera actions, so the assignment needs no cast, and a cast
  // here would be asserting the very thing this guard is asked to decide.
  const nav: readonly CameraActionKind[] = CAMERA_NAV_ACTIONS
  return !nav.includes(kind)
}

/** The controls that are NOT about navigation — the set every surface showing
 *  this bar must render identically. `camera-action-bar.spec.ts` compares the
 *  wall's bar with the shelf's through this. */
export function cameraPanelActions(
  items: readonly CameraActionItem[],
): readonly CameraActionKind[] {
  return items.map((i) => i.kind).filter(isCameraPanelAction)
}
