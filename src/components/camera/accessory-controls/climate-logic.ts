/**
 * Pure, testable logic for the compact climate (thermostat / A-C) accessory
 * control. Kept separate from the RN component so setpoint stepping, clamping,
 * the derived write and the mode option list are unit-tested without a
 * renderer (the vitest env is `node` — there is no renderer here).
 *
 * Mirrors the server `climate-control.cap.ts` slice: `mode` ∈ HvacMode,
 * `availableModes`, single `target` (heat/cool/dry) OR dual `targetLow/High`
 * (heat_cool range), read-only `currentTemp`.
 *
 * The row deliberately renders THREE controls only — mode select, setpoint
 * readout, up/down arrows (plus the current temperature as small secondary
 * text). Fan mode, preset, swing and target humidity are NOT surfaced: the row
 * is a strip a few dozen points wide inside the camera's devices panel, and
 * eight affordances there were unusable.
 */

/** HA-canonical HVAC operation modes (subset a device advertises). */
export type HvacMode = 'off' | 'heat' | 'cool' | 'auto' | 'heat_cool' | 'fan_only' | 'dry'

/** The read subset of the climate slice the compact row renders. */
export interface ClimateStatus {
  readonly mode: HvacMode
  readonly availableModes: readonly HvacMode[]
  readonly target: number | null
  readonly targetLow: number | null
  readonly targetHigh: number | null
  readonly currentTemp: number | null
}

/**
 * Setpoint bounds for the compact stepper. The cap slice does NOT carry
 * per-device min/max/step (they live behind the provider's `getOptions`, which
 * has no typed method here), so the row uses wide, safe defaults — a device
 * that rejects an out-of-range value simply no-ops and the next status refetch
 * reconciles the readout. STEP 0.5 °C matches common thermostat granularity.
 */
export const CLIMATE_MIN_C = 5
export const CLIMATE_MAX_C = 35
export const CLIMATE_STEP_C = 0.5

/** Clamp a target temperature to [MIN,MAX] and snap to the step grid. */
export function clampTarget(value: number): number {
  const clamped = Math.max(CLIMATE_MIN_C, Math.min(CLIMATE_MAX_C, value))
  const snapped = Math.round(clamped / CLIMATE_STEP_C) * CLIMATE_STEP_C
  // Avoid -0 and floating dust (0.1+0.2) so the readout is clean.
  return Math.round(snapped * 100) / 100
}

/** One entry of the compact mode dropdown. */
export interface ClimateModeOption {
  readonly value: HvacMode
  readonly label: string
}

/**
 * The dropdown's option list: every advertised mode, in the device's order,
 * de-duplicated. The ACTIVE mode is prepended when the device omitted it from
 * `availableModes` — otherwise the picker would render the current state as an
 * unselectable value and read as "no mode".
 */
export function buildModeOptions(
  available: readonly HvacMode[],
  active: HvacMode,
  label: (mode: HvacMode) => string,
): readonly ClimateModeOption[] {
  const ordered = available.includes(active) ? available : [active, ...available]
  const seen = new Set<HvacMode>()
  const options: ClimateModeOption[] = []
  for (const mode of ordered) {
    if (seen.has(mode)) continue
    seen.add(mode)
    options.push({ value: mode, label: label(mode) })
  }
  return options
}

/** How the row should present + edit the setpoint for the active mode. */
export type SetpointModel =
  | { readonly kind: 'single'; readonly value: number }
  | { readonly kind: 'range'; readonly low: number; readonly high: number }
  | { readonly kind: 'none' }

/**
 * Derive the editable setpoint model from the slice. `heat_cool` is a dual
 * range (targetLow/High); single-target modes use `target`; modes with no
 * setpoint (`off` / `fan_only` when target is null) yield `none` so the
 * steppers render disabled.
 */
export function setpointModel(status: ClimateStatus): SetpointModel {
  if (status.mode === 'heat_cool' && status.targetLow !== null && status.targetHigh !== null) {
    return { kind: 'range', low: status.targetLow, high: status.targetHigh }
  }
  if (status.target !== null) return { kind: 'single', value: status.target }
  return { kind: 'none' }
}

/** The model a row with no editable setpoint shows (`off` / `fan_only`). */
export const NO_SETPOINT: SetpointModel = { kind: 'none' }

/**
 * Move a setpoint by `steps` × `CLIMATE_STEP_C` (steps may be negative, and may
 * be several when a burst of arrow taps is folded into ONE write). A range
 * shifts both ends together so the band width is preserved. A `none` model is
 * unchanged — there is nothing to step.
 */
export function stepSetpoint(model: SetpointModel, steps: number): SetpointModel {
  if (steps === 0) return model
  const delta = steps * CLIMATE_STEP_C
  if (model.kind === 'single') return { kind: 'single', value: clampTarget(model.value + delta) }
  if (model.kind === 'range') {
    return { kind: 'range', low: clampTarget(model.low + delta), high: clampTarget(model.high + delta) }
  }
  return model
}

/** The cap call a setpoint model commits to, or null when nothing is editable. */
export type SetpointWrite =
  | { readonly method: 'setTarget'; readonly args: { readonly target: number } }
  | {
      readonly method: 'setTargetRange'
      readonly args: { readonly targetLow: number; readonly targetHigh: number }
    }
  | null

/** Derive the `climateControl` mutation for a setpoint model. */
export function setpointWrite(model: SetpointModel): SetpointWrite {
  if (model.kind === 'single') return { method: 'setTarget', args: { target: model.value } }
  if (model.kind === 'range') {
    return { method: 'setTargetRange', args: { targetLow: model.low, targetHigh: model.high } }
  }
  return null
}

/** One temperature as a compact °-suffixed readout (trailing `.0` trimmed). */
export function formatTemp(value: number): string {
  return (Number.isInteger(value) ? String(value) : value.toFixed(1)) + '°'
}

/** The setpoint readout: a single value, a range, or a placeholder. */
export function formatSetpoint(model: SetpointModel): string {
  if (model.kind === 'single') return formatTemp(model.value)
  if (model.kind === 'range') return `${formatTemp(model.low)}–${formatTemp(model.high)}`
  return '--'
}
