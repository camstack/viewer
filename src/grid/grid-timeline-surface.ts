/**
 * grid-timeline-surface — where the grid page puts THE timeline, and the box
 * the wall keeps once the timeline is its parent.
 *
 * ## What this replaced
 *
 * The grid page used to carry a timeline of its own (`components/grid/
 * GridTimeline.tsx` plus `grid/timeline/*`, deleted 2026-09-02): a 152 pt band
 * of per-camera lanes with its own window, its own zoom, its own playhead store
 * and its own placement gate. It answered a different question from the
 * theater's — "which cameras are lit right now" rather than "what happened" —
 * and the two were never going to converge by accident.
 *
 * The grid page now mounts `TheaterTimeline`, scoped to the grid's cameras. Two
 * decisions of the old gate survive here because they were about the SURFACE,
 * not about that component:
 *
 *  1. **A phone gets no timeline on this page.** The wall is what the operator
 *     opened, and 152 pt (or a rail) off a 430 pt-wide window is most of it.
 *     The old gate asked `min(width,height) >= TABLET_MIN_SIDE`; this asks
 *     {@link isTabletViewport}, which is the SAME constant read off the device
 *     screen when there is one — one definition of tablet, and the one the
 *     theater's own layout already uses.
 *  2. **Landscape docks the chrome as a right rail, portrait as a band below.**
 *     That is exactly `resolveDetailLayoutMode`'s `wide` / `stack`, so the grid
 *     page does not decide it a second time: it asks the same function the
 *     theater asks and gets the same answer for the same window.
 *
 * The old gate's third decision — a HEIGHT floor (`GRID_TIMELINE_MIN_HEIGHT`,
 * 480 pt) below which the band was not worth its cost — is deliberately NOT
 * carried over. It existed because the band was a fixed 152 pt subtracted from
 * the wall; the theater's chrome in `stack` takes what {@link gridWallSlotStyle}
 * leaves it, which is a fraction, so a short window shrinks both instead of
 * starving one.
 *
 * Pure — no React, no react-native runtime import (the style is a plain object
 * typed as `ViewStyle`, exactly like `theater/stream-slot.ts`).
 */
import type { ViewStyle } from 'react-native'

import { isTabletViewport, type ViewportInput } from '../hooks/sidebar-rules.js'
import type { DetailLayoutMode } from '../screens/camera-detail/detail-layout.js'

/**
 * Does the grid page lay out a timeline at all?
 *
 * A phone is excluded in BOTH orientations, which is the guarantee "il telefono
 * non cambia in nulla" is asserted through: with this false the page renders
 * exactly the tree it rendered before the timeline existed, and no batched
 * timeline read is issued at all.
 */
export function shouldMountGridTimeline(input: ViewportInput): boolean {
  return isTabletViewport(input)
}

/**
 * Fraction of the timeline column's height the WALL keeps in `stack`.
 *
 * Only `stack` needs a number: in `wide` the wall and the rail are siblings in
 * a row and the wall simply takes what the rail does not (`flex: 1`), and
 * `fill` is unreachable from this page (no fullscreen flag, and a tablet in
 * landscape resolves to `wide`).
 *
 * 0.62 rather than a fresh guess: it is `STREAM_MAX_HEIGHT_FRACTION`, the split
 * the theater already uses between its picture and what sits under it. One
 * proportion for "picture over chrome" on both surfaces.
 */
export const GRID_WALL_STACK_FRACTION = 0.62

/**
 * The style for the wall inside `TheaterTimeline`'s stream slot.
 *
 * The slot itself is `stream-slot.ts`'s, and it is deliberately not enough on
 * its own: in `wide` it carries `alignItems: 'center'` (it was written for a
 * fixed-width picture), and in `stack` it has no height at all — a wall dropped
 * into either measures zero on one axis and draws nothing. The theater's player
 * supplies its own box for the same reason; this is the wall's.
 *
 * `height` is a number the caller computes from the box it measured, so this
 * stays pure and the one viewport read lives in the component.
 */
export function gridWallSlotStyle(
  shape: DetailLayoutMode,
  stackHeight: number,
  chromeHidden = false,
): ViewStyle {
  // Chrome off — the wall takes the whole surface in every shape. `stack` is
  // the one that would otherwise get this wrong: its box is a FIXED fraction of
  // the window ({@link GRID_WALL_STACK_FRACTION}), so without this the wall
  // would keep 62% of the height and the other 38% would be blank.
  if (chromeHidden) return { flex: 1, minHeight: 0, minWidth: 0, width: '100%' }
  switch (shape) {
    case 'wide':
      return { flex: 1, minWidth: 0, width: '100%' }
    case 'stack':
      return { width: '100%', height: stackHeight }
    case 'fill':
      return { flex: 1, minHeight: 0, width: '100%' }
  }
}

/**
 * The wall's box, as a marker — `full` when the timeline's chrome is hidden and
 * the wall has the whole surface, `shared` when the chrome is drawn beside or
 * under it.
 *
 * Published because the difference is entirely in the STYLE, and
 * `react-native-web` compiles styles into class names a mount test cannot read.
 * It rides the SAME View across a toggle, so a spec can assert the box changed
 * and the player node under it did not (`toBe`) in one breath — which is the
 * whole claim: the wall reflowed, nothing remounted.
 */
export const GRID_WALL_SLOT_TEST_ID: Readonly<Record<'shared' | 'full', string>> = {
  shared: 'grid-wall-slot',
  full: 'grid-wall-slot-full',
}

/** The wall's height in `stack`, from the height the page measured. */
export function gridWallStackHeight(availableHeight: number): number {
  if (!(availableHeight > 0)) return 0
  return Math.round(availableHeight * GRID_WALL_STACK_FRACTION)
}
