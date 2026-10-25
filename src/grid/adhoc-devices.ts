/**
 * adhoc-devices — pure helpers for the ON-THE-FLY (ephemeral) grid route.
 *
 * The camera switcher's multiselect opens `/grid/adhoc?devices=1,2,3`: a
 * transient grid built entirely from the URL, never persisted (nothing enters
 * the grid store, nothing to clean up on exit). These helpers serialise /
 * parse that `devices` parameter. Pure & tolerant — malformed input degrades
 * to an empty list, never throws.
 */

/** Serialise device ids into the `devices` route parameter value. */
export function serializeAdhocDeviceIds(ids: readonly number[]): string {
  return ids.filter((id) => Number.isInteger(id) && id > 0).join(',')
}

/**
 * Parse the `devices` route parameter (expo-router yields `string`,
 * `string[]`, or `undefined`) into a deduped list of positive integer device
 * ids, preserving order. Anything malformed is dropped.
 */
export function parseAdhocDeviceIds(param: string | readonly string[] | undefined): readonly number[] {
  if (param === undefined) return []
  const raw = typeof param === 'string' ? param : param.join(',')
  const seen = new Set<number>()
  const out: number[] = []
  for (const part of raw.split(',')) {
    const id = Number(part.trim())
    if (Number.isInteger(id) && id > 0 && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}
