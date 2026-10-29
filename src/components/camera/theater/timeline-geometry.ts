import { ZOOM_LEVELS, TIMELINE_ROW_HEIGHT, clampZoomIndex } from './mock-data.js'

export const MS_PER_HOUR = 3_600_000

/** Vertical pixels that represent one hour at the given zoom level. */
export function pxPerHour(zoomIndex: number): number {
  const level = ZOOM_LEVELS[clampZoomIndex(zoomIndex)]
  return (60 / level.rowMinutes) * TIMELINE_ROW_HEIGHT
}

/**
 * Wall-clock time one vertical pixel is worth at a zoom level.
 *
 * The quantum the drawn geometry is snapped to — see {@link layoutAnchorMs}.
 */
export function msPerPixel(zoomIndex: number): number {
  const pph = pxPerHour(zoomIndex)
  return pph > 0 ? MS_PER_HOUR / pph : 0
}

/**
 * The LAYOUT anchor: `nowMs` snapped down to the pixel grid.
 *
 * Every card is positioned from the live edge, and the live edge advances once
 * a second — so `clusterByZoom` re-ran and re-minted every cluster object every
 * second, and each new object defeats `ClusterCard`'s memo. At every zoom this
 * repo offers, a second of wall clock is a FRACTION OF A PIXEL: the work bought
 * nothing that could be seen.
 *
 * Snapping the anchor to the pixel grid makes the re-layout happen exactly when
 * it moves something — and never otherwise. The clustering itself is unaffected
 * by construction: absorption compares `px − anchorPx`, a DIFFERENCE, in which
 * the anchor cancels.
 *
 * Only DRAWN geometry uses it. The scroll↔time mapping and the live-edge
 * decision keep real `now`, because their tolerance is measured in seconds and
 * must not inherit a pixel's worth of slack. The two therefore disagree by less
 * than one pixel, which `timeline-window.spec.ts` asserts as a bound.
 */
export function layoutAnchorMs(nowMs: number, zoomIndex: number): number {
  const quantum = msPerPixel(zoomIndex)
  if (!Number.isFinite(quantum) || quantum <= 0) return nowMs
  return Math.floor(nowMs / quantum) * quantum
}

/** Scroll offset (px from the top; 0 = live edge `topMs`) → epoch ms.
 *  Scrolling down (larger offset) goes back in time. */
export function offsetToEpoch(offsetY: number, topMs: number, zoomIndex: number): number {
  const hours = offsetY / pxPerHour(zoomIndex)
  return Math.round(topMs - hours * MS_PER_HOUR)
}

/** Inverse of offsetToEpoch; clamped to >= 0 (the live edge). */
export function epochToOffset(epochMs: number, topMs: number, zoomIndex: number): number {
  const hours = (topMs - epochMs) / MS_PER_HOUR
  return Math.max(0, hours * pxPerHour(zoomIndex))
}

/**
 * Optional replacement for the linear hour scale. Clips mode injects a
 * compressed visit axis so scrub, auto-follow, and card `topPx` cannot disagree.
 */
export interface TimelineEpochMap {
  readonly epochToOffset: (epochMs: number) => number
  readonly offsetToEpoch: (offsetY: number) => number
  readonly contentSpanPx: number
}

export function mappedEpochToOffset(
  epochMs: number,
  topMs: number,
  zoomIndex: number,
  map: TimelineEpochMap | null | undefined,
): number {
  return map ? map.epochToOffset(epochMs) : epochToOffset(epochMs, topMs, zoomIndex)
}

export function mappedOffsetToEpoch(
  offsetY: number,
  topMs: number,
  zoomIndex: number,
  map: TimelineEpochMap | null | undefined,
): number {
  return map ? map.offsetToEpoch(offsetY) : offsetToEpoch(offsetY, topMs, zoomIndex)
}

export interface TimelineLayoutOriginInput {
  readonly indicatorOffsetPx: number
  /** Lane-header room. Sizes the scroll content only; it never moves time. */
  readonly contentTopInset: number
}

/**
 * Content-space y of the live edge: the top spacer. The scrub reads the
 * playhead as `offsetToEpoch(scrollY)` with the playhead at viewport
 * `indicatorOffsetPx`, so an epoch `e` must be drawn at
 * `epochToOffset(e) + indicatorOffsetPx` — nothing else may be added.
 */
export function timelineLayoutOriginPx(input: TimelineLayoutOriginInput): number {
  return input.indicatorOffsetPx
}

/** Content-space y of an epoch (unclamped: future epochs land above the origin). */
export function epochToContentY(
  epochMs: number,
  topMs: number,
  zoomIndex: number,
  originPx: number,
  map: TimelineEpochMap | null | undefined,
): number {
  return map
    ? map.epochToOffset(epochMs) + originPx
    : ((topMs - epochMs) / MS_PER_HOUR) * pxPerHour(zoomIndex) + originPx
}
