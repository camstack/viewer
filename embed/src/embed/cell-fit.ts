/**
 * cell-fit — the picture inside a cell that is no longer the picture's shape.
 *
 * ## Why this did not need to exist before
 *
 * `computeGridLayout` sizes every cell as `cellH = cellW / ASPECT`, so a tile's
 * box WAS the video's box and "fit" was not a question anyone had to answer.
 * Per-camera spans end that: two tracks wide by one tall is 32:9, one by two is
 * 16:18, and something has to decide what the 16:9 stream does in there.
 *
 * The operator decided: the cell is free, the picture keeps its own proportions
 * inside it, the leftover becomes bands, and nothing is cut. So this returns the
 * INSCRIBED box — the largest rectangle of the picture's aspect that fits, and
 * centred — and never a box larger than the cell.
 *
 * `object-fit: cover` is the tempting alternative and it is the defect: it also
 * fills the cell, it also looks right at a glance, and it quietly crops the
 * sides off every wide cell. The whole reason this is a function with a spec is
 * that the wrong answer is invisible.
 *
 * Pure — no DOM, no React.
 */

/**
 * The aspect the wall assumes for every stream, and the same one
 * `grid-layout.ts` sizes its tracks with. One constant rather than two, so a
 * cell and the picture inside it cannot disagree about what 16:9 means.
 *
 * It is an ASSUMPTION, not a measurement: the real track ratio is unknown until
 * a frame decodes, and the wall has always been laid out before that. A camera
 * that is genuinely not 16:9 therefore gets bands from its own player as well —
 * which is the same outcome it has today, inside a cell that was 16:9.
 */
export const VIDEO_ASPECT = 16 / 9

/** The picture's box inside its cell, in the cell's own coordinates (CSS px). */
export interface FittedBox {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

const EMPTY: FittedBox = { left: 0, top: 0, width: 0, height: 0 }

/**
 * Below this the leftover is rounding, not a band.
 *
 * `(w / ASPECT) * ASPECT` misses `w` by ~1e-13, so a default 1×1 cell would
 * otherwise come back with a fractional offset and a width a hair under its
 * own. That is not a visible band — it is a sub-pixel translate on a live video
 * layer on every tile of every wall, on a path whose whole promise is that an
 * untouched wall is bit-identical to the one that shipped.
 */
const BAND_EPSILON_PX = 0.5

/**
 * Inscribe an `aspect`-shaped picture in a `cellW × cellH` cell, centred.
 *
 * A degenerate cell fits nothing (rather than a negative box that CSS would
 * render as an overflow), and a nonsense aspect falls back to filling the cell —
 * the caller passing 0 has no shape to preserve, and vanishing the picture would
 * be a worse answer than stretching it.
 */
export function fitInside(cellW: number, cellH: number, aspect: number): FittedBox {
  if (!(cellW > 0) || !(cellH > 0)) return EMPTY
  const full: FittedBox = { left: 0, top: 0, width: cellW, height: cellH }
  if (!(aspect > 0) || !Number.isFinite(aspect)) return full

  const width = Math.min(cellW, cellH * aspect)
  const height = width / aspect
  if (cellW - width < BAND_EPSILON_PX && cellH - height < BAND_EPSILON_PX) return full

  return {
    left: (cellW - width) / 2,
    top: (cellH - height) / 2,
    width,
    height,
  }
}
