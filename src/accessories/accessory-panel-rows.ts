/**
 * accessory-panel-rows — what the camera accessory panel DRAWS, from what the
 * hub linked, what the operator added, and how the operator customised it.
 *
 * ## Two sources, one list
 *
 * The hub's linked devices (`useLinkedDevices`, resolved server-side: picks ∪
 * children) come first, in the name order they always had; the operator's
 * local additions follow. A device the hub links AND the operator added is
 * ONE row, of server origin — the addition is redundant but harmless, and it
 * is what keeps the row when an admin later unlinks it, which is the point of
 * an addition being independent (`accessory-prefs.ts`).
 *
 * ## Actuators only — before customisation
 *
 * A row that offers no write is a reading nobody asked for
 * (`isActuatingControlKind`, the control registry's own predicate — on camera
 * 104 the readings were most of the list). That filter runs BEFORE the
 * operator's customisation is applied: a device the operator HID is a
 * different claim from one with no control, and a hidden device is still
 * listed in edit mode so it can be shown again, while a control-less one is
 * simply not a row.
 *
 * ## Icon precedence
 *
 * local viewer pick → the admin's device display override
 * (`DeviceDisplayOverride.icon`) → the operator-authored role display default
 * → the built-in role glyph → the type icon. Each level counts only when it
 * names a glyph this viewer can draw. `role` itself is NOT the knob: role
 * also decides which child of a container is picked
 * (`resolveContainerPrimaryChild`), and using it for an icon would be a
 * second authority over a different question.
 *
 * ## Orphans
 *
 * A customisation or order slot for an id that is neither linked nor added is
 * ignored here — discarded on read, never written back (see
 * `accessory-prefs.ts` for why).
 *
 * Pure — no React, no I/O.
 */
import {
  builtInIconKeyForRole,
  iconKeyForDeviceType,
  accessoryIconKey,
  type AccessoryIconKey,
} from './accessory-icon-keys.js'
import type { CameraAccessoryPrefs } from './accessory-prefs.js'

/** One device as the panel needs it: the accessory-control fields plus what
 *  the icon precedence reads. */
export interface AccessoryPanelDevice {
  readonly id: number
  readonly name: string
  /** Canonical device-type string (`light`, `siren`, `cover`, …). */
  readonly type: string
  readonly online: boolean
  readonly features: readonly string[]
  readonly location: string | null
  /** `DeviceInfo.role`, or null. Read for the icon default only. */
  readonly role: string | null
  /** `DeviceInfo.display.icon` — the admin's per-device override, or null. */
  readonly displayIcon: string | null
}

export type AccessoryOrigin = 'server' | 'local'

export interface AccessoryPanelRow {
  readonly device: AccessoryPanelDevice
  readonly origin: AccessoryOrigin
  /** What the row is called: the local name, else the parent-stripped hub name. */
  readonly label: string
  readonly iconKey: AccessoryIconKey
  /** True when the operator hid it. Only ever true in edit mode's output. */
  readonly hidden: boolean
}

export interface ResolveIconInput {
  readonly localIcon: string | undefined
  readonly displayIcon: string | null
  readonly role: string | null
  /** Operator-authored role defaults (`deviceManager.getRoleDisplayDefaults`), icon only. */
  readonly roleIcons: Readonly<Record<string, string>>
  readonly type: string
}

/** The icon precedence, one level at a time, skipping values the catalog does not know. */
export function resolveAccessoryIconKey(input: ResolveIconInput): AccessoryIconKey {
  const local = accessoryIconKey(input.localIcon)
  if (local !== undefined) return local
  const display = accessoryIconKey(input.displayIcon)
  if (display !== undefined) return display
  if (input.role !== null) {
    const roleDefault = accessoryIconKey(input.roleIcons[input.role])
    if (roleDefault !== undefined) return roleDefault
    const builtIn = builtInIconKeyForRole(input.role)
    if (builtIn !== null) return builtIn
  }
  return iconKeyForDeviceType(input.type)
}

export interface ComposeAccessoryRowsInput {
  /** The hub's linked devices, already name-sorted by `useLinkedDevices`. */
  readonly server: readonly AccessoryPanelDevice[]
  /** The operator's local additions, resolved to devices. */
  readonly local: readonly AccessoryPanelDevice[]
  readonly prefs: CameraAccessoryPrefs
  readonly roleIcons: Readonly<Record<string, string>>
  /** The control registry's verdict for a device — injected so this rule
   *  does not import React-adjacent modules. */
  readonly actuates: (device: AccessoryPanelDevice) => boolean
  /** `stripParentName` bound to the camera — the label rule the panel had. */
  readonly stripParent: (name: string) => string
  /** Edit mode lists hidden rows (flagged); view mode drops them. */
  readonly editing: boolean
}

function byName(a: AccessoryPanelDevice, b: AccessoryPanelDevice): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

/** The base order: hub rows as they came, then additions by name, deduplicated. */
function baseDevices(
  input: ComposeAccessoryRowsInput,
): readonly { readonly device: AccessoryPanelDevice; readonly origin: AccessoryOrigin }[] {
  const serverIds = new Set(input.server.map((d) => d.id))
  const server = input.server
    .filter(input.actuates)
    .map((device) => ({ device, origin: 'server' as const }))
  const seenLocal = new Set<number>()
  const local = [...input.local]
    .sort(byName)
    .filter((d) => {
      if (serverIds.has(d.id) || seenLocal.has(d.id)) return false
      seenLocal.add(d.id)
      return input.actuates(d)
    })
    .map((device) => ({ device, origin: 'local' as const }))
  return [...server, ...local]
}

/** Apply the stored order: listed ids first, in that order; the rest follow
 *  in base order. Ids the order names but the list lacks are orphans, ignored. */
function applyOrder<T extends { readonly device: AccessoryPanelDevice }>(
  base: readonly T[],
  order: readonly number[],
): readonly T[] {
  const byId = new Map(base.map((entry) => [entry.device.id, entry]))
  const placed = new Set<number>()
  const head: T[] = []
  for (const id of order) {
    const entry = byId.get(id)
    if (entry !== undefined && !placed.has(id)) {
      placed.add(id)
      head.push(entry)
    }
  }
  return [...head, ...base.filter((entry) => !placed.has(entry.device.id))]
}

export function composeAccessoryRows(input: ComposeAccessoryRowsInput): readonly AccessoryPanelRow[] {
  const ordered = applyOrder(baseDevices(input), input.prefs.order)
  const rows = ordered.map(({ device, origin }): AccessoryPanelRow => {
    const custom = input.prefs.byId[device.id]
    return {
      device,
      origin,
      label: custom?.name ?? input.stripParent(device.name),
      iconKey: resolveAccessoryIconKey({
        localIcon: custom?.icon,
        displayIcon: device.displayIcon,
        role: device.role,
        roleIcons: input.roleIcons,
        type: device.type,
      }),
      hidden: custom?.hidden === true,
    }
  })
  return input.editing ? rows : rows.filter((row) => !row.hidden)
}

/** The ids the composed rows show, in order — what `moveAccessoryEntry` takes. */
export function shownOrder(rows: readonly AccessoryPanelRow[]): readonly number[] {
  return rows.map((row) => row.device.id)
}
