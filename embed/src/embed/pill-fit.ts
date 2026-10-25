/**
 * pill-fit — how the label pill over a gallery thumbnail HOLDS its text.
 *
 * ## What it is for NOW
 *
 * The pill shipped as one line with `text-overflow: ellipsis`, and it first
 * existed to hold a sensor's whole device NAME. It no longer carries one: a
 * name over a 106 px thumbnail wore the picture, so the tile shows the sensor's
 * TYPE and the detail shows the name (`resolveRowTitle`).
 *
 * It is still load-bearing, for the two things the pill DOES carry:
 *
 *  - a TRANSLATED taxonomy label, which is not reliably short —
 *    `Monossido di carbonio` (21 chars), `Sensore movimento`,
 *    `Pacco consegnato`, `Vetro rotto`. A 106 px tile holds ~13 characters per
 *    line at full size, so every one of those clips on one line;
 *  - a tier-2 IDENTITY — a person's full name, a plate read. Same arithmetic.
 *
 * The criterion is unchanged and is the operator's: an ellipsis is exactly the
 * truncation that destroys a distinction, because these strings differ at their
 * TAIL. It is the same defect the admin UI's device list carries a guard against
 * (`name-never-truncates.test.tsx`).
 *
 * ## The rule
 *
 * Preference order, best first:
 *
 *   1. As FEW lines as hold the text, at full size — one for the short titles,
 *      which are the majority (`Anna`, `Auto`, `Contatto`, a plate), up to the
 *      cap. Legibility before density: a label that needs two lines is better
 *      read big on two than small on one, and the pill is absolutely positioned
 *      inside the hero, so extra lines cost image, not card height — the tile
 *      does not grow and the clock below it cannot be pushed out.
 *   2. Only then, the font steps down to a 9 px floor at the line cap. Below
 *      that the text stops being readable at arm's length, so the floor is
 *      where the fit gives up and the CSS clamp becomes the backstop.
 *
 * The line count is a CAP (`-webkit-line-clamp`), not a line count the browser
 * has to use: a title that wraps into one line renders as one line whatever the
 * cap says. So a generous cap costs nothing on a short name, which is why the
 * order spends lines first and font size last.
 *
 * ## Why an ESTIMATE and not a measurement
 *
 * Measuring means a layout pass per card (`getBoundingClientRect` / a canvas
 * `measureText`) on a surface that renders sixty tiles and re-renders them on
 * every poll. The estimate is a pure function of the string and the tile width:
 * testable, deterministic, allocation-free, and wrong in the SAFE direction
 * because the gallery tile is `minmax(cardWidth, 1fr)` — the real tile is never
 * NARROWER than the `heroPx` this is given. The CSS line clamp still bounds the
 * outcome, so a mis-estimate is a pill that used one line more or less than it
 * had to, never a broken layout.
 *
 * The reel deliberately does not use this: its hero is as small as 80 px and its
 * own footer already carries the producing device name at full width.
 */

/** Font size (px) a pill starts at — the size the card has always used. */
export const PILL_FONT_MAX_PX = 11
/** Font size (px) below which the pill stops shrinking. */
export const PILL_FONT_MIN_PX = 9
/**
 * Lines the pill may grow to over the thumbnail.
 *
 * Three, not two, because of the SMALL density: an 80 px tile leaves 60 px of
 * text room, and the longest translated types (`Monossido di carbonio`) do not
 * hold in two lines there at full size. At three they do. It is a cap, so
 * nothing shorter is affected.
 */
export const PILL_MAX_LINES = 3

/** The chip row's own insets inside the hero (`left: 4` + `right: 4`). */
export const PILL_INSET_X_PX = 8
/** The pill's horizontal padding (`padding: '2px 6px'`, both sides). */
export const PILL_PADDING_X_PX = 12
/** Never assume less room than this, however small the tile is reported. */
const MIN_AVAILABLE_PX = 24

/**
 * Mean advance width of one glyph, in em, for the pill's 700-weight system UI
 * font. Latin mixed case measures ~0.52-0.58 em; the upper end is used so the
 * estimate errs towards giving the text MORE room rather than clipping it.
 */
const GLYPH_WIDTH_EM = 0.58

/**
 * How much of a second line is actually usable. Text wraps at word boundaries,
 * so two lines never hold exactly twice one line's characters — the last word
 * of line one is pushed down whole.
 */
const WRAP_PACKING = 0.85

export interface PillFit {
  readonly fontSizePx: number
  readonly maxLines: number
}

/** Estimated rendered width (px) of `text` at `fontSizePx`. Pure. */
export function estimatedTextWidthPx(text: string, fontSizePx: number): number {
  return [...text].length * fontSizePx * GLYPH_WIDTH_EM
}

/** The horizontal room the pill's TEXT has inside a tile of `tileWidthPx`. */
export function pillTextRoomPx(tileWidthPx: number): number {
  return Math.max(MIN_AVAILABLE_PX, tileWidthPx - PILL_INSET_X_PX - PILL_PADDING_X_PX)
}

/**
 * Does `fit` hold the WHOLE of `text` in a tile of `tileWidthPx`?
 *
 * The question the operator actually asked — "does the label fit inside?" — and
 * the one the tests pin: a fit that answers `false` is a pill that will
 * ellipsise, and these strings differ at the TAIL, which is what an ellipsis
 * eats.
 */
export function pillHoldsWholeText(text: string, tileWidthPx: number, fit: PillFit): boolean {
  const room = pillTextRoomPx(tileWidthPx)
  const capacity = fit.maxLines === 1 ? room : room * fit.maxLines * WRAP_PACKING
  return estimatedTextWidthPx(text, fit.fontSizePx) <= capacity
}

/**
 * The pill typography for `text` in a tile of `tileWidthPx`. See the module
 * docblock for the preference order. Total: an unfittable string still gets a
 * legal fit (the floor size at the line cap), it is simply clamped.
 */
export function fitPillText(text: string, tileWidthPx: number): PillFit {
  for (let lines = 1; lines <= PILL_MAX_LINES; lines += 1) {
    const candidate: PillFit = { fontSizePx: PILL_FONT_MAX_PX, maxLines: lines }
    if (pillHoldsWholeText(text, tileWidthPx, candidate)) return candidate
  }
  for (let size = PILL_FONT_MAX_PX - 1; size >= PILL_FONT_MIN_PX; size -= 1) {
    const candidate: PillFit = { fontSizePx: size, maxLines: PILL_MAX_LINES }
    if (pillHoldsWholeText(text, tileWidthPx, candidate)) return candidate
  }
  return { fontSizePx: PILL_FONT_MIN_PX, maxLines: PILL_MAX_LINES }
}
