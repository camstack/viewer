/**
 * cluster-band — the horizontal band an event card occupies in the scroller.
 *
 * ## The wasted column
 *
 * The card is placed by an absolute `left` + `width`, and its width was a
 * fraction (`cardWidthFraction`, default 0.6) of the WHOLE body — not of the
 * band that is actually available between the tick-label column on the left and
 * the activity strips on the right. In a full-width portrait timeline that is
 * fine: 60% of 390 leaves a comfortable margin and the layout the operator is
 * happy with.
 *
 * Inside the LANDSCAPE DRAWER it is not. The drawer content is ~258pt, the
 * reserves take 50 on the left and 27 on the right, and 60% of the body leaves
 * the card ending ~99pt short of the drawer edge — a third of the panel, in
 * which nothing renders but the thin activity strips. That is the black column
 * the operator reported: the content does not reach the edge.
 *
 * ## The rule
 *
 * A ROOMY container keeps the fraction — it is a real preference and portrait
 * must not change. A COMPACT one fills the band: there is no spare width to
 * give away, and a card that stops short leaves a strip of background that
 * reads as a rendering fault rather than as breathing room.
 *
 * "Compact" is not a new constant. It is the scale the container already
 * publishes through `timeline-scale-tokens` — `scale < 1` means the container
 * is narrower than the reference phone width, which is exactly and only the
 * drawer. Inventing a second width threshold here would be a second answer to a
 * question that already has one.
 */

export interface ClusterBandInput {
  /** Measured content width of the scroller. */
  readonly scrollWidth: number
  /** Left reserve — the time-label column and its gaps. */
  readonly leftReserve: number
  /** Right reserve — the activity strips and their inset. */
  readonly rightReserve: number
  /** The width the card would like: `cardWidthFraction` × body width. */
  readonly preferredWidth: number
  /** True when the container is narrower than the reference width (the drawer).
   *  Take it from `useTimelineScale().scale < 1` — never re-derive it. */
  readonly compact: boolean
}

export interface ClusterBand {
  /** Absolute left offset for the card. */
  readonly left: number
  /** Card width. Never exceeds the band, never negative. */
  readonly width: number
}

/**
 * Where the card sits and how wide it is.
 *
 * Compact fills the band from the left reserve. Roomy centres the preferred
 * width in the band, which is what the portrait timeline has always done.
 */
export function resolveClusterBand({
  scrollWidth,
  leftReserve,
  rightReserve,
  preferredWidth,
  compact,
}: ClusterBandInput): ClusterBand {
  if (!Number.isFinite(scrollWidth) || scrollWidth <= 0) {
    return { left: leftReserve, width: 0 }
  }
  const band = Math.max(0, scrollWidth - leftReserve - rightReserve)
  if (compact) return { left: leftReserve, width: band }
  const width = Math.max(0, Math.min(band, preferredWidth))
  return { left: leftReserve + (band - width) / 2, width }
}
