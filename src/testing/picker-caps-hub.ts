/**
 * A hub that serves a device list through the picker's `caps` source: the ids
 * bound to the asked caps (`deviceManager.listDeviceIdsByCaps`), then the rows
 * of just those ids (`deviceManager.listAll({ deviceIds })`) - the two reads a
 * production `caps` source makes. Specs use it to give the picker a list it
 * did not compute itself.
 */
import type { PickerDevice } from '../components/notifications/device-picker-model.js'

function askedIds(input: unknown): readonly number[] | null {
  if (typeof input !== 'object' || input === null || !('deviceIds' in input)) return null
  const ids: unknown = input.deviceIds
  return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : null
}

export function capsSourceHub(devices: readonly PickerDevice[]): Record<string, unknown> {
  return {
    'deviceManager.listDeviceIdsByCaps': () => devices.map((device) => device.id),
    'deviceManager.listAll': (input?: unknown) => {
      const ids = askedIds(input)
      return ids === null ? devices : devices.filter((device) => ids.includes(device.id))
    },
  }
}
