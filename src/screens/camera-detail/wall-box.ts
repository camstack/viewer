/**
 * wall-box — how big the WALL is drawn, per layout shape, and the portrait
 * column split it changes.
 *
 * ## Why the box is a module and not three ternaries at the mount site
 *
 * The wall goes in the PICTURE's slot (`stream-slot.ts`, index 1 of the
 * timeline column, the player's one parent in every layout). That slot is
 * styled per shape and its child has to agree with it, and the three shapes do
 * not agree by accident:
 *
 *   fill  — the slot is `flex: 1`; the wall takes the window.
 *   wide  — the slot is `flex: 1` and centred; the wall takes the PICTURE's
 *           width, so the reel under it ends exactly where the wall ends.
 *   stack — the slot is `{ width: '100%' }` and is sized BY ITS CHILD. A
 *           `flex: 1` child of an auto-height parent is 0pt tall, which is how
 *           a wall that is mounted, booted and playing draws nothing at all.
 *           Portrait therefore needs an explicit HEIGHT, and that height is the
 *           column split below.
 *
 * One function, one `ViewStyle` per shape, and never a style that omits a
 * property another shape sets — the same discipline `stream-slot.ts` and the
 * screen's animated styles are written under, for the same reason (a property
 * that merely disappears between renders is left stuck on the view).
 *
 * ## The portrait split, and why the wall halves the timeline
 *
 * In portrait with ONE camera the picture is a 16:9 box (`winWidth * 9 / 16`)
 * and the timeline takes the rest. That is the shipped split and nothing here
 * changes it: {@link resolvePortraitColumnSplit} with `wallShowing: false`
 * returns exactly those two numbers.
 *
 * With a WALL up the operator asked for the timeline to give half of its space
 * back: several live cameras in a 16:9 letterbox are postage stamps, and the
 * timeline below is one scroller whose usefulness does not halve with its
 * height. So the split becomes {@link PORTRAIT_WALL_TIMELINE_FRACTION} of the
 * single-camera timeline, and every point it gives up goes to the wall — the
 * two numbers are computed from ONE subtraction, so they cannot drift.
 *
 * This is portrait only. `fill` has no timeline in flow (it rides the edge
 * drawer, floating) and `wide` has the rail, whose height is the window;
 * neither has a split to change, and the operator said so explicitly.
 *
 * ## What "half" is measured against
 *
 * `columnHeight - topInset - pictureHeight`: the portrait column, less the
 * status-bar padding the screen applies to it, less the picture. That remainder
 * is the timeline's space PLUS the toolbar row it shares the column with in
 * `stack` (`toolbarPlacementFor` hoists it above the picture). The toolbar is
 * not subtracted because its height is not a constant — it is scaled chrome —
 * and the only way to know it is to MEASURE the body, which would mean sizing
 * the box above from a measurement taken below it. This screen has shipped that
 * feedback loop twice (1.0.263, 1.0.265) and both times it remounted the
 * player. A modelled half that is stable across every render beats a measured
 * half that oscillates.
 *
 * ## The transition is not animated, on purpose
 *
 * Putting the wall up in portrait grows its box by half the timeline. That
 * change is applied in ONE commit, not eased: on iOS and web the cells live
 * inside the WebView, so animating this container would resize the page's
 * viewport on every frame and each intermediate size makes the page re-run its
 * own fit for every tile. `WorkspaceGrid.tsx` refuses the reflow animation for
 * exactly this reason; this is the same refusal at the box that contains it.
 * A resize is not a remount either way — the element identity is the screen's
 * to keep, and it does (see `CameraDetailScreen`'s `wallStage`).
 *
 * Pure — no React. React-free so vitest covers it directly.
 */
import type { ViewStyle } from 'react-native'

import type { DetailLayoutMode } from './detail-layout.js'

/**
 * What fraction of its single-camera height the portrait timeline keeps once
 * the picture has become a wall.
 *
 * A half, by the operator's call: "in portrait intendo" — the wall gets the
 * other half. Named here rather than written as `* 0.5` at the one site that
 * uses it, because the number is a DECISION about the portrait column and the
 * two constants that govern the tablet column (`STREAM_MAX_HEIGHT_FRACTION`,
 * `SHELF_STRIP_HEIGHT`) are named for the same reason.
 */
export const PORTRAIT_WALL_TIMELINE_FRACTION = 0.5

export interface PortraitColumnSplitInput {
  /** `streamColumnHeight(...)` — the window, less anything drawn under the
   *  camera-detail column (today only the bottom nav bar). */
  readonly columnHeight: number
  /** `useSafeAreaInsets().top`. The screen pads the column by it, so it is not
   *  the column's to split. */
  readonly topInset: number
  /** The PICTURE's portrait height — the 16:9 box, `winWidth * 9 / 16`. The
   *  pinch-grown height is deliberately not used: growing the picture is a
   *  gesture on the picture, and there is no picture while the wall is up. */
  readonly pictureHeight: number
  /** Is the slot showing the WALL rather than the single picture? */
  readonly wallShowing: boolean
}

export interface PortraitColumnSplit {
  /** The height the stream slot's child takes — the picture's, or the wall's. */
  readonly streamHeight: number
  /** What is left below it for the timeline. */
  readonly timelineHeight: number
}

/** Clamp into `[0, max]`, and treat a degenerate input as zero rather than
 *  letting a NaN reach a style. */
function bounded(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return value > max ? max : value
}

/**
 * How the portrait column divides between the stream slot and the timeline.
 *
 * With no wall this is the split that ships: the 16:9 picture, and the rest.
 * With a wall the timeline keeps {@link PORTRAIT_WALL_TIMELINE_FRACTION} of
 * what it had and the wall takes the difference — one subtraction, so
 * "what the timeline gave up" and "what the wall gained" are the same number by
 * construction and no caller can compute a second one.
 */
export function resolvePortraitColumnSplit({
  columnHeight,
  topInset,
  pictureHeight,
  wallShowing,
}: PortraitColumnSplitInput): PortraitColumnSplit {
  const available = bounded(columnHeight - topInset, Number.MAX_SAFE_INTEGER)
  const picture = bounded(pictureHeight, available)
  const singleTimeline = available - picture
  if (!wallShowing) return { streamHeight: picture, timelineHeight: singleTimeline }
  const timelineHeight = singleTimeline * PORTRAIT_WALL_TIMELINE_FRACTION
  return { streamHeight: available - timelineHeight, timelineHeight }
}

export interface WallBoxInput {
  readonly mode: DetailLayoutMode
  /** `computeWideDetailSizes().streamWidth` — the picture's width in `wide`,
   *  and therefore the reel's width under it. */
  readonly wideStreamWidth: number
  /** `resolvePortraitColumnSplit(...).streamHeight`. Only `stack` reads it, and
   *  it is required rather than optional so the caller cannot forget it on the
   *  one shape where omitting it draws a 0pt wall. */
  readonly portraitStreamHeight: number
}

/**
 * The box the wall is drawn in, for a layout shape.
 *
 * Every shape gets an explicit answer — a `switch` over the closed union, so a
 * fourth shape does not compile until it has one. The failure this prevents is
 * silent in exactly the way `stream-slot.ts` describes: a wall with no height
 * is a mounted, booted, playing WebView drawing nothing.
 */
export function wallBoxStyle({
  mode,
  wideStreamWidth,
  portraitStreamHeight,
}: WallBoxInput): ViewStyle {
  switch (mode) {
    case 'fill':
      // The window. The slot is `flex: 1` and the drawer floats over the top.
      return { width: '100%', flex: 1, minHeight: 0 }
    case 'wide':
      // The picture's width, and every point of height the reel does not take.
      return { width: wideStreamWidth, flex: 1, minHeight: 0 }
    case 'stack':
      // Explicit height: the slot is sized by this child. See the docblock.
      return { width: '100%', height: portraitStreamHeight }
  }
}
