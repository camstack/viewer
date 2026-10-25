/**
 * What a picker judges a stored id against: the list that can vouch for it,
 * with whether it answered (D315). The viewer's counterpart of the admin's
 * `device-fleet-view.ts` — each side keeps its own, so the shared
 * `scope-pickers.helpers.ts` can import it by the same specifier on both.
 */
import type { DeviceListState, NamedDevice, SelectionId } from './device-selection.js'

export interface PickerFleetView<Id extends SelectionId = number> {
  readonly state: DeviceListState
  readonly devices: readonly NamedDevice<Id>[] | undefined
}
