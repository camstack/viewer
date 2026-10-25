/**
 * Small, pure numeric + list helpers shared by the compact accessory controls
 * that expose a stepper (humidifier target %, water-heater setpoint, numeric
 * `control`) or a cycle (select `control`, media source). Kept separate so the
 * clamping / cycling is unit-tested without a renderer.
 */

/** Clamp `v` to the inclusive `[min,max]` range. */
export function clampRange(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

/** Trim floating dust (0.1+0.2) so readouts stay clean. */
function tidy(v: number): number {
  return Math.round(v * 100) / 100
}

/**
 * Next value after nudging `current` by `direction` (+1 / −1) one `step`,
 * clamped to `[min,max]`. A null `current` starts from `min`. A non-positive
 * `step` falls back to 1.
 */
export function stepValue(
  current: number | null,
  direction: 1 | -1,
  step: number,
  min: number,
  max: number,
): number {
  const s = step > 0 ? step : 1
  const base = current ?? min
  return tidy(clampRange(base + direction * s, min, max))
}

/**
 * Cycle to the next entry in `list` after `current`, wrapping. Returns
 * `current` unchanged for an empty list, and the first entry when `current`
 * is absent from the list.
 */
export function nextInList<T>(current: T, list: readonly T[]): T {
  if (list.length === 0) return current
  const idx = list.indexOf(current)
  if (idx === -1) return list[0]
  return list[(idx + 1) % list.length]
}
