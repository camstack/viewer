/**
 * auto-layout — how N 16:9 tiles fill a box, and WHERE the leftover black goes.
 *
 * ## The block, not just the cell
 *
 * This used to return the cell size alone and leave the arrangement to a
 * `flexWrap` container that spanned the whole content box. That is how two
 * cameras in portrait ended up with a black band BETWEEN them: the wall is a
 * 1×2 block ~440pt tall in a ~780pt box, and a wrap container distributes the
 * leftover 340pt over its LINES — half above, half below each line — so the two
 * cells were pushed to the extremes and the biggest hole was in the middle.
 *
 * The layout now publishes the CONTIGUOUS BLOCK it means (`wallW`/`wallH`,
 * exactly `cols × cellW` by `rows × cellH`). Renderers centre that block and lay
 * it out row by row (`splitIntoRows`), so leftover space is a border and cells
 * always touch. "Maximise the cell, minimise the dispersion" is the whole rule.
 *
 * ## Canonical splits only
 *
 * The candidate set enumerates ROWS and takes `cols = ceil(n / rows)`, keeping
 * only the pairs that are also minimal the other way round (`rows =
 * ceil(n / cols)`). That excludes arrangements like 5 tiles in 4 columns — 4 + 1,
 * the same cell size as 3 + 2 whenever height is the binding constraint, but
 * with a lone tile and a hole beside it. Sparse splits could never WIN on area,
 * yet they could tie, and a tie used to be decided by iteration order.
 *
 * Pure — no React, no I/O (this repo has no renderer to test with).
 */
export interface AutoLayout {
  readonly cols: number
  readonly rows: number
  readonly cellW: number
  readonly cellH: number
  /** Width of the contiguous block of cells the renderer must centre. Equal to
   *  `cols × cellW`, except when a forced column count exceeds the tile count —
   *  then it is what the TILES occupy, so an unfilled column cannot push the
   *  real cells off centre. */
  readonly wallW: number
  /** Height of that block: `rows × cellH`. Never more than the content box, so
   *  the difference is always a border and never a gap. */
  readonly wallH: number
}

const DEFAULT_ASPECT = 16 / 9

const EMPTY: AutoLayout = { cols: 0, rows: 0, cellW: 0, cellH: 0, wallW: 0, wallH: 0 }

/** One candidate arrangement, scored. */
interface Candidate extends AutoLayout {
  /** Slots no tile occupies (`cols × rows − n`) — the tie-breaker. */
  readonly empty: number
}

function candidate(cols: number, rows: number, n: number, w: number, h: number, aspect: number): Candidate {
  const cellW = Math.min(w / cols, (h / rows) * aspect)
  const cellH = cellW / aspect
  return {
    cols,
    rows,
    cellW,
    cellH,
    wallW: Math.min(cols, n) * cellW,
    wallH: rows * cellH,
    empty: cols * rows - n,
  }
}

/** Drop the score — callers get a layout, never the bookkeeping. */
function toLayout(c: Candidate): AutoLayout {
  return { cols: c.cols, rows: c.rows, cellW: c.cellW, cellH: c.cellH, wallW: c.wallW, wallH: c.wallH }
}

/**
 * Pick the arrangement of `n` tiles in `contentW×contentH` that maximises the
 * per-tile area at `aspect` (w/h, default 16:9).
 *
 * Ties are broken toward the TIGHTER wall — fewer unfilled slots first, then
 * fewer rows (a wall is usually read across). Two 16:9 tiles in a 16:9 viewport
 * are the standing example: side by side and stacked give the identical cell, so
 * something has to choose, and iteration order is not a reason.
 */
export function computeAutoLayout(
  n: number,
  contentW: number,
  contentH: number,
  aspect: number = DEFAULT_ASPECT,
): AutoLayout {
  if (n <= 0 || contentW <= 0 || contentH <= 0) return EMPTY
  let best: Candidate | null = null
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows)
    // Not canonical: these `cols` already fit in fewer rows, so this pair only
    // adds empty rows to an arrangement the loop reaches anyway.
    if (Math.ceil(n / cols) !== rows) continue
    const next = candidate(cols, rows, n, contentW, contentH, aspect)
    if (best === null || isBetter(next, best)) best = next
  }
  return best === null ? EMPTY : toLayout(best)
}

/** Relative tolerance for "the same cell area" — two arrangements that differ
 *  only by float noise must be separated by the tie-breakers, not by which one
 *  the loop reached first. */
const AREA_EPSILON = 1e-9

function isBetter(next: Candidate, best: Candidate): boolean {
  const nextArea = next.cellW * next.cellH
  const bestArea = best.cellW * best.cellH
  const scale = Math.max(nextArea, bestArea, 1)
  if (nextArea - bestArea > scale * AREA_EPSILON) return true
  if (bestArea - nextArea > scale * AREA_EPSILON) return false
  if (next.empty !== best.empty) return next.empty < best.empty
  return next.rows < best.rows
}

/** A grid's layout choice: `'auto'` (area-maximizing column split) or a fixed
 *  column count chosen by the user. Kept structural (no store import) so this
 *  module stays dependency-free and unit-testable. */
export type GridLayoutChoice = 'auto' | number

/** Lay out `n` tiles using an explicit layout choice. `'auto'` (or any
 *  non-positive number) delegates to `computeAutoLayout`; a positive number
 *  forces that many columns, sizing each cell to fit the box at `aspect`. */
export function computeGridLayout(
  n: number,
  contentW: number,
  contentH: number,
  layout: GridLayoutChoice = 'auto',
  aspect: number = DEFAULT_ASPECT,
): AutoLayout {
  if (typeof layout !== 'number' || layout < 1) {
    return computeAutoLayout(n, contentW, contentH, aspect)
  }
  if (n <= 0 || contentW <= 0 || contentH <= 0) return EMPTY
  const cols = Math.floor(layout)
  const rows = Math.ceil(n / cols)
  return toLayout(candidate(cols, rows, n, contentW, contentH, aspect))
}

/**
 * Split tiles into the wall's ROWS — `cols` per row, the last one partial.
 *
 * Renderers walk these rows instead of relying on flex wrap. A wrap boundary is
 * decided from float widths at paint time, and the block is now exactly
 * `cols × cellW` wide: a row whose cells total a fraction over that silently
 * wraps its last cell down, and the wall the operator sees stops being the wall
 * the layout computed. Rows also make the partial last row centre on its own,
 * which is where the leftover cell space belongs.
 *
 * A non-positive `cols` (an unmeasured box) yields ONE row rather than looping
 * forever.
 */
export function splitIntoRows<T>(items: readonly T[], cols: number): readonly (readonly T[])[] {
  if (items.length === 0) return []
  const perRow = cols >= 1 ? Math.floor(cols) : items.length
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow))
  return rows
}

// ── The primary's share of the wall ──────────────────────────────────────────

/**
 * How the camera in FIRST position is sized when a wall is drawn for a view the
 * operator built around it.
 *
 * `computeAutoLayout` above produces uniform cells, which is the right answer
 * for a saved grid: nothing there is more important than anything else. A
 * workspace wall is not that — it is the single-camera theater with other
 * cameras joined onto it, and the operator's requirement is that the one they
 * navigated to "deve avere la maggior parte dello spazio se possibile". So the
 * primary is given a SQUARE SPAN of `span × span` tracks and the others fill in
 * around it (`packSpans`, in the embed page).
 *
 * ## The span is only taken when the tiling is EXACT
 *
 * A span that does not tile leaves an unfilled slot somewhere other than the end
 * of the last row — a hole the page cannot centre away, next to live video. So a
 * candidate is accepted only when every track of a `cols × rows` rectangle is
 * covered: the primary's `span × span` block, the `span × (cols − span)` band
 * beside it, and then whole rows of `cols`. Anything else falls back to the
 * uniform wall, which is the wall that ships and is never wrong.
 *
 * ## Two guards, and the second one is why `n = 4` gets nothing
 *
 * A candidate must make the primary strictly BIGGER than the uniform cell — a
 * span that buys nothing is churn — and it must not collapse the others: the
 * non-primary track keeps at least {@link MIN_SECONDARY_AREA_FRACTION} of the
 * area it would have had on the uniform wall. Without that second guard four
 * cameras resolve to a 3×3 primary beside three slivers at a quarter of their
 * uniform size, which is a worse wall by every measure except the primary's.
 *
 * `cols` is part of the answer, not an input, and the caller PINS it on the wall
 * (`GridLayout` as a number). The page packs spans into the column count its own
 * box implies, and the host's box and the page's viewport are not the same
 * rectangle — so a span computed against one column count and packed into
 * another is exactly the hole this function exists to avoid.
 *
 * Pure — no React, no measurement of its own.
 */
export interface PrimaryWallSpan {
  /** Tracks the primary occupies on each side. `1` means no span at all: the
   *  uniform wall, and the caller sends no arrangement. */
  readonly span: number
  /** The column count the wall must use for that span to tile exactly. With
   *  `span === 1` it is simply the area-maximising split. */
  readonly cols: number
  /** Track rows the wall then has. */
  readonly rows: number
}

/**
 * Floor on what a non-primary cell may shrink to, as a fraction of its area on
 * the uniform wall.
 *
 * 0.4, and it is a measured boundary rather than a round number. Across the
 * four box shapes `primary-span.spec.ts` exercises, the exact tilings separate
 * into two families: the useful ones leave the others at 0.44–1.00 of their
 * uniform area, and the degenerate ones — a span of `n − 1` beside a single
 * column of slivers — leave them at 0.25 or less. Anything between 0.30 and
 * 0.43 draws the same line; 0.5 would also reject three cameras on a 16:9
 * tablet (0.44), which is the exact arrangement the operator asked for.
 */
export const MIN_SECONDARY_AREA_FRACTION = 0.4

/** The candidate that means "leave it alone" — the uniform wall, stated in the
 *  same shape so callers have one type to read. */
function uniformSpan(layout: AutoLayout): PrimaryWallSpan {
  return { span: 1, cols: layout.cols, rows: layout.rows }
}

/** A candidate arrangement with the two areas it is chosen by. */
interface SpanCandidate extends PrimaryWallSpan {
  readonly primaryArea: number
  readonly trackArea: number
}

/**
 * Bigger primary first — that is the requirement. Ties (which are common: two
 * column counts often give the identical primary) go to the arrangement that
 * treats the OTHER cameras best, then to the shorter wall. Iteration order is
 * never allowed to decide, for the same reason `isBetter` says so above.
 */
function isBetterSpan(next: SpanCandidate, best: SpanCandidate): boolean {
  const scale = Math.max(next.primaryArea, best.primaryArea, 1)
  if (next.primaryArea - best.primaryArea > scale * AREA_EPSILON) return true
  if (best.primaryArea - next.primaryArea > scale * AREA_EPSILON) return false
  const trackScale = Math.max(next.trackArea, best.trackArea, 1)
  if (next.trackArea - best.trackArea > trackScale * AREA_EPSILON) return true
  if (best.trackArea - next.trackArea > trackScale * AREA_EPSILON) return false
  if (next.rows !== best.rows) return next.rows < best.rows
  return next.cols < best.cols
}

/**
 * The primary's span on a wall of `n` cameras in `contentW × contentH`.
 *
 * Returns `span: 1` whenever no candidate tiles exactly, clears both guards, or
 * the box has not been measured — in which case the caller draws the wall
 * exactly as it ships.
 */
export function resolvePrimaryWallSpan(
  n: number,
  contentW: number,
  contentH: number,
  aspect: number = DEFAULT_ASPECT,
): PrimaryWallSpan {
  const uniform = computeAutoLayout(n, contentW, contentH, aspect)
  if (n < 3 || contentW <= 0 || contentH <= 0 || uniform.cols <= 0) return uniformSpan(uniform)

  const uniformArea = uniform.cellW * uniform.cellH
  const others = n - 1
  let best: SpanCandidate | null = null

  for (let cols = 2; cols <= n; cols++) {
    for (let span = 2; span <= cols; span++) {
      // The band beside the primary, then whole rows. Both have to come out
      // even or the wall has a hole in it.
      const band = span * (cols - span)
      if (others < band) continue
      const rest = others - band
      if (rest % cols !== 0) continue
      const rows = span + rest / cols

      const trackW = Math.min(contentW / cols, (contentH / rows) * aspect)
      const trackArea = (trackW * trackW) / aspect
      const primaryArea = trackArea * span * span
      // Strictly bigger than the cell it replaces, and not at the cost of
      // making the others unwatchable.
      if (primaryArea <= uniformArea) continue
      if (trackArea < uniformArea * MIN_SECONDARY_AREA_FRACTION) continue

      const next: SpanCandidate = { span, cols, rows, primaryArea, trackArea }
      if (best === null || isBetterSpan(next, best)) best = next
    }
  }

  return best === null ? uniformSpan(uniform) : { span: best.span, cols: best.cols, rows: best.rows }
}
