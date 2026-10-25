/**
 * The snap arithmetic of `SnapSheet`, pure.
 *
 * The sheet is laid out at its FULL height and slid down with a translateY, so
 * a snap is an offset: 0 at full, `full - half` at half, `full - collapsed` at
 * collapsed. A release rests at the snap nearest to where the sheet would have
 * come to rest after a fling.
 */
export type SheetSnap = 'collapsed' | 'half' | 'full'

export interface SnapHeights {
  readonly collapsed: number
  readonly half: number
  readonly full: number
}

/** Seconds of fling carried into the resting position. */
export const FLING_SECONDS = 0.18

const ORDER: readonly SheetSnap[] = ['collapsed', 'half', 'full']

export function snapOffset(heights: SnapHeights, snap: SheetSnap): number {
  return heights.full - heights[snap]
}

/** The snap a release rests at, given the offset it started from + dragged and the release velocity. */
export function restingSnap(heights: SnapHeights, offset: number, velocityY: number): SheetSnap {
  const projected = offset + velocityY * FLING_SECONDS
  let best: SheetSnap = 'collapsed'
  let bestDistance = Number.POSITIVE_INFINITY
  for (const snap of ORDER) {
    const distance = Math.abs(snapOffset(heights, snap) - projected)
    if (distance < bestDistance) {
      best = snap
      bestDistance = distance
    }
  }
  return best
}

/** A tap on the handle: collapsed -> half -> full -> collapsed. */
export function nextSnap(snap: SheetSnap): SheetSnap {
  const index = ORDER.indexOf(snap)
  return ORDER[(index + 1) % ORDER.length] ?? 'collapsed'
}
