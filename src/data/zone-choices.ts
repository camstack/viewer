/**
 * zone-choices — pure selection model for the multi-select zone pickers.
 *
 * The admin UI shows zones by NAME; the viewer's rule editor showed the raw
 * ids in a free-text tag input (the operator's exact complaint: "zone Ids
 * invece dei nomi"). This maps the known zones of the rule's cameras into
 * tappable choices, and keeps every selected id the list does NOT know as an
 * explicit "unknown" — visible and removable, never silently dropped: a rule
 * authored in the admin UI may reference a zone of a camera the viewer has not
 * loaded (or one since deleted), and dropping it here would rewrite the rule
 * on save.
 */

import type { NcZoneRef } from './zones.js'

/** One tappable zone option: the stored id, the shown name. */
export interface ZoneChoice {
  readonly id: string
  readonly name: string
  readonly selected: boolean
}

export interface ZoneMultiChoices {
  readonly options: readonly ZoneChoice[]
  /** Selected ids the zone list does not know, in selection order. */
  readonly unknownIds: readonly string[]
}

export function zoneMultiChoices(
  zones: readonly NcZoneRef[],
  selectedIds: readonly string[],
): ZoneMultiChoices {
  const selected = new Set(selectedIds)
  const known = new Set(zones.map((z) => z.id))
  return {
    options: zones.map((z) => ({ id: z.id, name: z.name, selected: selected.has(z.id) })),
    unknownIds: selectedIds.filter((id) => !known.has(id)),
  }
}

/** One camera's zones, as the zone scope field reads them. */
export interface CameraZoneList {
  readonly deviceId: number
  readonly zones: readonly NcZoneRef[]
}

/** A zone as the scope picker lists it: `camera:zone`, grouped by camera. */
export interface ZonePickerItem {
  readonly id: string
  readonly name: string
  /** The camera's name — the picker's group. */
  readonly type: string
}

/**
 * The zone scope picker's items (operator, 2026-10-01): every zone of the
 * given cameras, named `camera:zone` so two cameras' "Front door" are told
 * apart, grouped by camera. Zone ids are unique per camera; an id met twice
 * keeps its first camera. A camera the name map lacks reads `#<id>`.
 */
export function zonePickerItems(
  lists: readonly CameraZoneList[],
  cameraNames: ReadonlyMap<number, string>,
): readonly ZonePickerItem[] {
  const seen = new Set<string>()
  const out: ZonePickerItem[] = []
  for (const list of lists) {
    const camera = cameraNames.get(list.deviceId) ?? `#${String(list.deviceId)}`
    for (const zone of list.zones) {
      if (seen.has(zone.id)) continue
      seen.add(zone.id)
      out.push({ id: zone.id, name: `${camera}:${zone.name}`, type: camera })
    }
  }
  return out
}
