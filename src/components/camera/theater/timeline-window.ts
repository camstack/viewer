/**
 * timeline-window — WHICH of the timeline's content is mounted.
 *
 * ## What this replaces
 *
 * `TimelineScroller` mounted EVERYTHING the window held: every cluster card of
 * every loaded day, every grid tick, every activity segment. A constant in that
 * file even claimed a margin "kept off-screen cards mounted", describing
 * windowing that did not exist — the comment was corrected in place and the
 * real thing left open in the roadmap, which is where it stayed while the list
 * grew a thirty-day back-scroll and a clips mode on top.
 *
 * The cost is not theoretical. A busy camera-day is ~400 cards, each one a
 * `Pressable` with a decoded 640×360 thumbnail inside it; the ticks at the
 * finest zoom are one element per minute of a window that reaches back thirty
 * days (43 200 of them, all but twenty returning `null` from the renderer AFTER
 * being created); and the live edge advances once a second, which re-positions
 * all of it.
 *
 * ## The two halves
 *
 * WHAT IS MOUNTED is this module: a quantised band around the viewport, and the
 * selection of the items that intersect it. Quantised because `onScroll` fires
 * about sixty times a second and a band recomputed per frame would re-mount the
 * list per frame — trading one storm for another.
 *
 * WHAT MOVES is `layoutAnchorMs` (in `timeline-geometry.ts`): the live-edge
 * anchor snapped to the pixel grid, so a second of wall clock that cannot move
 * a card by a whole pixel does not re-position anything. That is what turns
 * "every card re-renders every second" into "no card re-renders until something
 * actually moves" — the memo upstream stops re-running, so the SAME cluster
 * objects flow down and `ClusterCard`'s own memo holds.
 *
 * Pure: geometry and selection only. No React, no i18n, no measurement.
 */

import { MS_PER_HOUR, pxPerHour } from './timeline-geometry.js'
import { ZOOM_LEVELS, clampZoomIndex } from './mock-data.js'

// ─── The band ─────────────────────────────────────────────────────────

/** A slice of CONTENT space (the scroller's coordinates, spacer excluded). */
export interface MountBand {
  readonly fromPx: number
  readonly toPx: number
}

/**
 * Extra content kept mounted above and below the viewport.
 *
 * Roughly one card plus a comfortable flick: a card scrolled into view has
 * already been mounted (and its thumbnail already asked for) before it can be
 * seen, so the window is invisible in normal use. Too small and a fast drag
 * shows empty space; too large and the whole point is diluted.
 */
export const MOUNT_MARGIN_PX = 320

/**
 * Granularity at which the band moves.
 *
 * The band is a function of the viewport's STEP BUCKET, not of its exact
 * offset, so scrolling within a step does not change it at all and the mounted
 * set is re-selected a handful of times per screen instead of per frame.
 *
 * MUST stay below {@link MOUNT_MARGIN_PX}: the band is computed from the
 * bucket's top edge, so the viewport can sit up to one step lower than the band
 * assumes, and the bottom margin is what absorbs that. `margin >= step` is the
 * invariant that keeps a bucket's worth of scrolling inside the mounted set.
 */
export const MOUNT_STEP_PX = 160

export interface MountBandInput {
  /** Top of the viewport in CONTENT space, spacer already subtracted — the
   *  same coordinates `PositionedCluster.topPx` is in. */
  readonly viewportTopPx: number
  readonly viewportHeightPx: number
  readonly marginPx?: number
  readonly stepPx?: number
}

export function mountBand(input: MountBandInput): MountBand {
  const margin = input.marginPx ?? MOUNT_MARGIN_PX
  const step = Math.max(1, input.stepPx ?? MOUNT_STEP_PX)
  const height = Math.max(0, input.viewportHeightPx)
  // ONE bucket index drives both edges. Snapping each edge to the grid
  // independently was the obvious version and it is worse: the two edges cross
  // their boundaries at different offsets, so the band changes twice as often
  // as it needs to and never at a moment the reader can predict.
  const anchorPx = Math.floor(input.viewportTopPx / step) * step
  return { fromPx: anchorPx - margin, toPx: anchorPx + height + margin }
}

export interface ScrollBandInput {
  /** Last reported scroll offset — possibly for content that no longer exists. */
  readonly offsetY: number
  /** Total scroll content, spacer and bottom inset included. */
  readonly contentHeightPx: number
  readonly viewportHeightPx: number
  /** The spacer above the live edge, which every positioned child is shifted by. */
  readonly topSpacerPx: number
}

/**
 * The band for a scroll position, CLAMPED to the content that exists.
 *
 * The clamp is the whole reason this is a function rather than two lines at the
 * call site. Clips mode swaps a day of pixels for a few hundred: the offset the
 * list was left at no longer exists. The ScrollView clamps itself, but that
 * clamp is not guaranteed to arrive as a scroll event — and a band parked past
 * the end of the new content selects NOTHING, which is a blank timeline that no
 * gesture recovers from. Clamping here also means the band is correct in the
 * same commit the axis changes, so the swap never flashes empty.
 */
export function scrollBand(input: ScrollBandInput): MountBand {
  const maxScrollablePx = Math.max(0, input.contentHeightPx - input.viewportHeightPx)
  const clamped = Math.min(Math.max(0, input.offsetY), maxScrollablePx)
  return mountBand({
    viewportTopPx: clamped - input.topSpacerPx,
    viewportHeightPx: input.viewportHeightPx,
  })
}

/** Whether two bands mount the same thing — the guard on the state write. */
export function bandsEqual(a: MountBand, b: MountBand): boolean {
  return a.fromPx === b.fromPx && a.toPx === b.toPx
}

// ─── Selection ────────────────────────────────────────────────────────

/** Anything the scroller places by absolute offset: a card, a gap marker. */
export interface BandedItem {
  readonly topPx: number
  readonly heightPx: number
}

/**
 * The items that intersect the band, in their original order.
 *
 * Returns the INPUT ARRAY when nothing is dropped. That is not an
 * optimisation of the copy — it is the identity a `useMemo` hands to a memoised
 * child, and a fresh array per render re-renders every card in it.
 */
export function itemsInBand<T extends BandedItem>(
  items: readonly T[],
  band: MountBand,
): readonly T[] {
  const kept = items.filter(
    (item) => item.topPx + item.heightPx >= band.fromPx && item.topPx <= band.toPx,
  )
  return kept.length === items.length ? items : kept
}

/** Same rule for anything placed by TIME rather than by offset (the activity
 *  lanes: recording ranges, motion and audio buckets). */
export function spansInBand<T extends { readonly startMs: number; readonly endMs: number }>(
  spans: readonly T[],
  fromMs: number,
  toMs: number,
): readonly T[] {
  const kept = spans.filter((s) => s.endMs >= fromMs && s.startMs <= toMs)
  return kept.length === spans.length ? spans : kept
}

/**
 * The wall-clock stretch a band covers on the LINEAR axis.
 *
 * Older times are further down, so the band's bottom edge is the OLDER bound.
 * Meaningless on the compressed clips axis — which is why the activity column
 * is not drawn there at all (`hideActivity`).
 */
export function bandEpochRange(
  band: MountBand,
  topMs: number,
  zoomIndex: number,
): { readonly fromMs: number; readonly toMs: number } {
  const pph = pxPerHour(zoomIndex)
  if (pph <= 0) return { fromMs: topMs, toMs: topMs }
  return {
    fromMs: topMs - (band.toPx / pph) * MS_PER_HOUR,
    toMs: topMs - (band.fromPx / pph) * MS_PER_HOUR,
  }
}

// ─── Ticks ────────────────────────────────────────────────────────────

export interface TicksInBandInput {
  /** The layout anchor: offset 0. */
  readonly topMs: number
  readonly zoomIndex: number
  readonly band: MountBand
  /** Oldest loaded moment — the walk never goes past it. */
  readonly oldestMs: number
  /** Height of the spacer above the live edge, in px. Marks inside it are the
   *  immediate FUTURE and are drawn, so the band above `now` is not blank. */
  readonly futurePx: number
}

/**
 * The grid marks a band can actually show.
 *
 * Derived from the band rather than filtered after the fact: the old generator
 * walked the whole loaded window on the zoom's grid and handed every mark to
 * the renderer, which created an element for each and returned `null` for the
 * ones off screen. At the finest zoom over a thirty-day back-scroll that is
 * 43 200 elements to draw twenty.
 */
export function ticksInBand(input: TicksInBandInput): readonly number[] {
  const pph = pxPerHour(input.zoomIndex)
  if (pph <= 0) return []
  const stepMs = ZOOM_LEVELS[clampZoomIndex(input.zoomIndex)].rowMinutes * 60_000
  if (stepMs <= 0) return []

  // px → epoch, on the same mapping `epochToOffset` inverts.
  const epochAt = (px: number): number => input.topMs - (px / pph) * MS_PER_HOUR
  // The band's newest edge, never above the future band the spacer can show.
  const newestMs = Math.min(epochAt(input.band.fromPx), epochAt(-Math.max(0, input.futurePx)))
  const oldestMs = Math.max(input.oldestMs, epochAt(input.band.toPx))
  if (newestMs < oldestMs) return []

  const ticks: number[] = []
  for (let tick = Math.floor(newestMs / stepMs) * stepMs; tick >= oldestMs; tick -= stepMs) {
    ticks.push(tick)
  }
  return ticks
}
