/**
 * linked-device-picker — what a camera's link picker OFFERS, and in what order.
 *
 * ## The rule this file is
 *
 * D356 (`docs/decisions/adr-0356.md` in the server repo): **a camera links only
 * what the operator PICKED.** The retired `auto` mode linked every device
 * sharing the camera's location, and on the live fleet it was wrong in both
 * directions at once — it could only ever reach ONE of two identical spotlights
 * inside a container, while handing camera 104 fifteen links, ten of them
 * container children listed one by one.
 *
 * So nothing here selects anything. Same-location devices are SUGGESTED —
 * sorted to the front under their own heading — and the picked set stays
 * entirely the operator's, held outside this module. A `PickerOption` carries
 * no `selected` field at all, on purpose: there is no seat for a rule to sit in.
 *
 * A CONTAINER is never a pick; its children are, named after it. A container
 * is not renderable standalone and bears no capability by construction (the
 * cap always lives on the child), so offering one would offer a row that can
 * never produce an event. `Faretti hall 2 · in Pulsante faretti hall` is
 * how the second spotlight becomes pickable at all.
 *
 * ## Why this is a port, not an import
 *
 * The admin UI runs the same control as `device-multiselect` with
 * `suggestLocation` — `packages/ui-library/src/composites/device-select-filter.ts`
 * plus `device-select-field.tsx`. That is a web React component (raw `div` /
 * `button`, Tailwind classes) and this is React Native, so it cannot be
 * imported here any more than `ConfirmProvider` could. What is shared is the
 * SEMANTICS, and `__tests__/linked-device-picker.spec.ts` is where they are
 * held to it — label shape, description shape, the `Suggested · <location>`
 * partition and the container exclusion all mirror that module deliberately.
 *
 * Pure: devices in, options out. No React, no I/O.
 */

/**
 * The device type that is never an option.
 *
 * The hub DOES send `excludeTypes: ['container']` on the field today, and this
 * module honours whatever it sends — but it does not DEPEND on it. A hub that
 * predates the key, or one whose contribution arrives half-parsed, must not be
 * able to put a container in the list: an un-actuatable row is a worse failure
 * than a missing filter, and D356 states the exclusion as a property of the
 * picker rather than of one server's payload.
 */
export const CONTAINER_DEVICE_TYPE = 'container'

/** The `deviceManager.listAll` fields the picker reads (a structural subset). */
export interface PickerCandidate {
  readonly id: number
  readonly name: string
  readonly type: string
  readonly location: string | null
  readonly parentDeviceId: number | null
  /** Capability names, for the caller that must know whether the panel would
   *  draw a control for it. Optional: the ordering here never reads it. */
  readonly features?: readonly string[]
}

/** One offerable device. Deliberately has NO selection state — see the header. */
export interface PickerOption {
  readonly id: number
  /** `Name (Location)`, or just `Name` where the device has no location. */
  readonly label: string
  /** `Location · type · in Container` — the parts a name alone does not say. */
  readonly description: string
  readonly location: string | null
}

/** The catalogue narrowing the hub's field declares (`deviceFilter`). */
export interface PickerFilter {
  /** The camera itself — never a companion of itself. */
  readonly excludeDeviceId: number | null
  readonly excludeTypes: readonly string[]
}

/** The offer, split so the UI can put a heading between the halves. */
export interface PickerGroups {
  /** Devices sharing the camera's location. Suggested, never linked. */
  readonly suggested: readonly PickerOption[]
  readonly others: readonly PickerOption[]
}

/** Flatten the groups into the order they are shown in: suggestions first. */
export function pickerOptionsInOrder(groups: PickerGroups): readonly PickerOption[] {
  return [...groups.suggested, ...groups.others]
}

/** A non-empty location, or null. The wire says `null`, `undefined` and `''`. */
function normalizeLocation(raw: string | null | undefined): string | null {
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

/** `Name (Location)` — the same label shape the admin picker draws. */
function optionLabel(device: PickerCandidate): string {
  const location = normalizeLocation(device.location)
  return location !== null ? `${device.name} (${location})` : device.name
}

/** `Location · type · in Container`. The container half is what names a child
 *  after the thing it belongs to, which is the whole point of offering it. */
function optionDescription(device: PickerCandidate, containerName: string | null): string {
  const parts: string[] = []
  const location = normalizeLocation(device.location)
  if (location !== null) parts.push(location)
  parts.push(device.type)
  if (containerName !== null) parts.push(`in ${containerName}`)
  return parts.join(' · ')
}

/**
 * Build the offer for one camera.
 *
 * `suggestLocation` is the CAMERA's location, as the hub reports it on the
 * field. Null (a camera nobody put in a room) means there is nothing to
 * suggest — every device lands in `others`, and the UI simply draws no
 * "Suggested" heading. It never means "suggest everything".
 */
export function buildPickerGroups(
  candidates: readonly PickerCandidate[],
  filter: PickerFilter,
  suggestLocation: string | null,
): PickerGroups {
  const nameById = new Map<number, string>(candidates.map((d) => [d.id, d.name]))
  const excludedTypes = new Set<string>([CONTAINER_DEVICE_TYPE, ...filter.excludeTypes])
  const room = normalizeLocation(suggestLocation)

  const suggested: PickerOption[] = []
  const others: PickerOption[] = []
  for (const device of candidates) {
    if (filter.excludeDeviceId !== null && device.id === filter.excludeDeviceId) continue
    if (excludedTypes.has(device.type)) continue
    // A parent that is not in the listing at all leaves the child unnamed
    // rather than dropping it: the child IS pickable, it is only the "in …"
    // caption that is unknown, and a missing caption must not remove an option.
    const parentName =
      device.parentDeviceId !== null ? (nameById.get(device.parentDeviceId) ?? null) : null
    const location = normalizeLocation(device.location)
    const option: PickerOption = {
      id: device.id,
      label: optionLabel(device),
      description: optionDescription(device, parentName),
      location,
    }
    if (room !== null && location === room) suggested.push(option)
    else others.push(option)
  }
  return { suggested: sortByLabel(suggested), others: sortByLabel(others) }
}

/** Stable, case-insensitive label order inside each group. */
function sortByLabel(options: readonly PickerOption[]): readonly PickerOption[] {
  return [...options].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  )
}

/**
 * Free-text narrowing — case-insensitive AND over whitespace tokens, matched
 * against id, label and description, so a device is found by name, by room, by
 * its container's name, or by id. The partition survives: a suggestion that
 * matches is still a suggestion.
 */
export function filterPickerGroups(groups: PickerGroups, query: string): PickerGroups {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return groups
  const keep = (option: PickerOption): boolean => {
    const hay = `${option.id} ${option.label} ${option.description}`.toLowerCase()
    return tokens.every((token) => hay.includes(token))
  }
  return { suggested: groups.suggested.filter(keep), others: groups.others.filter(keep) }
}

/**
 * The rows the editor draws for what is ALREADY picked, in selection order.
 *
 * An id with no matching device still comes back — as `Device #<id>` — rather
 * than vanishing. A pick whose device was removed from the hub is exactly the
 * row an operator needs to be able to see and take off the list; dropping it
 * would leave a pick that cannot be edited because it cannot be drawn.
 */
export function resolvePickedOptions(
  candidates: readonly PickerCandidate[],
  picked: readonly number[],
): readonly PickerOption[] {
  const byId = new Map<number, PickerCandidate>(candidates.map((d) => [d.id, d]))
  return picked.map((id) => {
    const device = byId.get(id)
    if (device === undefined) {
      return { id, label: `Device #${id}`, description: '', location: null }
    }
    const parentName =
      device.parentDeviceId !== null ? (byId.get(device.parentDeviceId)?.name ?? null) : null
    return {
      id,
      label: optionLabel(device),
      description: optionDescription(device, parentName),
      location: normalizeLocation(device.location),
    }
  })
}

/** A list cut to a length, and how much of it that cut hid. */
export interface BoundedOptions {
  readonly shown: readonly PickerOption[]
  /** How many matches are NOT drawn. Zero means the list is complete. */
  readonly hidden: number
}

/**
 * Cut a result list to `limit`, and SAY how many were left out.
 *
 * This fleet is ~1100 devices. Drawing them all is not an option on a phone,
 * and drawing the first fifty silently is worse than not drawing them: an
 * operator who cannot find their doorbell would conclude it is not there. The
 * count travels with the slice so the UI can tell them to narrow the search
 * instead of telling them nothing.
 */
export function boundOptions(options: readonly PickerOption[], limit: number): BoundedOptions {
  if (options.length <= limit) return { shown: options, hidden: 0 }
  return { shown: options.slice(0, limit), hidden: options.length - limit }
}
