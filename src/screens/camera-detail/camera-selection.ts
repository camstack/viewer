/**
 * camera-selection — what the camera panel's confirm button MEANS.
 *
 * ## The control did not change; its destination did
 *
 * The panel was never a modal — it takes the timeline body like every other
 * panel. What read as one was the DESTINATION: with 2+ cameras ticked it did
 * `router.push('/grid/adhoc?devices=…')` into a `containedTransparentModal`
 * group, so the player stayed mounted underneath and a whole screen arrived
 * over it like a card.
 *
 * On a surface that BUILDS a view there is nothing to navigate to. The cameras
 * the operator ticked ARE the view, drawn as a wall IN THE PICTURE'S OWN BOX
 * (`WorkspaceStage`, in the timeline's stream slot — it stopped being a second
 * surface under the picture on 2026-09-02), and the operator stays exactly
 * where they were. `/grid/adhoc` is untouched and still reachable: it is the
 * sharing format, the deep link (`grid/adhoc-devices.ts`), and still what this
 * button does in portrait.
 *
 * ## Which surfaces BUILD a view — the third of three questions
 *
 * This used to ask `shouldShowCameraShelf`, on the argument that "has reserved
 * space under the picture" and "builds a view" were one question. They are not,
 * and the phone is what separated them. A phone has no reel in either shape and
 * hosts a wall in both, so the three questions this repo was asking of one
 * predicate now have three different answers on it — no / yes / landscape-only.
 * Each has its own name: `shouldShowCameraShelf`, `canHostWorkspaceWall`, and
 * {@link canBuildViewFromSelection} here.
 *
 * ## Why `stack` still routes to `/grid/adhoc` — a STRUCTURAL reason
 *
 * The reason is not the space. `stack` has room for a wall and renders one
 * happily. It is WHERE THIS CONTROL LIVES: the selector is hosted inside the
 * TIMELINE BODY (`TimelineCameraPanel`), and in portrait the timeline body is
 * the bottom two-thirds of the screen the operator is touching. Building a view
 * from it would replace the picture above while the surface under their finger
 * closed — the panel closes on confirm — and the operator would be left holding
 * a screen that reorganised itself around them. `/grid/adhoc` is already "only
 * the grid, with a way to close it", and it is a route, so Back is the way out.
 *
 * `fill` has the opposite geometry and therefore the opposite answer: the
 * selector rides in the compact right-edge drawer, which floats OVER the
 * picture and is dismissed by the same toggle that opened it. The wall goes up
 * behind the drawer, the drawer stays exactly where it was, and nothing the
 * operator is touching moves. So `fill` builds, and does not navigate.
 *
 * That asymmetry is the whole reason this is a per-SHAPE table rather than a
 * per-device one. A tablet in portrait is `stack` too, and it gets the same
 * answer for the same reason.
 *
 * ## The two decisions this file settles
 *
 * **One camera selected is a `goTo`.** The design's D5 reads it as "replace the
 * primary", and on this screen the primary IS the picture: `app/(app)/camera/
 * [id].tsx` keys the whole screen by the route id, every singular control (PTZ,
 * export, capture, snapshot) acts on it, and `workspaceOnScreenCameras` puts it
 * at the HEAD of the wall precisely because it is the cell
 * `resolvePrimaryWallSpan` enlarges. (This paragraph named
 * `workspaceGridCameras` until 2026-09-02 — a function deleted the same day the
 * picture became a cell, describing an exclusion that no longer happens. A
 * leftover that describes the right design reads as verification; it did not
 * describe this one at all.) So "make this one the primary" and
 * `router.replace('/camera/<id>')` are the same act — and that is what a row
 * tap, a shelf card and a cell's own open button all already do. Giving the
 * confirm a fourth implementation of one verb is how two of them drift.
 *
 * **A confirmed selection REPLACES the view, it does not extend it.** Three
 * reasons, in the order they decided it:
 *
 * 1. The checkboxes start empty and do not describe the current members. A
 *    control that cannot show what is in the view cannot subtract from it, so
 *    if it added, unticking would be the one gesture with no effect — and the
 *    operator would read the result as "my unticks were ignored".
 * 2. Something already adds one camera at a time and REPORTS its state: the
 *    shelf card's "add to view" (`camera-action-bar.ts`, `inWorkspace`). Two
 *    controls that both add, one of which cannot remove, is the pair that
 *    disagrees. Replacing gives this one the job the shelf cannot do: state the
 *    whole view at once.
 * 3. `/grid/adhoc?devices=…` — the destination this replaces — has always meant
 *    "these cameras, exactly". Keeping the meaning identical is what lets the
 *    shared link and the button keep describing the same thing.
 *
 * Pure — no React, no router, no store. The screen performs the outcome.
 */
import type { DetailLayoutMode } from './detail-layout.js'

/**
 * Which layout shapes turn a confirmed selection INTO the view on screen, one
 * row per shape — the rest route to `/grid/adhoc`.
 *
 * A table over the closed union, for the same reason `WALL_HOSTS` is one: this
 * answer was `mode === 'wide'` by way of the reel's predicate, and the shape
 * that changed its mind (`fill`) was never asked. Now it must be.
 *
 * See the module docblock for why `fill` and `stack` — the SAME device, one
 * rotation apart — disagree. It is where the selector is hosted, not how much
 * room the screen has.
 */
const BUILDS_VIEW: Readonly<Record<DetailLayoutMode, boolean>> = {
  /** The tablet column. (No route in today: the operator removed the camera
   *  chip above the tablet threshold on 2026-09-02 — `camera-jump-gate.spec`.
   *  A tablet builds its view from the reel card's "add to view".) */
  wide: true,
  /** A phone in landscape. The selector is in the edge drawer, which floats
   *  over the picture — the wall replaces what is BEHIND the drawer. */
  fill: true,
  /** Portrait. The selector is inside the timeline body, so building a view
   *  would make the surface being used disappear. `/grid/adhoc` instead. */
  stack: false,
}

/** Does confirming a selection BUILD the view here, or route to one?
 *  See {@link BUILDS_VIEW}. */
export function canBuildViewFromSelection(mode: DetailLayoutMode): boolean {
  return BUILDS_VIEW[mode]
}

/**
 * What confirming means on this surface.
 *
 * `openGrid` is what shipped and what PORTRAIT keeps: navigate to the ephemeral
 * grid route. `buildView` writes the workspace and stays put.
 */
export type CameraSelectionMode = 'openGrid' | 'buildView'

/**
 * How many cameras arm the confirm, per meaning.
 *
 * Two for `openGrid` because a grid of one camera is the camera screen the
 * operator is already on — the button has been disabled below two since it was
 * written. One for `buildView` because one camera is a `goTo`, which is a real
 * thing to ask a camera list for.
 */
export const MIN_SELECTION: Readonly<Record<CameraSelectionMode, number>> = {
  openGrid: 2,
  buildView: 1,
}

/** The outcome the screen performs. A closed union so a new meaning cannot be
 *  added without every caller being made to answer for it. */
export type CameraSelectionOutcome =
  /** Navigate to the on-the-fly grid route — the PORTRAIT path, unchanged. */
  | { readonly kind: 'openGrid'; readonly deviceIds: readonly number[] }
  /** These cameras BECOME the workspace. No navigation. */
  | { readonly kind: 'buildView'; readonly members: readonly number[] }
  /** `router.replace('/camera/<id>')` — the same verb as a row tap. */
  | { readonly kind: 'goTo'; readonly deviceId: number }
  /** Not enough selected to mean anything. The confirm is disabled here. */
  | { readonly kind: 'none' }

/** Does this layout build a view, or route to one? */
export function cameraSelectionModeFor(mode: DetailLayoutMode): CameraSelectionMode {
  return canBuildViewFromSelection(mode) ? 'buildView' : 'openGrid'
}

/** First occurrence wins: the list order is the wall's order, and a device
 *  offered twice is one cell either way. */
function distinct(ids: readonly number[]): readonly number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** Resolve a confirmed selection into the one thing the screen should do. */
export function resolveCameraSelection(
  mode: CameraSelectionMode,
  ids: readonly number[],
): CameraSelectionOutcome {
  // Deduplicated BEFORE the count is read, so "two entries, one camera" cannot
  // be mistaken for a view: the arithmetic and the outcome see one list.
  const unique = distinct(ids)
  if (unique.length < MIN_SELECTION[mode]) return { kind: 'none' }
  if (mode === 'openGrid') return { kind: 'openGrid', deviceIds: unique }
  if (unique.length === 1) return { kind: 'goTo', deviceId: unique[0] }
  return { kind: 'buildView', members: unique }
}
