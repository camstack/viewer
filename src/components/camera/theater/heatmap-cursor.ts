/**
 * heatmap-cursor — the geometry of the current-moment marker on the 24h tape.
 *
 * The strip is one NVR tape (recording hairline in the top overshoot, audio
 * peaks from the tape top, motion-or-class fill at the bottom). The marker
 * still overshoots the TAPE at both ends and is capped there — hour labels
 * sit below, so they are not part of the silhouette the marker has to break.
 *
 * The overshoot is paid for in the CONTAINER, not with negative insets.
 * `heatmapCursorGeometry` is the single source for all of it.
 */

/** Height of the recording/motion tape (the activity band). */
export const HEATMAP_TAPE_HEIGHT_PX = 28

/** Hour labels `00 / 06 / 12 / 18` under the tape. */
export const HEATMAP_HOUR_LABELS_HEIGHT_PX = 14

/** Hours marked under the tape. */
export const HEATMAP_HOUR_MARKS = [0, 6, 12, 18] as const

/** Alias: the activity band IS the tape. */
export const HEATMAP_BAND_HEIGHT_PX = HEATMAP_TAPE_HEIGHT_PX

/**
 * How far the marker escapes the tape, at each end.
 *
 * Four: enough that the break in the silhouette is unmistakable at arm's length,
 * small enough that the strip does not turn into a second toolbar.
 */
export const HEATMAP_CURSOR_OVERSHOOT_PX = 4

/** The marker's stem — as thin as the ticks it must be told apart from. */
export const HEATMAP_CURSOR_STEM_WIDTH_PX = 2

/**
 * The end caps, drawn in the overshoot at both ends.
 *
 * WIDER than the stem and wider than any tick on the strip: this is the feature
 * that has no counterpart anywhere else on the band, so it is what the eye
 * actually locks onto.
 */
export const HEATMAP_CURSOR_CAP_WIDTH_PX = 7
export const HEATMAP_CURSOR_CAP_HEIGHT_PX = 3

/**
 * A legibility halo behind the stem, one pixel proud on each side.
 *
 * Not "brighter" — an OUTLINE. Over a dense region it separates the stem from
 * whatever it is crossing; over an empty region it is nearly invisible and the
 * stem carries itself.
 */
export const HEATMAP_CURSOR_HALO_PAD_PX = 1

export interface HeatmapCursorGeometry {
  /** Total height of the strip container: overshoots + tape + hour labels. */
  readonly stripHeightPx: number
  /** Inset applied to the TAPE so the marker keeps its own overshoot. */
  readonly bandInsetPx: number
  /** Height of the marker itself — tape + both overshoots, not the labels. */
  readonly markerHeightPx: number
  readonly stemWidthPx: number
  readonly haloWidthPx: number
  readonly capWidthPx: number
  readonly capHeightPx: number
  /** Horizontal shift that centres the marker on its fraction. */
  readonly centeringOffsetPx: number
}

/** The one place the marker's numbers are related to each other. Pure. */
export function heatmapCursorGeometry(): HeatmapCursorGeometry {
  const markerHeightPx = HEATMAP_BAND_HEIGHT_PX + 2 * HEATMAP_CURSOR_OVERSHOOT_PX
  return {
    stripHeightPx: markerHeightPx + HEATMAP_HOUR_LABELS_HEIGHT_PX,
    bandInsetPx: HEATMAP_CURSOR_OVERSHOOT_PX,
    markerHeightPx,
    stemWidthPx: HEATMAP_CURSOR_STEM_WIDTH_PX,
    haloWidthPx: HEATMAP_CURSOR_STEM_WIDTH_PX + 2 * HEATMAP_CURSOR_HALO_PAD_PX,
    capWidthPx: HEATMAP_CURSOR_CAP_WIDTH_PX,
    capHeightPx: HEATMAP_CURSOR_CAP_HEIGHT_PX,
    centeringOffsetPx: -HEATMAP_CURSOR_CAP_WIDTH_PX / 2,
  }
}
