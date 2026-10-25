/**
 * Which icon each location carries.
 *
 * ## Absent is not `map-pin`
 *
 * A location nobody gave an icon to is ABSENT from the server's answer, not
 * `map-pin`. The two must stay different here: "the operator chose the pin" and
 * "nobody chose anything" look the same the moment absence is folded into the
 * fallback, and a picker that cannot tell them apart cannot show a room as
 * un-styled. So this returns a map with only the assignments that exist, and
 * the caller decides what a miss draws.
 *
 * The fallback is for an UNKNOWN id — a value from a newer hub whose glyph this
 * build does not carry — and that is `drawableIcon`'s job, applied here
 * so no caller ever holds a string the glyph map cannot key.
 *
 * ## An older hub
 *
 * `deviceManager.listLocationIcons` arrived with this feature. A hub that
 * predates it answers with an error, and the query fails — which lands as an
 * EMPTY map, so every chip draws exactly what it drew before icons existed.
 * That is the intended degradation, not a swallowed fault: there is no state to
 * report to an operator whose hub simply has no icons yet.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import {
  drawableIcon,
  locationIconKey,
  type DrawableLocationIcon,
} from '../components/cameras/location-icons.js'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'
import { RECONCILE_MS } from './reconcile.js'

export const LOCATION_ICONS_KEY = 'location-icons'

/** Keyed by `locationIconKey(label)` — the ONE derivation, shared with the
 *  server, so a rename that only changes case still finds its icon. */
export type LocationIconMap = ReadonlyMap<string, DrawableLocationIcon>

/** Reads the server's rows, dropping anything that is not a usable pair.
 *  Exported for its own test: the parse is where a wire change would bite. */
export function parseLocationIcons(raw: unknown): LocationIconMap {
  const out = new Map<string, DrawableLocationIcon>()
  if (!Array.isArray(raw)) return out
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue
    const rec = row as Record<string, unknown>
    const key = rec.locationKey
    if (typeof key !== 'string' || key.length === 0) continue
    // Through `drawableIcon`, so an id this build cannot draw becomes the
    // fallback HERE rather than a blank at the bottom of the render — and a row
    // carrying NO icon is dropped, because the fallback belongs to an unknown
    // id and applying it to a missing one invents a choice nobody made.
    const icon = drawableIcon(rec.icon)
    if (icon === null) continue
    out.set(locationIconKey(key), icon)
  }
  return out
}

export function useLocationIcons(): UseQueryResult<LocationIconMap> {
  const { controller, state } = useConnection()
  return useQuery<LocationIconMap>({
    queryKey: ['v2', LOCATION_ICONS_KEY],
    enabled: state === 'connected',
    staleTime: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'deviceManager',
        'listLocationIcons',
        {},
      )
      return parseLocationIcons(raw)
    },
  })
}
