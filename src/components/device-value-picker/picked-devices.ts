/**
 * A device-only field stores numeric ids; the picker speaks
 * {@link PickedValue}. These two are the whole adapter — each device once,
 * order kept.
 */
import { NC_CAMERA_SCOPE_CAP_NAME } from '@camstack/types/client'
import type { DeviceSearchRequires } from '@camstack/types'

import type { PickedValue } from './device-value-picker-model.js'

/** A camera field's ask: the devices bound to `camera-streams`. */
export const CAMERA_REQUIRES: DeviceSearchRequires = { caps: [NC_CAMERA_SCOPE_CAP_NAME] }

export function pickedDevices(ids: readonly number[]): readonly PickedValue[] {
  return ids.map((deviceId) => ({ deviceId }))
}

export function deviceIdsOf(picked: readonly PickedValue[]): number[] {
  return [...new Set(picked.map((p) => p.deviceId))]
}
