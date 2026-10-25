/**
 * The site zones — named parts of the property that group locations.
 *
 * "Night zone" holds the bedrooms. They come BEFORE the locations in the
 * picker: a zone is the coarser question, and an operator looking for "upstairs"
 * should not have to press four rooms to get there.
 *
 * ## An older hub
 *
 * `deviceManager.listSiteZones` arrives with this feature. A hub that predates
 * it answers with an error and the query fails, which lands as an EMPTY list —
 * so the strip renders exactly what it rendered before zones existed. That is
 * the intended degradation, not a swallowed fault: there is nothing to report
 * to an operator whose hub simply has no zones yet.
 */
import { useMemo } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'

import type { ZoneView } from '../components/cameras/camera-locations.js'
import type { PickerZonesRead } from '../components/notifications/device-picker-model.js'
import { drawableIcon, type DrawableLocationIcon } from '../components/cameras/location-icons.js'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'
import { RECONCILE_MS } from './reconcile.js'

export const SITE_ZONES_KEY = 'site-zones'

/** A zone, plus the glyph this build can draw for it. */
export interface SiteZoneView extends ZoneView {
  /** `null` when nobody chose one — NOT the fallback pin. Only one of those two
   *  is a choice, and the strip draws them differently. */
  readonly icon: DrawableLocationIcon | null
}

/** Reads the server's rows, dropping anything that is not a usable zone.
 *  Exported for its own test: the parse is where a wire change would bite. */
export function parseSiteZones(raw: unknown): readonly SiteZoneView[] {
  if (!Array.isArray(raw)) return []
  const out: SiteZoneView[] = []
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue
    const rec = row as Record<string, unknown>
    const zoneKey = rec.zoneKey
    const label = rec.label
    // A zone with no key cannot be selected and a zone with no label cannot be
    // shown. Either way there is nothing to draw, so it is dropped rather than
    // rendered as a nameless chip the operator cannot reason about.
    if (typeof zoneKey !== 'string' || zoneKey.length === 0) continue
    if (typeof label !== 'string' || label.trim().length === 0) continue
    const locationKeys = Array.isArray(rec.locationKeys)
      ? rec.locationKeys.filter((k): k is string => typeof k === 'string')
      : []
    out.push({ zoneKey, label: label.trim(), icon: drawableIcon(rec.icon), locationKeys })
  }
  return out
}

export function useSiteZones(): UseQueryResult<readonly SiteZoneView[]> {
  const { controller, state } = useConnection()
  return useQuery<readonly SiteZoneView[]>({
    queryKey: ['v2', SITE_ZONES_KEY],
    enabled: state === 'connected',
    staleTime: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'deviceManager',
        'listSiteZones',
        {},
      )
      return parseSiteZones(raw)
    },
  })
}

/**
 * The zones as the device picker's "Group by: Zone" reads them — only while
 * its sheet is open (`enabled`), and with a failure KEPT as a failure.
 *
 * {@link useSiteZones} folds every failure into an empty list, which is right
 * for the camera strip (no zones = the strip it drew before) and wrong here:
 * an empty list would put every device under "No zone", a claim of absence
 * from a read that never answered (D315). So this asks with `rethrow`, under
 * its own key, and the picker groups by location while it is pending or
 * failed.
 */
export function usePickerSiteZones(enabled: boolean): UseQueryResult<readonly SiteZoneView[]> {
  const { controller, state } = useConnection()
  return useQuery<readonly SiteZoneView[]>({
    queryKey: ['v2', SITE_ZONES_KEY, 'answered-only'],
    enabled: enabled && state === 'connected',
    staleTime: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      // Documented boundary: the tRPC proxy is walked by path (see cap-query.ts).
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'deviceManager',
        'listSiteZones',
        // `z.void()`: called with NO argument — a `{}` fails its validation.
        undefined,
        { rethrow: true },
      )
      if (!Array.isArray(raw)) throw new Error('listSiteZones answered without a list')
      return parseSiteZones(raw)
    },
  })
}

/**
 * The zones read as the pickers judge it (`PickerZonesRead`): answered, failed
 * or still pending - a failure is kept as a failure, never an empty list (D315).
 */
export function usePickerZonesRead(enabled: boolean): PickerZonesRead {
  const read = usePickerSiteZones(enabled)
  return useMemo((): PickerZonesRead => {
    if (read.data !== undefined) return { state: 'answered', zones: read.data }
    return read.isError ? { state: 'failed' } : { state: 'pending' }
  }, [read.data, read.isError])
}
