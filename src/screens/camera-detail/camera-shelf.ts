/**
 * camera-shelf — the rules for the REEL of other cameras under the picture.
 *
 * ## Where the space comes from
 *
 * It is not new space. `wide-detail-sizes.ts` has capped the stream box at
 * `STREAM_MAX_HEIGHT_FRACTION` (0.62) of the viewport since it was written, and
 * the comment on that constant says what the remaining ~38% is for: "the info
 * area … Phase 4". The spec that described Phase 4 no longer exists in the repo
 * and nothing was ever drawn there. This is that phase.
 *
 * ## The threshold is one that already exists
 *
 * `layoutMode === 'wide'` — a tablet in landscape, or a web window >= 1000pt
 * (`sidebar-rules.ts`, tuned by the operator on 2026-08-08). No fifth "tablet"
 * constant: the app already has three families of breakpoints and two of them
 * are debt. In `stack` the reserved space does not exist (the timeline has it)
 * and in `fill` the picture owns the window, so on a PHONE the reel can never
 * appear — which is the guarantee the request asks for, and it is checked by
 * value in the spec rather than argued here.
 *
 * ## This predicate answers ONE question again (2026-09-02)
 *
 * `shouldShowCameraShelf` used to be asked THREE things by three call sites:
 * "is there a reel" (here), "can a wall be shown" (`workspace-grid.ts`) and
 * "does confirming build a view or route to one" (`camera-selection.ts`). One
 * value could serve all three only while the answer was "tablet, or nothing".
 * The phone now says no / yes / landscape-only to those three, so they are
 * three predicates, each named for its own question:
 * {@link shouldShowCameraShelf}, `canHostWorkspaceWall` and
 * `canBuildViewFromSelection`. Nothing outside this file may read this one as a
 * proxy for the other two.
 *
 * Pure — no React. See `CameraShelf.tsx` for the surface.
 */
import type { DetailLayoutMode } from './detail-layout.js'

/**
 * Is there a REEL on this surface — the strip of snapshot cards for the cameras
 * that are not on screen?
 *
 * `wide` only, and this is the whole of what it means. It is not "is this a
 * tablet" and it is not "can this surface hold a wall": a phone hosts a wall in
 * both of its shapes and has no reel in either, because in `stack` the timeline
 * already owns the space under the picture and in `fill` the picture owns the
 * window.
 */
export function shouldShowCameraShelf(mode: DetailLayoutMode): boolean {
  return mode === 'wide'
}

/**
 * The cameras the shelf lists: every known camera that is NOT already on
 * screen, in the order the camera list already gives them (the operator's own
 * order — `camera-prefs-store` owns it and the list hook has already applied
 * it).
 *
 * The current camera is excluded rather than disabled: "go to the camera you
 * are already on" is a control with nothing to do, and "add the camera you are
 * already watching" is the one member a view always has.
 *
 * `alreadyOnScreen` extends that same rule to the wall's cells once one is
 * drawn (`workspace-grid.ts`): a camera the operator can see live has nothing
 * to gain from a snapshot of itself beside it. It is one rule — "list what is
 * not visible" — not two, and it defaults to empty so a caller without a wall
 * behaves exactly as before this argument existed.
 */
export function shelfCameras<T extends { readonly id: number }>(
  cameras: readonly T[],
  currentDeviceId: number,
  alreadyOnScreen: readonly number[] = [],
): readonly T[] {
  return cameras.filter((c) => c.id !== currentDeviceId && !alreadyOnScreen.includes(c.id))
}

/**
 * The card width (pt) the shelf AIMS for. 16:9 at this width is 101pt tall, so
 * two rows plus their labels fit the ~38% the wide layout reserves on an iPad
 * without the shelf ever driving the split — the split is
 * `STREAM_MAX_HEIGHT_FRACTION` and nothing here may change it.
 *
 * It is a MINIMUM, not the drawn width: see {@link fitShelfRow}. A card never
 * ends up narrower than this, only wide enough to close the row.
 */
export const SHELF_CARD_WIDTH = 180

export interface ShelfRowFitInput {
  /** The width the cards have to fill — the picture's width, because the shelf
   *  is exactly as wide as the picture (`BelowStreamArea`). */
  readonly contentWidth: number
  /** Space between two cards in the same row. */
  readonly gap: number
  /** No card is drawn narrower than this ({@link SHELF_CARD_WIDTH}). */
  readonly minCardWidth: number
}

export interface ShelfRowFit {
  /** How many cards a row holds. Never below 1. */
  readonly perRow: number
  /** The width to draw each card at. */
  readonly cardWidth: number
}

/**
 * How the wrapping rows fill their width EXACTLY.
 *
 * ## Why a fixed card width could not
 *
 * The cards are a fixed 180pt and they WRAP, so the row closes at whatever
 * multiple of 184 fits and the remainder is dead space on the right — 174pt of
 * it on a 12.9" iPad (a column of 914 holds four 180pt cards and stops at 740).
 * The operator reads that as "the reel does not end where the player ends",
 * and they are right: the picture's right edge and the last card's right edge
 * came from two unrelated numbers. Here they come from one — `contentWidth` is
 * the picture's own width — and the row is closed by widening the cards rather
 * than by padding the container, so the count of cards per row does not change
 * and the shelf keeps the shape it was tuned for.
 *
 * `Math.floor` on the card width, deliberately: the row must never exceed
 * `contentWidth`, because one pixel over is a wrap and a wrap is a whole card
 * dropped to the next row. It leaves at most `perRow - 1` points unused —
 * 2pt on the iPads above, against 174.
 *
 * A degenerate width (a first frame, a collapsed column) yields the shipped
 * fixed card rather than a nonsense one: this is a fit, and there is nothing to
 * fit into yet.
 */
export function fitShelfRow({ contentWidth, gap, minCardWidth }: ShelfRowFitInput): ShelfRowFit {
  if (!Number.isFinite(contentWidth) || contentWidth < minCardWidth) {
    return { perRow: 1, cardWidth: minCardWidth }
  }
  const perRow = Math.max(1, Math.floor((contentWidth + gap) / (minCardWidth + gap)))
  const cardWidth = Math.floor((contentWidth - gap * (perRow - 1)) / perRow)
  return { perRow, cardWidth: Math.max(minCardWidth, cardWidth) }
}
