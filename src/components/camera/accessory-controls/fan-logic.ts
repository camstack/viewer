/**
 * Pure, testable logic for the compact fan accessory control. Fan on/off lives
 * on the `switch` cap (fan devices register `switch + fan-control`, mirroring
 * the light `switch + brightness` pattern); this module only handles the speed
 * percentage math. Mirrors `fan-control.cap.ts`.
 */

/** Fallback speed granularity when the device omits `percentageStep`. 25 gives
 *  a natural 4-notch (0/25/50/75/100) sweep for common multi-speed fans. */
export const FAN_DEFAULT_STEP = 25

/** Clamp a speed to [0,100] and round to an integer percentage. */
export function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

/**
 * Next speed after nudging `current` by `direction` (+1 up / −1 down) one
 * `step`, snapped toward the direction of travel so repeated taps land on clean
 * multiples: an on-grid value moves exactly one step; an off-grid value snaps to
 * the next grid line in the travel direction (30 with step 25 → up 50, down 25).
 * A null `current` (single-speed / unknown) is treated as 0.
 */
export function stepPercentage(
  current: number | null,
  direction: 1 | -1,
  step: number,
): number {
  const base = current ?? 0
  const grid = step > 0 ? step : FAN_DEFAULT_STEP
  const onGrid = base % grid === 0
  const next = onGrid
    ? base + direction * grid
    : direction === 1
      ? Math.ceil(base / grid) * grid
      : Math.floor(base / grid) * grid
  return clampPercentage(next)
}
