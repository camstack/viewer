/**
 * workspace-grid — when the theater stops being ONE picture and becomes a WALL,
 * and which cameras end up on it.
 *
 * ## The threshold is no longer the shelf's (2026-09-02, phase two)
 *
 * It was `shouldShowCameraShelf(mode)` — "is there reserved space under the
 * picture" — plus a camera count. That worked while the wall lived UNDER the
 * picture and only `wide` had room for it. The wall now REPLACES the picture,
 * so the space it needs is the space the picture already had, and every shape
 * has that. The operator asked for the wall on the phone too; the gate is
 * therefore {@link canHostWorkspaceWall}, which says yes to all three shapes
 * and says it as a TABLE, so a fourth shape cannot be added without answering.
 *
 * That is deliberately NOT the same question as "does confirming a selection
 * build a view" (`camera-selection.ts`, `stack` says no) or "is there a reel"
 * (`camera-shelf.ts`, `wide` only). Those three answers used to be one value on
 * a phone — no, no, no — and a single predicate served all of them. They are
 * now no / yes / landscape-only, and one predicate can no longer say that.
 *
 * ## Portrait RENDERS a view, it never builds one
 *
 * Because this gate is mode-blind, a phone rotated from landscape (wall up) to
 * portrait keeps its wall — drawn in the picture's box with the timeline below,
 * exactly as `wide` does. Nothing in `stack` can put members INTO the store
 * (the reel does not exist there and the selector's confirm routes to
 * `/grid/adhoc`), so "portrait honours a view that already exists" is a
 * property of this file plus `camera-selection.ts`, not a fourth rule.
 *
 * ## "On screen" counts the picture — the defect this file shipped with
 *
 * The condition used to be `members.length >= 2`, and `members` never contains
 * the camera in the picture unless the operator navigated to one of them: the
 * shelf lists what is NOT on screen (`camera-shelf.ts`), so "add to view" on
 * the one other camera the operator wanted left `members` at ONE and the gate
 * shut. Meanwhile the timeline — reading the SAME store — counted the picture
 * and widened to two cameras. One state, two arithmetics, and the operator saw
 * exactly that: the timeline followed the selection and the space under the
 * picture did not move. There is now ONE list
 * ({@link workspaceOnScreenCameras}) and every surface counts it.
 *
 * ## The picture IS a cell (2026-09-02)
 *
 * Until this date the wall was drawn UNDER the picture and deliberately
 * excluded the route camera, which stayed a separate native `<LiveView>`. The
 * argument for that was the session: `TheaterTimeline` holds the player in slot
 * index 1, that slot is the player's ONE parent in every layout, and moving the
 * live session into the wall's WebView is a remount of the one session the
 * screen is built to protect (`stream-slot.ts`).
 *
 * The operator overruled it — "Non possiamo usare la grid con l'aggiunta? Non
 * fa niente se riconnette" — and the design is now the one they described from
 * the start: the single-camera view is REPLACED by a grid on demand, cameras
 * auto-distributed, the primary given most of the space
 * (`grid/auto-layout.ts`, `resolvePrimaryWallSpan`). So the exclusion is gone,
 * with it the second arithmetic that produced it, and the cost is one
 * renegotiation on the single→wall transition and one on the way back. Nothing
 * else changed about the no-remount guarantee: once the wall is up, ADDING a
 * camera still pushes `setDevices` and remounts nothing
 * (`WorkspaceGrid.tsx`).
 *
 * The symmetry that used to need explaining now needs none: `goTo` on a cell is
 * `router.replace('/camera/<id>')`, the route camera changes, and the wall's
 * list is re-ordered around the new head rather than losing a member.
 *
 * Pure — no React. `WorkspaceGrid.tsx` is the surface, `WorkspaceStage.tsx` its
 * store-bound host.
 */
import type { DetailLayoutMode } from './detail-layout.js'

/**
 * Which layout shapes can DRAW a wall, one row per shape.
 *
 * A table rather than a comparison, because the value of this predicate is that
 * every shape had to answer: `mode === 'wide'` was true when the wall was drawn
 * under the picture, and the phone's arrival changed the answer for two shapes
 * at once with nothing forcing either to be revisited. `Readonly<Record<…>>`
 * over the closed union means a fourth shape does not compile until it says.
 *
 * All three are `true` today and that is the point, not an oversight: the wall
 * takes the PICTURE's box, and a shape that can draw a picture can draw a wall.
 * The differences between the shapes are the BOX (`wall-box.ts`) and what
 * confirming a selection means (`camera-selection.ts`) — never whether a wall
 * may exist.
 */
const WALL_HOSTS: Readonly<Record<DetailLayoutMode, boolean>> = {
  /** The picture column, beside the timeline rail. Where the wall started. */
  wide: true,
  /** A phone in landscape, and explicit fullscreen. The wall takes the window;
   *  the timeline stays in the compact edge drawer it already rides in. */
  fill: true,
  /** The portrait column. It cannot BUILD a view (see the docblock) but it
   *  draws one that exists, in the picture's box, with the timeline below. */
  stack: true,
}

/** Can this layout shape draw a wall at all? See {@link WALL_HOSTS}. */
export function canHostWorkspaceWall(mode: DetailLayoutMode): boolean {
  return WALL_HOSTS[mode]
}

/**
 * Fewest cameras ON SCREEN that make a wall — the picture INCLUDED.
 *
 * Two, and the picture is one of them. A single camera is the theater exactly
 * as it ships; the moment a second camera is on screen the operator is watching
 * a view, and a view is drawn as one wall.
 */
export const WORKSPACE_GRID_MIN_CAMERAS = 2

/**
 * Is the theater showing a WALL right now, rather than the single picture?
 *
 * The mode is still the first question, through {@link canHostWorkspaceWall}
 * rather than through the reel's predicate — see the module docblock for why
 * those stopped being the same question.
 *
 * `currentDeviceId` is an argument rather than an omission: the cameras on
 * screen are the route camera plus the members, and a member that IS the route
 * camera is one camera, not two. Asking the same function the wall is drawn
 * from is what makes "the gate is open" and "there is something to draw" one
 * answer instead of two.
 */
export function shouldShowWorkspaceGrid(
  mode: DetailLayoutMode,
  members: readonly number[],
  currentDeviceId: number,
): boolean {
  if (!canHostWorkspaceWall(mode)) return false
  return workspaceOnScreenCameras(members, currentDeviceId).length >= WORKSPACE_GRID_MIN_CAMERAS
}

/**
 * Every camera on screen, picture first — the wall's cells, and the timeline's
 * scope, which are now the same list.
 *
 * They were two functions until 2026-09-02: the wall excluded the route camera
 * (it was playing above, in its own player) and the timeline included it. That
 * split is what the gate got wrong once already. With the picture drawn as a
 * cell there is nothing left to differ about, and one function is the only way
 * "which cameras is this screen about" cannot be answered twice.
 *
 * The picture comes FIRST, and that ordering is load-bearing in both roles. On
 * the wall it is the PRIMARY, the cell `resolvePrimaryWallSpan` enlarges. In
 * the timeline `planScopeAsk` truncates at the batch ceiling from the END, so
 * the one camera an over-large view may never cost is the one the operator
 * navigated to.
 *
 * Never empty — with no view it is `[currentDeviceId]`, which makes every hook
 * take its single-camera path and camera-detail behave exactly as it shipped.
 */
export function workspaceOnScreenCameras(
  members: readonly number[],
  currentDeviceId: number,
): readonly number[] {
  return [currentDeviceId, ...members.filter((id) => id !== currentDeviceId)]
}

/** How the snapshot shelf lists cameras. `rows` is the single-camera theater:
 *  cards wrapping into as many rows as the column is wide enough for. `strip`
 *  is one horizontal scrolling row — what is left of the shelf once the wall
 *  has taken the column. */
export type ShelfVariant = 'rows' | 'strip'

/** One row when the wall is up, the wrapping rows when it is not. */
export function shelfVariantFor(gridShowing: boolean): ShelfVariant {
  return gridShowing ? 'strip' : 'rows'
}

/**
 * Card width (pt) in the one-row strip. Narrower than the wrapping shelf's 180:
 * the strip's height is subtracted from the wall, so every point it does not
 * take is a point of live picture.
 */
export const STRIP_CARD_WIDTH = 132

/**
 * Height (pt) the strip reserves, leaving the rest to the wall.
 *
 * The arithmetic, so a card change that outgrows it is visible here: 8 card
 * padding + 74 thumbnail (132 at 16:9) + 4 + 16 name row + 4 + 32 action bar =
 * 138, plus 8 above and below the row. Fixed rather than measured on purpose —
 * a strip that measured itself would decide the wall's box, and the split under
 * the picture must not depend on what the snapshots happen to be doing.
 */
export const SHELF_STRIP_HEIGHT = 154
