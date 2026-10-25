/**
 * heatmap-scrub — the pure fraction↔epoch mapping for the day heatmap strip.
 *
 * The heatmap bar spans ONE calendar day: `[dayFromMs, dayToMs]` (local midnight
 * → next midnight). A tap at a 0..1 fraction `f` across the bar must seek to the
 * epoch the strip visually shows at `f`, and the time cursor for an epoch must
 * sit back at that same `f`. To make that round-trip provable — and impossible to
 * silently drift — BOTH directions live here and are consumed by both the cursor
 * (`epochToDayFraction`) and the tap/scrub seek (`dayFractionToEpoch`).
 *
 * `pointerFraction` converts a raw pointer offset (px from the strip's left edge)
 * into a fraction, returning `null` when the strip has not been measured yet
 * (width ≤ 0). A pre-layout / mid-resize tap must be IGNORED, never mapped to 0 —
 * mapping it to 0 seeks to midnight, which reads as "the tap did nothing / landed
 * at a random early time". Callers skip the seek on `null`.
 *
 * No React, no side-effects, no `any`.
 */

import { dayBounds } from '../../../lib/local-day.js'

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/** The calendar day a strip spans: local midnight → the next. */
export interface DayWindow {
  readonly fromMs: number
  readonly toMs: number
}

/**
 * The day window containing `epochMs` — local midnight to the next local
 * midnight. The span is that civil day's real length (23 h, 24 h, or 25 h).
 *
 * Extracted here, next to the mapping that consumes it, because it was derived
 * inline in `TheaterTimeline` and privately again in `face-review-filters.ts`,
 * and the on-demand player's compact timeline would have been a third copy. The
 * strip's fraction↔epoch round-trip is only provable if both surfaces agree on
 * the domain the fractions are taken across.
 */
export function localDayWindow(epochMs: number): DayWindow {
  const { startMs, endMs } = dayBounds(epochMs)
  return { fromMs: startMs, toMs: endMs }
}

/**
 * Map a 0..1 day fraction to an epoch (ms) within `[dayFromMs, dayToMs]`.
 * The fraction is clamped first, so an over/under-shoot pins to an edge rather
 * than escaping the day. Rounded to a whole millisecond.
 */
export function dayFractionToEpoch(fraction: number, dayFromMs: number, dayToMs: number): number {
  const span = dayToMs - dayFromMs
  return Math.round(dayFromMs + clamp01(fraction) * span)
}

/**
 * Inverse of {@link dayFractionToEpoch}: an epoch (ms) → its 0..1 position across
 * `[dayFromMs, dayToMs]`, clamped to the day. A degenerate window (span ≤ 0)
 * maps to 0.
 */
export function epochToDayFraction(epochMs: number, dayFromMs: number, dayToMs: number): number {
  const span = dayToMs - dayFromMs
  if (span <= 0) return 0
  return clamp01((epochMs - dayFromMs) / span)
}

/**
 * A raw pointer offset (px from the strip's left edge) → 0..1 fraction, or `null`
 * when the strip width is not a usable positive number yet (unmeasured / mid
 * re-layout). Returning `null` lets the caller drop the tap instead of seeking to
 * fraction 0 (= midnight).
 */
export function pointerFraction(offsetX: number, width: number): number | null {
  if (!Number.isFinite(offsetX) || !Number.isFinite(width) || width <= 0) return null
  return clamp01(offsetX / width)
}
