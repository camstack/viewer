/**
 * zones — the pure boundary over the hub's `zones` cap.
 *
 * The cap is DEVICE-scoped (`zones.listZones({ deviceId })`), so anything that
 * needs "the zones a rule can talk about" fans one query out per selected
 * camera and merges the answers. Only `{id, name}` survives the parse: the
 * polygon geometry is the zone editor's business, and carrying it would make
 * every picker re-render on a vertex change.
 *
 * Parsing is per-ENTRY defensive, matching every other cap read in this folder:
 * a malformed row costs that row, never the list. A picker with no zones at all
 * is indistinguishable from a camera that genuinely has none, and that
 * ambiguity is how a rule ends up scoped to nothing.
 */
import { isRecord } from './cap-query.js'

/** A zone as the rule editor refers to it: the stored id, the shown name. */
export interface NcZoneRef {
  readonly id: string
  readonly name: string
}

/** Parse a `zones.listZones` response into `{id, name}` pairs. */
export function parseZoneList(raw: unknown): readonly NcZoneRef[] {
  if (!Array.isArray(raw)) return []
  const out: NcZoneRef[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const id = entry.id
    if (typeof id !== 'string' || id.length === 0) continue
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    // A blank name renders as an unlabelled row nobody can identify — the id is
    // at least the thing the rule actually stores.
    out.push({ id, name: name.length > 0 ? name : id })
  }
  return out
}

/** Union of the per-camera zone lists, first name winning on a repeated id. */
export function mergeZoneLists(lists: readonly (readonly NcZoneRef[])[]): readonly NcZoneRef[] {
  const seen = new Set<string>()
  const out: NcZoneRef[] = []
  for (const list of lists) {
    for (const zone of list) {
      if (seen.has(zone.id)) continue
      seen.add(zone.id)
      out.push(zone)
    }
  }
  return out
}
