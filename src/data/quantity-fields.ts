/**
 * Reading a device value off a hub payload while the hub renames its fields.
 *
 * The hub names a device value after its QUANTITY (`battery.level`,
 * `temperature-sensor.temperature`), not its unit (`percentage`, `celsius`).
 * A phone keeps its installed bundle until the next OTA and a hub moves on its
 * own schedule, so either side can be the older one for a while. Every read of
 * a renamed field therefore takes the NEW name first and falls back to the OLD
 * one; a write sends both (the hub strips the key it does not know).
 *
 * The pairs are the viewer's copy of the hub's rename map
 * (`scripts/migrations/quantity-field-renames.ts` in the server repository),
 * restricted to the fields the viewer consumes. Drop a pair, and its fallback,
 * once no hub in the field is older than the rename.
 */

/** One renamed field: its current name and the name an older hub still sends. */
export interface QuantityField {
  readonly name: string
  readonly legacy: string
}

export const BATTERY_LEVEL: QuantityField = { name: 'level', legacy: 'percentage' }
export const BRIGHTNESS_LEVEL: QuantityField = { name: 'level', legacy: 'percentage' }
export const FAN_SPEED: QuantityField = { name: 'speed', legacy: 'percentage' }
export const NETWORK_SIGNAL: QuantityField = { name: 'signal', legacy: 'signalPercent' }
export const TEMPERATURE: QuantityField = { name: 'temperature', legacy: 'celsius' }
export const HUMIDITY: QuantityField = { name: 'humidity', legacy: 'percent' }
export const PRESSURE: QuantityField = { name: 'pressure', legacy: 'hpa' }
export const ILLUMINANCE: QuantityField = { name: 'illuminance', legacy: 'lux' }
export const CO2: QuantityField = { name: 'co2', legacy: 'co2Ppm' }
export const VOC: QuantityField = { name: 'voc', legacy: 'vocPpb' }

/** A status slice as the viewer receives it: a plain object of unknown values. */
export type StatusSlice = Readonly<Record<string, unknown>>

/**
 * The raw value of `field`: the new name when the slice carries it (even as
 * `null`, which is an answer), else the old name, else `undefined`.
 */
export function readQuantity(slice: StatusSlice, field: QuantityField): unknown {
  const current = slice[field.name]
  return current !== undefined ? current : slice[field.legacy]
}

/** A finite number, or `undefined` when the slice holds anything else. */
export function readQuantityNumber(slice: StatusSlice, field: QuantityField): number | undefined {
  const value = readQuantity(slice, field)
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** A finite number, `null` when the hub said "not known", `undefined` when it said nothing usable. */
export function readQuantityNullable(
  slice: StatusSlice,
  field: QuantityField,
): number | null | undefined {
  const value = readQuantity(slice, field)
  if (value === null) return null
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** The write side: both names, so a hub of either generation finds the one it knows. */
export function quantityArgs(field: QuantityField, value: number): Readonly<Record<string, number>> {
  return { [field.name]: value, [field.legacy]: value }
}
