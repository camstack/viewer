/**
 * events-reel-geometry — how big a REEL card is, decided from the box the reel
 * was given.
 *
 * On a phone the strip is the host's reserved band (`reelRowHeightPx`) and the
 * card is the operator's preset (60 / 80 / 106): the band was sized FROM that
 * preset, so nothing here may move it. That is the mobile behaviour and it is
 * kept verbatim below {@link REEL_FIT_MIN_WIDTH_PX}.
 *
 * On a desktop-wide box the preset alone left the preview short of the width:
 * fixed-size tiles stop wherever the arithmetic happens to land, the last one
 * cut by the edge, and a tall frame (a dashboard iframe, the standalone page)
 * kept 106 px cards in a corner of a 1920 px box. So the edge is computed:
 *
 *   1. the HEIGHT bound — the largest square hero whose card fits `rows` times
 *      in the box, never below the preset (a band reserved for the preset
 *      already fits it) and never above {@link REEL_MAX_EDGE_PX};
 *   2. the WIDTH fit — the fewest whole columns that cover the width without
 *      exceeding that bound, each stretched so the columns end exactly at the
 *      right edge.
 *
 * Pure: the page passes what it measured.
 */

/** The list's own `contentContainer` paddingVertical (SPACING.sm), top AND bottom. */
export const REEL_LIST_PADDING_V = 4

/** Below this box width the reel keeps the preset — a phone or a narrow
 *  WebView band, whose host sized the strip from that very preset. */
export const REEL_FIT_MIN_WIDTH_PX = 768

/** Largest card edge, CSS px. Twice the large preset: the media plane clamps a
 *  thumbnail at 320 physical px, so a bigger tile is only an upscale. */
export const REEL_MAX_EDGE_PX = 212

export interface ReelGeometryInput {
  /** The scroller's `clientWidth` (padding included), CSS px. 0 = not measured. */
  readonly viewportWidth: number
  /** The scroller's `clientHeight` (padding included), CSS px. 0 = not measured. */
  readonly viewportHeight: number
  /** Stacked rows of the strip. */
  readonly rows: number
  /** The operator's preset edge (`cardEdgePx(thumbSize)`). */
  readonly presetEdge: number
  /** Gap between cards, px. */
  readonly gap: number
  /** The scroller's left padding, px (where the first column starts). */
  readonly padX: number
}

export interface ReelGeometry {
  /** Square hero edge = card width, CSS px. */
  readonly edge: number
  /** Whole card height (hero only — time overlays the image), CSS px. */
  readonly cardHeight: number
}

function presetGeometry(presetEdge: number): ReelGeometry {
  return { edge: presetEdge, cardHeight: presetEdge }
}

/** The card edge for a reel laid out in the measured box. See the module doc. */
export function reelCardGeometry(input: ReelGeometryInput): ReelGeometry {
  const { viewportWidth, viewportHeight, presetEdge, gap, padX } = input
  const rows = Math.max(1, Math.floor(input.rows))
  if (viewportWidth < REEL_FIT_MIN_WIDTH_PX || viewportHeight <= 0) {
    return presetGeometry(presetEdge)
  }

  const innerWidth = viewportWidth - padX - gap
  const innerHeight = viewportHeight - REEL_LIST_PADDING_V * 2
  const fitsHeight = Math.floor((innerHeight - (rows - 1) * gap) / rows)
  const bound = Math.max(presetEdge, Math.min(fitsHeight, REEL_MAX_EDGE_PX))
  if (innerWidth <= bound) return presetGeometry(presetEdge)

  const columns = Math.max(1, Math.ceil((innerWidth + gap) / (bound + gap)))
  const edge = Math.floor(((innerWidth - (columns - 1) * gap) / columns) * 100) / 100
  return { edge, cardHeight: edge }
}
