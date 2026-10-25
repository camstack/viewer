/**
 * linked-device-wire — narrowing the `deviceManager.listAll` catalogue the
 * accessory picker offers from.
 *
 * This module used to also read the operator's server-side PICKS
 * (`_linkedDeviceIds` on the settings contribution) and the batched link
 * counts, for an editor that WROTE the hub's link set from the viewer. That
 * editor is gone (2026-09-22): the viewer's "+" is a LOCAL addition
 * (`accessories/accessory-prefs.ts`) and the hub's links are edited in
 * admin-ui only. What remains is the catalogue.
 *
 * D393: a measurement that FAILED is `null`, never `0`. A fleet that is not a
 * list is unknown, because an empty picker and an unreachable hub look
 * identical to an operator and only one of them is worth waiting on.
 */
import { isRecord } from './cap-query.js'
import { toFeatures } from './use-accessories.js'
import type { PickerCandidate } from './linked-device-picker.js'

/** A non-empty string, or null. */
function text(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

/**
 * The picker's catalogue out of a `listAll` payload, or `null` when the
 * listing itself did not arrive. A row that is not a device is dropped.
 * `features` rides along so the picker can withhold a device the panel would
 * never draw (no actuating control) instead of accepting an addition that
 * produces nothing.
 */
export function parsePickerCandidates(raw: unknown): readonly PickerCandidate[] | null {
  if (!Array.isArray(raw)) return null
  const out: PickerCandidate[] = []
  for (const row of raw) {
    if (!isRecord(row)) continue
    const { id, name, type } = row
    if (typeof id !== 'number' || typeof type !== 'string') continue
    out.push({
      id,
      name: typeof name === 'string' && name.trim() ? name.trim() : `Device #${id}`,
      type,
      location: text(row.location),
      parentDeviceId: typeof row.parentDeviceId === 'number' ? row.parentDeviceId : null,
      features: toFeatures(row.features),
    })
  }
  return out
}
