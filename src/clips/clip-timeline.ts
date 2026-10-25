/**
 * clip-timeline — the RIBBON: clips laid out one after another, with the dead
 * time between them collapsed into a marker instead of drawn to scale.
 *
 * ## The problem this solves
 *
 * A camera that records on events produces four minutes of footage across a
 * fourteen-hour night. Drawn to scale, those four minutes are a hairline and the
 * operator scrolls past hours of nothing to reach the next one — which is the
 * whole reason the theater timeline, which IS to scale, is the wrong surface for
 * "show me what happened, in order".
 *
 * The naive fix — concatenate the clips and drop the gaps — is worse: it tells
 * the operator a lie about time. Two clips five seconds apart and two clips five
 * hours apart look identical, and nothing on screen says which is which.
 *
 * So the ribbon keeps BOTH: clips are proportional to each other, and every hole
 * between them becomes an explicit, fixed-height ELLIPSIS row carrying the
 * duration it swallowed ("⋯ 2h 14m"). The jump is visible; the scrolling is not
 * dominated by it.
 *
 * ## Why all of it is pure
 *
 * Every value here is geometry — offsets, heights, the epoch under a finger, the
 * moment to jump to the next clip. None of it can be asserted by mounting a
 * component at a size the test environment does not have. This module is where
 * the clip surface is actually verified; the components are the thin part.
 */

import type { Clip } from './clip-model.js'
import { clipDurationMs } from './clip-model.js'

// ── Options ──────────────────────────────────────────────────────────────────

export interface ClipRibbonOptions {
  /** Pixels per millisecond of CLIP time. Gaps do not use it — that is the point. */
  readonly pxPerMs: number
  /** Floor for a clip segment, so a two-second clip is still a tap target. */
  readonly minClipPx: number
  /** Ceiling, so one long clip cannot become the whole scroll. */
  readonly maxClipPx: number
  /** Fixed height of a collapsed-gap row. Constant by design: a gap's SIZE must
   *  carry no information, or the collapse has smuggled the scale back in. */
  readonly gapPx: number
  /** Holes shorter than this are not marked at all — the clips simply abut.
   *  Recorder segments land a few hundred ms apart; a marker for each would be
   *  noise claiming to be a jump. */
  readonly minGapMs: number
}

/** Sane ribbon geometry for a phone column. Callers scale from here. */
export const DEFAULT_RIBBON_OPTIONS: ClipRibbonOptions = {
  // 12s of clip ≈ 100px — dense enough to see several clips, coarse enough that
  // a 30s clip is still one readable block.
  pxPerMs: 100 / 12_000,
  minClipPx: 44,
  maxClipPx: 320,
  gapPx: 34,
  minGapMs: 2_000,
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export interface ClipRow {
  readonly kind: 'clip'
  readonly clip: Clip
  /** Index into {@link ClipRibbonLayout.clips} — the ONE ordering everything uses. */
  readonly index: number
  readonly offsetPx: number
  readonly heightPx: number
}

export interface GapRow {
  readonly kind: 'gap'
  /** End of the footage before the hole. */
  readonly fromMs: number
  /** Start of the footage after it. */
  readonly toMs: number
  readonly durationMs: number
  readonly offsetPx: number
  readonly heightPx: number
}

export type RibbonRow = ClipRow | GapRow

export interface ClipRibbonLayout {
  /** Rows in scroll order: clip, [gap], clip, … */
  readonly rows: readonly RibbonRow[]
  /** The normalised, sorted clips the rows were built from. A caller that
   *  indexes clips MUST use this list, not its own — two orderings that
   *  disagree is how a "tap segment 3, play segment 4" bug is born. */
  readonly clips: readonly Clip[]
  readonly totalPx: number
  /** Time actually collapsed away, summed. Drives the ribbon's header hint. */
  readonly collapsedMs: number
}

export const EMPTY_RIBBON: ClipRibbonLayout = {
  rows: [],
  clips: [],
  totalPx: 0,
  collapsedMs: 0,
}

// ── Normalisation ────────────────────────────────────────────────────────────

/**
 * Sort clips into ribbon order and drop the ones that cannot be drawn.
 *
 * Deterministic to the last tie: start, then end, then id. Two sources can emit
 * a clip covering the same instant, and an unstable order would reshuffle the
 * ribbon under the operator on every refetch.
 */
export function normalizeClips(clips: readonly Clip[]): readonly Clip[] {
  return [...clips]
    .filter((c) => Number.isFinite(c.startMs) && Number.isFinite(c.endMs) && c.endMs > c.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || (a.clipId < b.clipId ? -1 : a.clipId > b.clipId ? 1 : 0))
}

// ── Layout ───────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** The clip rows only, in ribbon order. */
export function clipRows(layout: ClipRibbonLayout): readonly ClipRow[] {
  return layout.rows.filter((r): r is ClipRow => r.kind === 'clip')
}

// ── Time ↔ pixel ─────────────────────────────────────────────────────────────

/** What sits at a point on the ribbon. */
export type RibbonPoint =
  | { readonly kind: 'clip'; readonly row: ClipRow; readonly epochMs: number }
  | { readonly kind: 'gap'; readonly row: GapRow }

/**
 * The row a wall-clock epoch belongs to, and the exact moment inside it.
 *
 * The FIRST clip row containing the epoch wins. With overlapping sources some
 * instants genuinely belong to two clips; picking deterministically (ribbon
 * order) is what keeps the playhead from flickering between them.
 */
export function pointAtEpoch(layout: ClipRibbonLayout, epochMs: number): RibbonPoint | null {
  if (layout.rows.length === 0) return null
  for (const row of layout.rows) {
    if (row.kind === 'clip' && epochMs >= row.clip.startMs && epochMs < row.clip.endMs) {
      return { kind: 'clip', row, epochMs }
    }
  }
  for (const row of layout.rows) {
    if (row.kind === 'gap' && epochMs >= row.fromMs && epochMs < row.toMs) {
      return { kind: 'gap', row }
    }
  }
  return null
}

/**
 * Scroll offset of an epoch.
 *
 * Inside a clip the position is proportional to the clip's own segment; inside a
 * collapsed gap it is the marker's CENTRE — the gap has no scale, so every
 * moment in it is the same place, which is exactly what the ellipsis says.
 * Before the first clip → 0; after the last → the ribbon's end. Null only when
 * there is no ribbon at all.
 */
export function pxForEpoch(layout: ClipRibbonLayout, epochMs: number): number | null {
  if (layout.rows.length === 0) return null
  const point = pointAtEpoch(layout, epochMs)
  if (point === null) {
    const first = layout.clips[0]
    return epochMs < first.startMs ? 0 : layout.totalPx
  }
  if (point.kind === 'gap') return point.row.offsetPx + point.row.heightPx / 2
  const { row } = point
  const duration = clipDurationMs(row.clip)
  if (duration <= 0) return row.offsetPx
  const fraction = (epochMs - row.clip.startMs) / duration
  return row.offsetPx + fraction * row.heightPx
}

/**
 * What a finger at `px` is pointing at — the inverse of {@link pxForEpoch},
 * used for tap-to-play and for dragging the ribbon's playhead.
 *
 * A point inside a gap resolves to the gap, NOT to a time: there is no footage
 * to seek to there, and returning an epoch would let a drag commit a seek into
 * nothing (the "no footage" state the theater timeline has to recover from).
 */
export function pointAtPx(layout: ClipRibbonLayout, px: number): RibbonPoint | null {
  if (layout.rows.length === 0) return null
  const clamped = clamp(px, 0, Math.max(0, layout.totalPx - 1))
  for (const row of layout.rows) {
    if (clamped >= row.offsetPx && clamped < row.offsetPx + row.heightPx) {
      if (row.kind === 'gap') return { kind: 'gap', row }
      const duration = clipDurationMs(row.clip)
      const fraction = row.heightPx > 0 ? (clamped - row.offsetPx) / row.heightPx : 0
      return { kind: 'clip', row, epochMs: Math.round(row.clip.startMs + fraction * duration) }
    }
  }
  // Past the last row's edge (px === totalPx after clamping a 0-height ribbon).
  const last = layout.rows[layout.rows.length - 1]
  return last.kind === 'clip'
    ? { kind: 'clip', row: last, epochMs: last.clip.endMs }
    : { kind: 'gap', row: last }
}

// ── Sequencing: playing "without holes" ──────────────────────────────────────

/**
 * The decision the player loop makes on every position report.
 *
 * `advance` is the whole feature: the operator asked for clips that follow one
 * another with no dead air, so reaching the end of a clip is not "stop", it is
 * "seek to the next clip's start".
 */
export type ClipAdvance =
  | { readonly kind: 'hold' }
  | { readonly kind: 'advance'; readonly clip: Clip; readonly index: number }
  | { readonly kind: 'finished' }

export interface ClipAdvanceInput {
  readonly layout: ClipRibbonLayout
  /** The clip currently playing. Null → nothing to advance from. */
  readonly currentClipId: string | null
  /** Last reported playhead epoch. Null → the player has not reported yet. */
  readonly playheadMs: number | null
  /**
   * How far before a clip's end counts as "at the end".
   *
   * Not cosmetic: the recorded read path is addressable at fragment boundaries,
   * so the last reported position of a clip lands somewhere inside the final
   * fragment and a strict `>= endMs` test never fires — the playback would
   * simply run on into the hole the ribbon exists to skip.
   */
  readonly endGuardMs: number
  /**
   * How far PAST a clip's end a report may land and still mean "we reached the
   * end". Defaults to {@link DEFAULT_OVERSHOOT_MS}.
   *
   * A different quantity from {@link ClipAdvanceInput.endGuardMs}, which is
   * about FRAGMENTS (the read path is addressable at fragment boundaries, so
   * the last position inside a clip lands short of `endMs`). This one is about
   * REPORTS: the server pushes the playhead at roughly 1 Hz in playback, so
   * using the same 400ms on both sides left an 800ms window that a 1 Hz sample
   * straddles most of the time — the clip then ran on into the hole the ribbon
   * exists to skip, and every later report was further past the end, so the
   * sequencer never recovered.
   */
  readonly overshootMs?: number
}

export const DEFAULT_END_GUARD_MS = 400

/** Two position reports at the server's ~1 Hz playback cadence. Past this, a
 *  playhead is not overshooting a clip — it belongs to something else. */
export const DEFAULT_OVERSHOOT_MS = 2_000

/** Whether to keep playing, jump to the next clip, or stop at the ribbon's end. */
export function resolveClipAdvance(input: ClipAdvanceInput): ClipAdvance {
  const { layout, currentClipId, playheadMs, endGuardMs } = input
  const overshootMs = input.overshootMs ?? DEFAULT_OVERSHOOT_MS
  if (currentClipId === null || playheadMs === null) return { kind: 'hold' }
  const index = layout.clips.findIndex((c) => c.clipId === currentClipId)
  if (index < 0) return { kind: 'hold' }
  const current = layout.clips[index]
  // BOUNDED ON BOTH SIDES. "We reached the end" is a statement about a playhead
  // that is INSIDE this clip; a playhead outside it is describing something
  // else entirely and must move nothing.
  //
  // With only the lower bound, a playhead hours past the end was
  // indistinguishable from one at the end. That became reachable the day a
  // cluster tap started entering recorded playback from LIVE: the embed keeps
  // reporting live positions until the recorded feeder lands, `reconcilePosition`
  // drops two stragglers and ADOPTS the third, so the playhead is ≈ now. Every
  // clip in the ribbon then read as "finished" in turn and the surface cascaded
  // to its newest one — the operator taps a clip and lands on a later one.
  //
  // The upper bound is the OVERSHOOT, not the end guard: they measure different
  // things (fragments vs reports) and using one number for both left an 800ms
  // window that the ~1 Hz report cadence straddles most of the time, which is a
  // clip that quietly ran on into the hole instead of advancing.
  if (playheadMs < current.startMs) return { kind: 'hold' }
  if (playheadMs > current.endMs + overshootMs) return { kind: 'hold' }
  if (playheadMs < current.endMs - endGuardMs) return { kind: 'hold' }
  const next = layout.clips[index + 1]
  return next === undefined ? { kind: 'finished' } : { kind: 'advance', clip: next, index: index + 1 }
}

/** The clip at `index`, or null — bounds-checked so callers never index blind. */
export function clipAt(layout: ClipRibbonLayout, index: number): Clip | null {
  return layout.clips[index] ?? null
}

/** The first clip starting at or after `epochMs` — where "jump to this time"
 *  lands when the moment itself is inside a collapsed gap. */
export function firstClipFrom(layout: ClipRibbonLayout, epochMs: number): Clip | null {
  return layout.clips.find((c) => c.endMs > epochMs) ?? null
}

// ── Auto-follow ──────────────────────────────────────────────────────────────

/**
 * Where the ribbon should be scrolled so the playhead is visible.
 *
 * Anchored ABOVE centre (default 0.4) rather than at it: what the operator wants
 * to see while a clip plays is what is coming, and a centred playhead spends
 * half the viewport on footage already watched.
 */
export function scrollOffsetForPx(
  playheadPx: number,
  viewportPx: number,
  totalPx: number,
  anchorFraction = 0.4,
): number {
  if (viewportPx <= 0) return 0
  const maxOffset = Math.max(0, totalPx - viewportPx)
  return clamp(playheadPx - viewportPx * anchorFraction, 0, maxOffset)
}

// ── Gap labels ───────────────────────────────────────────────────────────────

/** The glyph the collapsed-gap row leads with. */
export const GAP_ELLIPSIS = '⋯'

export interface DurationParts {
  readonly days: number
  readonly hours: number
  readonly minutes: number
  readonly seconds: number
}

/** Whole-unit decomposition of a duration. Negative input reads as zero. */
export function decomposeDuration(ms: number): DurationParts {
  const total = Math.max(0, Math.floor(ms / 1000))
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  }
}

/** Unit suffixes, so the label is translatable without this module knowing i18n. */
export interface DurationUnitLabels {
  readonly d: string
  readonly h: string
  readonly m: string
  readonly s: string
}

export const DEFAULT_DURATION_UNITS: DurationUnitLabels = { d: 'd', h: 'h', m: 'm', s: 's' }

/**
 * Compact duration for a gap marker: the two most significant non-zero units.
 *
 * "2h 14m", "3d 5h", "45m 12s", "8s". Two units, never three — the marker is a
 * fixed-height row and a third unit is precision nobody reads at a glance.
 * A sub-second hole (which the ribbon does not mark anyway) reads "0s" rather
 * than an empty string, so a label can never render blank.
 */
export function formatGapLabel(ms: number, units: DurationUnitLabels = DEFAULT_DURATION_UNITS): string {
  const { days, hours, minutes, seconds } = decomposeDuration(ms)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}${units.d}`)
  if (hours > 0) parts.push(`${hours}${units.h}`)
  if (minutes > 0) parts.push(`${minutes}${units.m}`)
  if (seconds > 0) parts.push(`${seconds}${units.s}`)
  if (parts.length === 0) return `0${units.s}`
  return parts.slice(0, 2).join(' ')
}
