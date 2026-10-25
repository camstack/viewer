/**
 * poster-fit — how the "last known frame" still is fitted to its box.
 *
 * ## The jump this removes
 *
 * The poster and the video it precedes are drawn into the SAME box, but they
 * were fitted differently, so the picture visibly re-framed the moment the
 * first decoded frame arrived.
 *
 * In the portrait stack the box is a true 16:9 area, the video covers it, and
 * `cover` on a 16:9 source is a no-op — the two agreed and nobody noticed. In
 * `fill` (landscape / fullscreen) the box is the WHOLE WINDOW: on a 932×430
 * phone that is ~2.17:1. The video letterboxes inside it (the embed
 * object-contains itself), but the poster was hard-coded `contentFit="cover"`,
 * so the 16:9 still was blown up and cropped to full bleed. When the stream
 * started, that full-bleed crop cross-faded into a letterboxed 16:9 picture —
 * the "jump to the right size" the operator reported.
 *
 * ## The rule
 *
 * The poster is fitted to match what the VIDEO will do in the same box, and the
 * box is the only thing that decides. A box already at the source's aspect can
 * `cover` (identical result, no letterbox seams from rounding); a box that is
 * not must `contain`, because the video will.
 *
 * Deciding from the measured box rather than from a `fill` flag means every
 * caller is covered by construction — the grid tile, the embed, the detail
 * screen — including any future box nobody remembers to pass a prop to.
 */

/** The stream aspect every CamStack surface lays out for. */
export const STREAM_ASPECT = 16 / 9

/**
 * Tolerance on the box's aspect before it stops counting as "already 16:9".
 *
 * Generous on purpose: a 16:9 box rounded to whole points is off by a fraction
 * of a percent, and flipping such a box to `contain` would introduce hairline
 * letterbox bars where there is nothing to letterbox. 0.05 covers rounding and
 * a point or two of border while still catching every genuinely wrong shape —
 * the full-window landscape case is 2.17 against 1.78, off by 0.39.
 */
export const ASPECT_TOLERANCE = 0.05

export type PosterFit = 'cover' | 'contain'

/**
 * Fit for a poster drawn into a box of `width` × `height`.
 *
 * An unmeasured box (0 or a non-finite dimension) yields `cover`: that is the
 * historical behaviour and the correct one for the aspect-true boxes that make
 * up the common path, so a poster shown for the one frame before layout lands
 * never flashes letterboxed.
 */
export function resolvePosterFit(width: number, height: number): PosterFit {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'cover'
  }
  return Math.abs(width / height - STREAM_ASPECT) > ASPECT_TOLERANCE ? 'contain' : 'cover'
}
