/**
 * progress — the ONE way this app says "how far through something is".
 *
 * It was written for the clips list (a row that is playing) and is now also
 * what a clip EXPORT reports. Two surfaces, one vocabulary, deliberately: the
 * moment there are two, one of them grows an arm the other lacks, and the
 * arm that goes missing is always the honest one.
 *
 * ## The whole reason it is a verb and not a number
 *
 * `unknown` is a first-class answer, not a small number. A streamed clip's
 * length is routinely never measured; an export's `progressPct` is `null`
 * wherever no real fraction exists (D558: *"`progressPct` stays honest — a
 * real fraction only where one exists … `null` otherwise. No ramp."*). Folding
 * either into `0` claims the work has not started, which is false and which
 * lurches the moment a real number lands — the failure D393 names: a
 * measurement that FAILED is `null`, never `0`.
 *
 * A `number | null` would carry the same information and invite `?? 0` at the
 * one call site where that is a lie. The verb does not.
 *
 * Pure: no React, no i18n, no network.
 */

/** How far through something is, or that we cannot say. */
export type Progress =
  | { readonly kind: 'known'; readonly fraction: number }
  | { readonly kind: 'unknown' }

/** The answer when nothing can be said. A constant, so it is one object. */
export const UNKNOWN_PROGRESS: Progress = { kind: 'unknown' }

/** 0..1, or 0 for anything that is not a finite number. */
export function clampFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0
  return Math.min(1, Math.max(0, fraction))
}

/** A known fraction, clamped. Use it rather than building the object inline. */
export function knownProgress(fraction: number): Progress {
  return { kind: 'known', fraction: clampFraction(fraction) }
}

/**
 * A fraction from a number that may not be one.
 *
 * `null`, `undefined` and a non-finite number are all {@link UNKNOWN_PROGRESS}
 * — never `known 0`. This is the funnel every wire value goes through, so no
 * caller has to remember the rule.
 */
export function progressFrom(fraction: number | null | undefined): Progress {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) {
    return UNKNOWN_PROGRESS
  }
  return knownProgress(fraction)
}
