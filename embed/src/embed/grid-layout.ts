/**
 * grid-layout — the hosted wall's tile arrangement. MIRRORS the viewer's
 * `src/grid/auto-layout.ts` (the embed is a separate bundle and cannot import
 * it). The two are pinned against each other by
 * `src/grid/__tests__/wall-layout-single-authority.spec.ts`, which RUNS both
 * over the same inputs and requires the same answer — a test is not a bundle,
 * so it may import what this module may not.
 *
 * This used to say the drift was prevented by `__tests__/grid-layout.spec.ts`
 * holding "the same case matrix". Two matrices maintained by hand ARE the
 * drift; extending one of them failed nothing.
 *
 * ## The block, not just the cell
 *
 * This returned the cell size alone and the page laid the tiles out in ONE
 * `flex-wrap` container spanning the viewport. CSS distributes leftover
 * cross-axis space over the flex LINES, so two portrait cameras (a 1×2 block
 * ~440px tall in a ~780px viewport) ended up pushed to the extremes with the
 * biggest black band BETWEEN them — the operator's report.
 *
 * The layout now publishes the CONTIGUOUS BLOCK (`wallW`/`wallH`) and the page
 * centres it, laying out explicit rows (`splitIntoRows`). Leftover space becomes
 * a border; cells always touch.
 *
 * ## The cell the operator resized
 *
 * Everything above assumes one cell size for the whole wall. `resolveWall` at
 * the bottom of this file is the layer that lets ONE camera be bigger, and it is
 * a layer rather than a rewrite on purpose: with no custom span it delegates to
 * `computeTilePlacements` and the wall is value-identical to the one that ships.
 */
export interface GridCellLayout {
  readonly cols: number
  readonly rows: number
  readonly cellW: number
  readonly cellH: number
  /** Width of the contiguous block to centre (`cols × cellW`, or what the tiles
   *  occupy when a forced column count exceeds the tile count). */
  readonly wallW: number
  /** Height of that block (`rows × cellH`) — never more than the box, so the
   *  difference is always a border and never a gap. */
  readonly wallH: number
}

const ASPECT = 16 / 9

const ZERO: GridCellLayout = { cols: 0, rows: 0, cellW: 0, cellH: 0, wallW: 0, wallH: 0 }

interface Candidate extends GridCellLayout {
  /** Slots no tile occupies — the tie-breaker. */
  readonly empty: number
}

function candidate(cols: number, rows: number, n: number, w: number, h: number): Candidate {
  const cellW = Math.min(w / cols, (h / rows) * ASPECT)
  const cellH = cellW / ASPECT
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

function toLayout(c: Candidate): GridCellLayout {
  return { cols: c.cols, rows: c.rows, cellW: c.cellW, cellH: c.cellH, wallW: c.wallW, wallH: c.wallH }
}

const AREA_EPSILON = 1e-9

/** Bigger cells first; on a tie the TIGHTER wall — fewer unfilled slots, then
 *  fewer rows. Two 16:9 tiles in a 16:9 viewport tie exactly, and iteration
 *  order is not a reason to prefer one. */
function isBetter(next: Candidate, best: Candidate): boolean {
  const nextArea = next.cellW * next.cellH
  const bestArea = best.cellW * best.cellH
  const scale = Math.max(nextArea, bestArea, 1)
  if (nextArea - bestArea > scale * AREA_EPSILON) return true
  if (bestArea - nextArea > scale * AREA_EPSILON) return false
  if (next.empty !== best.empty) return next.empty < best.empty
  return next.rows < best.rows
}

/** Lay out n 16:9 tiles in a w×h box. 'auto' maximizes per-tile area over the
 *  CANONICAL splits (no column count wider than the row it fills); a positive
 *  number forces that many columns. */
export function computeGridLayout(
  n: number,
  contentW: number,
  contentH: number,
  layout: 'auto' | number,
): GridCellLayout {
  if (n <= 0 || contentW <= 0 || contentH <= 0) return ZERO

  // `cols` is the REQUESTED column count (it may exceed n); the renderer iterates the actual tiles, so a row simply ends up partially filled — no ghost cells.
  if (typeof layout === 'number' && layout >= 1) {
    const cols = Math.floor(layout)
    return toLayout(candidate(cols, Math.ceil(n / cols), n, contentW, contentH))
  }

  let best: Candidate | null = null
  for (let rows = 1; rows <= n; rows++) {
    const cols = Math.ceil(n / rows)
    // Not canonical: these `cols` already fit in fewer rows, so this pair only
    // adds empty rows to an arrangement the loop reaches anyway.
    if (Math.ceil(n / cols) !== rows) continue
    const next = candidate(cols, rows, n, contentW, contentH)
    if (best === null || isBetter(next, best)) best = next
  }
  return best === null ? ZERO : toLayout(best)
}

/** Split tiles into the wall's ROWS — `cols` per row, the last one partial. The
 *  page walks these instead of relying on `flex-wrap`, whose boundary is a float
 *  comparison at paint time: a row totalling a fraction over the block width
 *  drops its last cell to the next line, and the wall stops being the wall the
 *  layout computed. */
export function splitIntoRows<T>(items: readonly T[], cols: number): readonly T[][] {
  if (items.length === 0) return []
  const perRow = cols >= 1 ? Math.floor(cols) : items.length
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow))
  return rows
}

/** One tile's rectangle inside the wall block, in CSS px. */
export interface TilePlacement {
  readonly deviceId: number
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * The wall as a FLAT list of positioned cells — same geometry as the rows
 * above, without the rows.
 *
 * The rows were a reconciliation trap, not a layout bug: a tile's parent was
 * its row, and the row a camera sits in changes whenever the column count
 * does. React cannot move a child between parents — it unmounts it there and
 * mounts it here — so adding one camera tore down the WebRTC peer of a camera
 * nobody touched. Absolute placement under ONE parent means the worst a
 * device-set change can do to a tile that stays is move its `left`/`top`.
 *
 * `splitIntoRows` stays the authority on which camera is on which row; this
 * only turns that into coordinates, so the two cannot disagree.
 */
export function computeTilePlacements(
  devices: readonly number[],
  grid: GridCellLayout,
): readonly TilePlacement[] {
  if (devices.length === 0 || grid.cellW <= 0 || grid.cellH <= 0) return []
  const placements: TilePlacement[] = []
  const rows = splitIntoRows(devices, grid.cols)
  rows.forEach((row, rowIndex) => {
    // A partial last row centres itself inside the block, exactly as the flex
    // row with `justifyContent: center` did.
    const offsetX = (grid.wallW - row.length * grid.cellW) / 2
    row.forEach((deviceId, colIndex) => {
      placements.push({
        deviceId,
        x: offsetX + colIndex * grid.cellW,
        y: rowIndex * grid.cellH,
        w: grid.cellW,
        h: grid.cellH,
      })
    })
  })
  return placements
}

// ── Per-camera spans ─────────────────────────────────────────────────────────

/**
 * How many TRACKS of the wall's grid one camera occupies.
 *
 * Tracks, never pixels, and never an offset. This is the only geometry the HOST
 * is allowed to express, and the reason is a defect this repo has already paid
 * for: a measured SIZE is independent of the parent it will be placed in, a
 * POSITION is not. The host's box and the page's viewport are not the same
 * rectangle (WebView chrome, and on rotation the host's number is stale before
 * the page's is), so an `x` crossing the bridge is a coordinate in a frame
 * nobody owns. `cw`/`ch` survive a rotation, a resize and a re-fit untouched.
 *
 * `{cw: 1, ch: 1}` is the default and means EXACTLY the wall that ships today.
 */
export interface CellSpan {
  readonly cw: number
  readonly ch: number
}

/** Spans by device id (as a string — a JSON object's keys always are, and the
 *  page reads `spans[String(deviceId)]`, the same shape `overlays` uses). */
export type WallSpans = Readonly<Record<string, CellSpan>>

/** The wall, resolved: the block to centre and where each camera sits in it. */
export interface WallGeometry {
  readonly wallW: number
  readonly wallH: number
  readonly placements: readonly TilePlacement[]
}

const EMPTY_WALL: WallGeometry = { wallW: 0, wallH: 0, placements: [] }

/** A span the wall can act on: whole, at least one track, and no wider than the
 *  wall. A nonsense value resolves to the default rather than dropping the
 *  camera — a wall missing a tile is a worse answer than a wall ignoring a
 *  number it could not read. */
function normalizeSpan(span: CellSpan | undefined, cols: number): CellSpan {
  const cw = span !== undefined && Number.isFinite(span.cw) ? Math.round(span.cw) : 1
  const ch = span !== undefined && Number.isFinite(span.ch) ? Math.round(span.ch) : 1
  return {
    cw: Math.min(Math.max(cw, 1), Math.max(cols, 1)),
    ch: Math.max(ch, 1),
  }
}

/** Does anything here ask for a size that is not the default? Answering no is
 *  what keeps the shipped wall on its own code path. */
export function hasCustomSpans(spans: WallSpans | undefined): boolean {
  if (spans === undefined) return false
  for (const key of Object.keys(spans)) {
    const s = spans[key]
    if (s === undefined) continue
    if (s.cw !== 1 || s.ch !== 1) return true
  }
  return false
}

interface PackedCell {
  readonly deviceId: number
  readonly col: number
  readonly row: number
  readonly cw: number
  readonly ch: number
}

interface PackedWall {
  readonly cells: readonly PackedCell[]
  readonly rows: number
  readonly cols: number
}

/**
 * Place each camera in the FIRST free block that fits it, reading order, in the
 * device list's order.
 *
 * This is the "span + local reflow" policy: a resized cell takes its tracks and
 * the others fill what is left, exactly as they fill the grid today. It is the
 * policy that makes ADDING a camera safe on a wall the operator has arranged —
 * the newcomer drops into a hole, and nobody who was already placed moves
 * because of it. The alternative (recompacting everything on each change) makes
 * one added camera reshuffle live video surfaces the operator deliberately
 * positioned.
 */
function packSpans(devices: readonly number[], spans: WallSpans, cols: number): PackedWall {
  const taken = new Set<string>()
  const cells: PackedCell[] = []
  let rows = 0

  const free = (row: number, col: number, cw: number, ch: number): boolean => {
    for (let r = row; r < row + ch; r++) {
      for (let c = col; c < col + cw; c++) if (taken.has(`${r}:${c}`)) return false
    }
    return true
  }

  for (const deviceId of devices) {
    const { cw, ch } = normalizeSpan(spans[String(deviceId)], cols)
    // A fresh row always fits (`cw <= cols`), so the scan terminates; the bound
    // only keeps a future change from turning a bug into a hang.
    const maxRow = rows + ch + devices.length
    let placed = false
    for (let row = 0; row <= maxRow && !placed; row++) {
      for (let col = 0; col + cw <= cols; col++) {
        if (!free(row, col, cw, ch)) continue
        for (let r = row; r < row + ch; r++) {
          for (let c = col; c < col + cw; c++) taken.add(`${r}:${c}`)
        }
        cells.push({ deviceId, col, row, cw, ch })
        rows = Math.max(rows, row + ch)
        placed = true
        break
      }
    }
  }

  return { cells, rows, cols }
}

/**
 * The wall the page draws: the block and every camera's rectangle in it.
 *
 * With no custom span this IS `computeGridLayout` + `computeTilePlacements`,
 * delegated — including the centred partial last row. With one it switches to
 * the packed grid, where a row is a track row and a partial row is not centred
 * (a spanned cell straddling rows has no row to be centred in, and shifting only
 * some of them would open exactly the gap INSIDE the block that this file's
 * header exists to prevent).
 */
export function resolveWall(
  devices: readonly number[],
  contentW: number,
  contentH: number,
  layout: 'auto' | number,
  spans?: WallSpans,
): WallGeometry {
  const grid = computeGridLayout(devices.length, contentW, contentH, layout)
  if (!hasCustomSpans(spans) || grid.cols <= 0) {
    return {
      wallW: grid.wallW,
      wallH: grid.wallH,
      placements: computeTilePlacements(devices, grid),
    }
  }
  if (devices.length === 0 || contentW <= 0 || contentH <= 0) return EMPTY_WALL

  const packed = packSpans(devices, spans ?? {}, grid.cols)
  if (packed.rows <= 0) return EMPTY_WALL

  // The track keeps the wall's aspect; only the ROW COUNT changed, so the track
  // is re-derived from the same formula rather than reused from `grid` (whose
  // rows assumed one track per camera).
  const trackW = Math.min(contentW / packed.cols, (contentH / packed.rows) * ASPECT)
  const trackH = trackW / ASPECT
  const usedCols = packed.cells.reduce((max, c) => Math.max(max, c.col + c.cw), 0)

  return {
    wallW: usedCols * trackW,
    wallH: packed.rows * trackH,
    placements: packed.cells.map((c) => ({
      deviceId: c.deviceId,
      x: c.col * trackW,
      y: c.row * trackH,
      w: c.cw * trackW,
      h: c.ch * trackH,
    })),
  }
}
