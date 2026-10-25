import { dayBounds } from '../../../lib/local-day.js'

/**
 * Static mock data for the Theater Timeline (DUMMY, no fetching).
 *
 * These pure, deterministic generators feed the presentational theater
 * components (HeatmapBar, the vertical timeline list) until the real server
 * wiring lands. NOTHING here touches the network, react-query, or any cap.
 *
 * When wiring the server later, replace these generators with adapters that
 * produce the SAME shapes:
 *  - `HeatmapBin[]`   ← per-bin motion/audio density + recorded coverage,
 *  - `TimelineRow[]`  ← newest-first rows with positioned activity bars.
 */

// ─── Public shapes ──────────────────────────────────────────────────

/** One half-hour bin of the 24h activity heatmap strip. */
export interface HeatmapBin {
  /** Motion intensity, normalized 0..1. */
  readonly motion: number
  /** Object-detection intensity, normalized 0..1. */
  readonly detection: number
  /** Dominant detection-class color for the detection lane, when any. */
  readonly detectionColor?: string
  /** Audio intensity, normalized 0..1. */
  readonly audio: number
  /** Whether this bin falls inside a recorded segment. */
  readonly recorded: boolean
}

export type TimelineBarKind = 'motion' | 'audio'

/**
 * The set of activity classes currently shown. Empty/all-on both mean "show
 * everything"; a partial set hides the deselected kinds in heatmap + rows.
 */
export type ActivityFilter = ReadonlySet<TimelineBarKind>

/** Every selectable activity class, in display order. */
export const ALL_BAR_KINDS: readonly TimelineBarKind[] = ['motion', 'audio']

/** A single positioned activity bar inside a timeline row's track. */
export interface TimelineBar {
  /** Horizontal start position within the track, 0..1. */
  readonly offsetFrac: number
  /** Width within the track, 0..1. */
  readonly widthFrac: number
  /** Visual intensity, 0..1 (drives opacity). */
  readonly intensity: number
  readonly kind: TimelineBarKind
}

/** One vertical row of the scrollable timeline (newest-first). */
export interface TimelineRow {
  /** Stable key for list virtualization. */
  readonly id: string
  /** Absolute tick epoch in milliseconds (encoded in id as `row-${tickMs}`). */
  readonly tickMs: number
  /** Left-edge time label, e.g. "19:20". */
  readonly hourLabel: string
  /** Whether this label sits on a full hour (vs a sub-hour tick). */
  readonly isFullHour: boolean
  /** Activity bars mapped across the row's track. */
  readonly bars: readonly TimelineBar[]
}

// ─── Tunables ───────────────────────────────────────────────────────

/** 48 half-hour bins cover a full 24h day. */
export const HEATMAP_BINS = 48

const MINUTES_PER_HOUR = 60

/**
 * Vertical-list zoom levels, WIDEST RANGE → NARROWEST (minutes covered by one
 * row, and the wall-clock stretch that fills one span).
 *
 * The operator picks a RANGE, not a density: the footer offers 15m · 30m · 1h ·
 * 3h · 6h · 12h and the row granularity comes along with it. That replaced a
 * (−)/(+) pair that stepped an unnamed "level" — two controls for one setting,
 * whose current value could only be inferred from how tall the rows looked.
 *
 * The index ordering is unchanged (higher index = finer scale), because every
 * geometry helper in `timeline-geometry.ts` and every scroll mapping is written
 * against it. The SELECTOR lists them shortest-range-first via
 * {@link zoomIndicesByRange} — the ladder's internal order is not an operator
 * fact. Auto zoom's floor is the tightest rung (15m).
 *
 * Default open stays 30m (index 4): the 15m rung is available from the menu and
 * from Auto when the scrub is slow, but opening there is denser than the
 * operator asked to land on.
 */
export interface ZoomLevelSpec {
  /** Minutes covered by a single row at this zoom. */
  readonly rowMinutes: number
  /** Hours covered by one span (newest-first) at this zoom. Sub-hour ranges are
   *  fractional — 0.5 is the 30-minute range, 0.25 is 15 minutes. */
  readonly spanHours: number
}

export const ZOOM_LEVELS: readonly ZoomLevelSpec[] = [
  { rowMinutes: 30, spanHours: 12 }, // 0 — widest range
  { rowMinutes: 15, spanHours: 6 },
  { rowMinutes: 5, spanHours: 3 },
  { rowMinutes: 2, spanHours: 1 },
  { rowMinutes: 1, spanHours: 0.5 }, // 4 — default open (30m)
  { rowMinutes: 1, spanHours: 0.25 }, // 5 — tightest (15m); Auto floor
]

/**
 * Default zoom index — the **30m** range (1-minute rows).
 *
 * Was 3 (1h) and before that 2 (3h / legacy 5-minute rows). Opening on a wider
 * span buries the thing that just happened; half an hour is what the operator
 * asked to land on. The 15m rung is index 5 — Auto may reach it; the default
 * open does not.
 */
export const DEFAULT_ZOOM_INDEX = 4

/** Clamp an arbitrary integer into a valid zoom index. */
export function clampZoomIndex(index: number): number {
  if (index < 0) return 0
  if (index > ZOOM_LEVELS.length - 1) return ZOOM_LEVELS.length - 1
  return Math.floor(index)
}

/** A zoom level's RANGE as the control says it: a number and its unit. Kept
 *  structured rather than a formatted string so the "30m"/"12h" rendering stays
 *  in i18n and this module stays pure. */
export interface ZoomSpanLabel {
  readonly value: number
  readonly unit: 'minutes' | 'hours'
}

/**
 * The range a zoom level shows, as the button reports it.
 *
 * The active value must be legible WITHOUT opening the selector — that is the
 * whole reason the two stepper buttons became one. Sub-hour ranges read in
 * minutes so the ladder is `15m · 30m · 1h · 3h · 6h · 12h` rather than
 * `0.25h` / `0.5h`.
 */
export function zoomSpanLabel(zoomIndex: number): ZoomSpanLabel {
  const { spanHours } = ZOOM_LEVELS[clampZoomIndex(zoomIndex)]
  return spanHours < 1
    ? { value: Math.round(spanHours * MINUTES_PER_HOUR), unit: 'minutes' }
    : { value: spanHours, unit: 'hours' }
}

/**
 * Zoom indices ordered by RANGE, shortest → longest — the order the selector
 * lists them in.
 *
 * Derived by sorting on `spanHours` rather than by reversing the array: the
 * ladder's coarsest-first order is an implementation detail of the geometry
 * helpers, and a selector that silently inherits it would flip the moment a
 * level is inserted out of order.
 */
export function zoomIndicesByRange(): readonly number[] {
  return ZOOM_LEVELS.map((_, index) => index).sort(
    (a, b) => ZOOM_LEVELS[a].spanHours - ZOOM_LEVELS[b].spanHours,
  )
}

/** Representative bins with notable activity (index → motion/audio). */
const SEEDED_BINS: Readonly<Record<number, { motion: number; audio: number }>> = {
  14: { motion: 0.35, audio: 0 }, // ~07:00
  16: { motion: 0.7, audio: 0.2 }, // ~08:00
  17: { motion: 0.9, audio: 0.5 }, // ~08:30
  24: { motion: 0.45, audio: 0 }, // ~12:00
  30: { motion: 0.6, audio: 0.15 }, // ~15:00
  36: { motion: 0.85, audio: 0.7 }, // ~18:00
  37: { motion: 1, audio: 0.9 }, // ~18:30
  38: { motion: 0.75, audio: 0.4 }, // ~19:00
  39: { motion: 0.55, audio: 0.25 }, // ~19:30
  40: { motion: 0.3, audio: 0 }, // ~20:00
}

/** Recorded coverage runs from ~06:00 (bin 12) to "now". */
const RECORDED_FROM_BIN = 12

// ─── Generators ─────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Build the 48-bin activity heatmap for "today".
 *
 * Deterministic given `nowMs` (no Date.now/Math.random at module scope). The
 * recorded backdrop covers from `RECORDED_FROM_BIN` up to the bin containing
 * `nowMs`; seeded bins carry representative motion/audio intensity.
 *
 * The strip now always spans the FULL calendar day (the bins are flex-laid
 * across the whole 24h width), so bins AFTER `nowBin` are the FUTURE: they carry
 * no activity and no coverage. Bounding motion/audio here (not just `recorded`)
 * keeps the bar chart from painting phantom activity to the right of the live
 * cursor — it stops exactly at "now".
 */
export function buildHeatmapBins(nowMs: number): readonly HeatmapBin[] {
  const { startMs, endMs } = dayBounds(nowMs)
  const span = endMs - startMs
  const nowFrac = span > 0 ? (nowMs - startMs) / span : 0
  const nowBin = Math.min(HEATMAP_BINS - 1, Math.floor(nowFrac * HEATMAP_BINS))

  return Array.from({ length: HEATMAP_BINS }, (_, i): HeatmapBin => {
    // Future bins (right of the live edge) have nothing to show yet.
    const seed = i <= nowBin ? SEEDED_BINS[i] : undefined
    return {
      motion: seed ? seed.motion : 0,
      detection: 0,
      audio: seed ? seed.audio : 0,
      recorded: i >= RECORDED_FROM_BIN && i <= nowBin,
    }
  })
}

/**
 * The fraction (0..1) of the day elapsed at `nowMs` — drives the heatmap cursor.
 */
export function heatmapCursorFraction(nowMs: number): number {
  const { startMs, endMs } = dayBounds(nowMs)
  const span = endMs - startMs
  if (span <= 0) return 0
  return Math.min(1, Math.max(0, (nowMs - startMs) / span))
}

/** Deterministic pseudo-bar pattern for a given minute-of-day. */
function barsForMinute(minuteOfDay: number): readonly TimelineBar[] {
  // Pure, repeatable hash → 0..1 (no Math.random).
  const h = (minuteOfDay * 2654435761) % 1000
  const r = h / 1000
  if (r < 0.45) return [] // many quiet rows
  const bars: TimelineBar[] = [
    {
      offsetFrac: 0.05 + r * 0.4,
      widthFrac: 0.18 + r * 0.25,
      intensity: 0.4 + r * 0.6,
      kind: 'motion',
    },
  ]
  if (r > 0.78) {
    bars.push({
      offsetFrac: 0.55 + (r - 0.78) * 0.8,
      widthFrac: 0.1 + r * 0.12,
      intensity: 0.5 + (r - 0.78) * 2,
      kind: 'audio',
    })
  }
  return bars
}

/**
 * Snap a millisecond instant DOWN to the nearest row-granularity tick for the
 * given zoom. This is the timestamp of the newest (top) row — the "live edge".
 *
 * Pure & deterministic.
 */
export function snapTopTickMs(nowMs: number, zoomIndex: number): number {
  const { rowMinutes } = ZOOM_LEVELS[clampZoomIndex(zoomIndex)]
  const top = new Date(nowMs)
  const snappedMin = Math.floor(top.getMinutes() / rowMinutes) * rowMinutes
  top.setMinutes(snappedMin, 0, 0)
  return top.getTime()
}

/** Number of rows that fill one visible span at the given zoom. */
export function rowsPerSpan(zoomIndex: number): number {
  const { rowMinutes, spanHours } = ZOOM_LEVELS[clampZoomIndex(zoomIndex)]
  return Math.round((spanHours * MINUTES_PER_HOUR) / rowMinutes)
}

/** Build a single row for an absolute snapped tick at the given zoom. */
function rowForTick(tickMs: number): TimelineRow {
  const t = new Date(tickMs)
  const hh = t.getHours()
  const mm = t.getMinutes()
  const minuteOfDay = hh * MINUTES_PER_HOUR + mm
  return {
    // Tick-based id is globally unique across days — required so that
    // paginated older rows never collide with the seed window's ids.
    id: `row-${tickMs}`,
    tickMs,
    hourLabel: `${pad2(hh)}:${pad2(mm)}`,
    isFullHour: mm === 0,
    bars: barsForMinute(minuteOfDay),
  }
}

/**
 * Build the newest-first vertical timeline rows for a given zoom level.
 *
 * Row granularity (minutes-per-row) and visible span both come from
 * `ZOOM_LEVELS[zoomIndex]`: zooming IN yields a finer, denser, narrower window;
 * zooming OUT a coarser, wider one. Rows on a full hour are flagged
 * `isFullHour` so the UI can render a stronger gridline + bolder label.
 *
 * Pure & deterministic given (`nowMs`, `zoomIndex`).
 */
export function buildTimelineRowsAtZoom(nowMs: number, zoomIndex: number): readonly TimelineRow[] {
  const { rowMinutes } = ZOOM_LEVELS[clampZoomIndex(zoomIndex)]
  const top = snapTopTickMs(nowMs, zoomIndex)
  const stepMs = rowMinutes * 60_000
  const rowCount = rowsPerSpan(zoomIndex)
  return Array.from({ length: rowCount }, (_, i): TimelineRow =>
    rowForTick(top - i * stepMs),
  )
}

/**
 * Build one PAGE of older timeline rows for infinite scrolling.
 *
 * Pages are deterministic, contiguous, fixed-size blocks stepping BACK in time
 * from the live edge (`snapTopTickMs(nowMs, zoomIndex)`):
 *  - page 0 is the seed window (newest-first), identical to
 *    `buildTimelineRowsAtZoom` when `pageRows === rowsPerSpan(zoomIndex)`;
 *  - page N starts exactly one row below where page N-1 ended, so concatenating
 *    consecutive pages yields a gap-free, strictly-older sequence with no
 *    duplicate ids (ids are absolute-tick based).
 *
 * `pageRows` controls the block size (defaults to one visible span). Pure &
 * deterministic given (`nowMs`, `zoomIndex`, `pageIndex`, `pageRows`).
 */
export function buildTimelineRowsPage(
  nowMs: number,
  zoomIndex: number,
  pageIndex: number,
  pageRows: number = rowsPerSpan(zoomIndex),
): readonly TimelineRow[] {
  const { rowMinutes } = ZOOM_LEVELS[clampZoomIndex(zoomIndex)]
  const stepMs = rowMinutes * 60_000
  const top = snapTopTickMs(nowMs, zoomIndex)
  const page = Math.max(0, Math.floor(pageIndex))
  const size = Math.max(1, Math.floor(pageRows))
  const startRow = page * size
  return Array.from({ length: size }, (_, i): TimelineRow =>
    rowForTick(top - (startRow + i) * stepMs),
  )
}

/**
 * Newest-first vertical timeline rows at the default zoom (legacy 5-min / 6h).
 * Thin wrapper kept for back-compat; prefer `buildTimelineRowsAtZoom`.
 */
export function buildTimelineRows(nowMs: number): readonly TimelineRow[] {
  return buildTimelineRowsAtZoom(nowMs, DEFAULT_ZOOM_INDEX)
}

// ─── Filtering (pure) ───────────────────────────────────────────────

/** True when the filter shows everything (empty set or all kinds selected). */
export function isFilterAll(filter: ActivityFilter): boolean {
  return filter.size === 0 || filter.size >= ALL_BAR_KINDS.length
}

/**
 * Drop timeline bars whose `kind` is not in `filter`. Returns the same array
 * reference when nothing is filtered, and new immutable rows otherwise.
 */
export function filterTimelineRows(
  rows: readonly TimelineRow[],
  filter: ActivityFilter,
): readonly TimelineRow[] {
  if (isFilterAll(filter)) return rows
  return rows.map((row): TimelineRow => ({
    ...row,
    bars: row.bars.filter((bar) => filter.has(bar.kind)),
  }))
}

/**
 * Zero out heatmap intensities for deselected kinds (and clear `recorded` rows
 * left with no activity is intentionally kept — recording coverage is not a
 * filterable activity class). Returns the same reference when nothing changes.
 */
export function filterHeatmapBins(
  bins: readonly HeatmapBin[],
  filter: ActivityFilter,
): readonly HeatmapBin[] {
  if (isFilterAll(filter)) return bins
  const showMotion = filter.has('motion')
  const showAudio = filter.has('audio')
  return bins.map((bin): HeatmapBin => ({
    ...bin,
    motion: showMotion ? bin.motion : 0,
    detection: showMotion ? bin.detection : 0,
    audio: showAudio ? bin.audio : 0,
  }))
}

/** Fixed pixel height of one vertical timeline row. */
export const TIMELINE_ROW_HEIGHT = 34
