/**
 * export-selection — the arithmetic behind "save this stretch of the recording".
 *
 * In recorded playback the operator arms a selection at the playhead, scrubs to
 * the other end and saves. Two facts make this worth a module of its own rather
 * than a couple of expressions at the call site:
 *
 *  1. The drag runs in EITHER direction. The anchor is where the operator
 *     started, and the free end may land before it (the common case — they are
 *     looking for something that already happened) or after it ("from two hours
 *     ago until one hour ago"). `{ fromMs: anchor, toMs: current }` would hand
 *     the hub a negative interval half the time. Nothing downstream would say
 *     so: `createExport` takes two numbers and the recorder would render
 *     nothing.
 *  2. The selected stretch may cross a HOLE in the footage. The operator has to
 *     be told, because an export that is silently a third as long as the range
 *     they drew is indistinguishable from a broken export.
 *
 * Pure — no React, no hub. `recordingKnownAt` (`recording-availability.ts`)
 * answers the same question for ONE instant; this answers it for a RANGE, and
 * keeps its rule: an empty coverage array is `unknown`, never `absent`.
 */
import type { TimeRange } from '../timeline/coverage.js'

/** A normalised, ordered selection. `fromMs <= toMs` always. */
export interface ExportSelectionRange {
  readonly fromMs: number
  readonly toMs: number
  readonly durationMs: number
}

/**
 * The shortest stretch worth rendering.
 *
 * A tap that does not move still produces a selection (anchor === current), and
 * without a floor the operator would queue a zero-length job on the hub every
 * time they armed the mode and changed their mind. One second, not zero: the
 * recorder works in GOPs and sub-second ranges are a request for one frame,
 * which is what the snapshot button is for.
 */
export const MIN_EXPORT_SELECTION_MS = 1_000

/**
 * The stream profile a timeline selection is exported at.
 *
 * `high` on purpose and not the tier the PLAYER happens to be on: the player
 * drops to `low` during a scrub by design (`recorded-track-session.ts` pins it
 * for the drag), so exporting "what I was looking at" would silently produce
 * the worst copy the hub holds — of footage the operator is keeping.
 */
export const EXPORT_SELECTION_PROFILE = 'high'

/**
 * How long the hub keeps a file exported from a timeline selection.
 *
 * Seven days. `maxLifeMs` is required and must be positive (the cap's Zod
 * refuses zero), so there is no "keep forever" to fall back on and a number has
 * to be chosen: long enough that an operator who saved a period on Sunday still
 * has it the following weekend, short enough that a drawer full of forgotten
 * selections does not fill the footage disk.
 */
export const EXPORT_SELECTION_LIFE_MS = 7 * 24 * 60 * 60 * 1_000

/**
 * Fold the anchor and the moving end into an ordered range, clamped at the live
 * edge.
 *
 * `null` when either end is missing (no anchor armed, or a live playhead that
 * has no epoch) — the caller has nothing to save and nothing to draw.
 *
 * `liveEdgeMs` is the machine's own notion of now — the wall-clock the live
 * indicator is drawn from when `playhead === null`. It is a CLAMP and not a
 * validation: the heatmap maps a fraction of the whole DAY window onto an
 * epoch, so a tap or a forward drag past the now-line names a moment that has
 * not happened yet. Ordering alone would carry that moment into `createExport`
 * as `toMs`, and the hub would be asked to render footage from the future — the
 * export comes back short with nothing on this side able to say why.
 */
export function resolveExportSelection(
  anchorMs: number | null,
  currentMs: number | null,
  liveEdgeMs: number,
): ExportSelectionRange | null {
  if (anchorMs === null || currentMs === null) return null
  const anchor = Math.min(anchorMs, liveEdgeMs)
  const current = Math.min(currentMs, liveEdgeMs)
  const fromMs = Math.min(anchor, current)
  const toMs = Math.max(anchor, current)
  return { fromMs, toMs, durationMs: toMs - fromMs }
}

/** Whether a range may be sent to `createExport` at all. */
export function isSavableSelection(range: ExportSelectionRange | null): boolean {
  return range !== null && range.durationMs >= MIN_EXPORT_SELECTION_MS
}

/**
 * What the footage under a selection looks like.
 *
 *   • `covered` — every instant of the range is inside recorded coverage.
 *   • `partial` — some of it is, some is not: the export will be shorter than
 *     the range, and the operator is told before it is queued.
 *   • `absent`  — none of it is. There is nothing to render.
 *   • `unknown` — the coverage read cannot answer: it is empty (still loading,
 *     failed, or genuinely nothing — indistinguishable), or the range reaches
 *     outside the window that was queried. Never blocks a save; see D315 and
 *     `recordingKnownAt`.
 */
export type SelectionCoverage = 'covered' | 'partial' | 'absent' | 'unknown'

/** How much of the selection has NO recorded coverage, in ms. */
export function missingMsInSelection(
  coverage: readonly TimeRange[],
  range: ExportSelectionRange,
): number {
  return range.durationMs - coveredMsInSelection(coverage, range)
}

function coveredMsInSelection(
  coverage: readonly TimeRange[],
  range: ExportSelectionRange,
): number {
  let covered = 0
  for (const r of coverage) {
    const a = Math.max(r.startMs, range.fromMs)
    const b = Math.min(r.endMs, range.toMs)
    if (b > a) covered += b - a
  }
  return covered
}

export function selectionCoverage(
  coverage: readonly TimeRange[],
  windowFromMs: number,
  windowToMs: number,
  range: ExportSelectionRange,
): SelectionCoverage {
  if (coverage.length === 0) return 'unknown'
  if (range.fromMs < windowFromMs || range.toMs > windowToMs) return 'unknown'
  const covered = coveredMsInSelection(coverage, range)
  if (covered <= 0) return 'absent'
  return covered >= range.durationMs ? 'covered' : 'partial'
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * `m:ss`, growing to `h:mm:ss` past the hour.
 *
 * The live capture's elapsed label too, since the two share a chip: one
 * formatter, so a period and a recording never read as different kinds of
 * thing in the same slot — and so an hour-long capture says `1:00:00` rather
 * than `60:00`.
 */
export function formatSelectionDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  return hours > 0
    ? `${hours}:${pad2(minutes)}:${pad2(seconds)}`
    : `${minutes}:${pad2(seconds)}`
}

/**
 * `1m20s`, `45s`, `1h02m` — the span a confirm button names ("Save 1m20s").
 *
 * Distinct from {@link formatSelectionDuration} (a clock, `1:20`): a verb on a
 * button reads better with units, and the unit-less clock stays where a
 * ticking elapsed time is drawn.
 */
export function formatSelectionSpan(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  if (hours > 0) return `${hours}h${pad2(minutes)}m`
  if (minutes > 0) return `${minutes}m${pad2(seconds)}s`
  return `${seconds}s`
}

/**
 * Everything a surface needs to DRAW the selection, from the two ends and the
 * coverage it already has.
 *
 * Extracted from the timeline so the derivation has exactly one home: the band
 * on the strip, the label on the Save chip and the decision to enable Save all
 * read the same object, and none of them can be computed from a different range
 * than the one that gets exported.
 */
export interface ExportSelectionView {
  /** An anchor exists → the bar shows Save/Discard instead of the arm button. */
  readonly armed: boolean
  /** The ordered range, or null when nothing is armed / no epoch is known. */
  readonly range: ExportSelectionRange | null
  readonly coverage: SelectionCoverage
  /** `m:ss` (`h:mm:ss` past the hour) of the selected period. */
  readonly durationLabel: string
  /** `1m20s` of the selected period — what the confirm button names. */
  readonly spanLabel: string
  /** Long enough to render AND not provably empty of footage. */
  readonly canSave: boolean
  /** Crosses a hole: the file will be shorter than the band. Never silent. */
  readonly warn: boolean
}

export function describeExportSelection(
  anchorMs: number | null,
  activeEpochMs: number | null,
  coverage: readonly TimeRange[],
  windowFromMs: number,
  windowToMs: number,
  liveEdgeMs: number,
): ExportSelectionView {
  const range = resolveExportSelection(anchorMs, activeEpochMs, liveEdgeMs)
  const verdict: SelectionCoverage =
    range === null ? 'unknown' : selectionCoverage(coverage, windowFromMs, windowToMs, range)
  return {
    armed: anchorMs !== null,
    range,
    coverage: verdict,
    durationLabel: formatSelectionDuration(range?.durationMs ?? 0),
    spanLabel: formatSelectionSpan(range?.durationMs ?? 0),
    // `unknown` never blocks a save: an unread coverage window is not an empty
    // one, and this repo has already shipped a UI that could not tell the two
    // apart (D315).
    canSave: isSavableSelection(range) && verdict !== 'absent',
    warn: verdict === 'partial',
  }
}
