/**
 * device-slots — the cap-keyed slot registry of the device detail screen.
 *
 * ONE template for every device: the screen has eight slots in a fixed order
 * and each bound cap says which slot it fills and with which widget. Nothing
 * here looks at a device TYPE to decide what to show; the type is read only by
 * the existing control registry (`pickAccessoryControl`) for the primary
 * control, exactly as the accessory row does. An empty slot is not rendered.
 *
 * Pure — no React, no I/O.
 */
import {
  pickAccessoryControl,
  SENSOR_FEATURES,
  type AccessoryControlPick,
} from '../../components/camera/accessory-controls/control-registry.js'
import { TIMED_RUN_FEATURE } from '../../data/timed-run.js'

export type DeviceSlotId =
  | 'header'
  | 'status'
  | 'primary'
  | 'secondary'
  | 'readings'
  | 'consumables'
  | 'timer'
  | 'links'

/** The fixed order of the slots on the screen. */
export const DEVICE_SLOT_ORDER: readonly DeviceSlotId[] = [
  'header', 'status', 'primary', 'secondary', 'readings', 'consumables', 'timer', 'links',
]

export type DeviceWidgetId =
  | 'battery'
  | 'network-link'
  | 'power-draw'
  | 'running-state'
  | 'contact-state'
  | 'primary-control'
  | 'main-reading'
  | 'motion-trigger'
  | 'reading'
  | 'consumables'
  | 'timed-run'

export interface SlotEntry {
  readonly widget: DeviceWidgetId
  /** The kebab cap name behind the widget. */
  readonly cap: string
  /** `primary-control` only: the control to draw. */
  readonly pick?: AccessoryControlPick
}

export interface DeviceSlotInput {
  readonly type: string
  /** Kebab cap names the device is bound to. */
  readonly caps: readonly string[]
}

export interface DeviceSlot {
  readonly slot: DeviceSlotId
  readonly entries: readonly SlotEntry[]
}

/** Which slot each cap fills, and with what. Order within a slot follows this list. */
const CAP_WIDGETS: readonly { readonly cap: string; readonly slot: DeviceSlotId; readonly widget: DeviceWidgetId }[] = [
  { cap: 'battery', slot: 'header', widget: 'battery' },
  { cap: 'network-link', slot: 'header', widget: 'network-link' },
  { cap: 'power-meter', slot: 'header', widget: 'power-draw' },
  { cap: 'running-state', slot: 'status', widget: 'running-state' },
  { cap: 'contact', slot: 'status', widget: 'contact-state' },
  { cap: 'motion-trigger', slot: 'secondary', widget: 'motion-trigger' },
  { cap: 'consumables', slot: 'consumables', widget: 'consumables' },
  { cap: TIMED_RUN_FEATURE, slot: 'timer', widget: 'timed-run' },
]

/**
 * The primary control. The device-type map answers first; a device the map
 * does not give a control (a heater or a washer, which bind a plain `switch`)
 * falls back to what its caps say.
 */
export function resolvePrimary(input: DeviceSlotInput): AccessoryControlPick {
  const pick = pickAccessoryControl({ type: input.type, features: input.caps })
  if (pick.kind !== 'none') return pick
  if (input.caps.includes('switch')) return { kind: 'switch' }
  return pick
}

export function resolveDeviceSlots(input: DeviceSlotInput): readonly DeviceSlot[] {
  const caps = new Set(input.caps)
  const bySlot = new Map<DeviceSlotId, SlotEntry[]>()
  const add = (slot: DeviceSlotId, entry: SlotEntry): void => {
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), entry])
  }

  for (const { cap, slot, widget } of CAP_WIDGETS) {
    if (caps.has(cap)) add(slot, { widget, cap })
  }

  const pick = resolvePrimary(input)
  const sensors = SENSOR_FEATURES.filter((f) => caps.has(f))
  if (pick.kind !== 'none') {
    add('primary', { widget: 'primary-control', cap: pick.sensorFeature ?? pick.kind, pick })
  } else if (sensors.length > 0) {
    // No control: the main reading takes the primary slot.
    add('primary', { widget: 'main-reading', cap: sensors[0] })
  }
  const shown = pick.kind === 'sensor' ? pick.sensorFeature : pick.kind === 'none' ? sensors[0] : undefined
  for (const sensor of sensors) {
    if (sensor !== shown) add('readings', { widget: 'reading', cap: sensor })
  }

  // The header always exists (the name); every other empty slot is dropped.
  return DEVICE_SLOT_ORDER.flatMap((slot) => {
    const entries = bySlot.get(slot) ?? []
    return slot === 'header' || entries.length > 0 ? [{ slot, entries }] : []
  })
}
