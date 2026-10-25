/**
 * useDevicesByIds — do these devices still exist, and what are they called?
 *
 * The TARGETED form of the fleet listing: `deviceManager.listAll({ deviceIds,
 * projection: 'slim' })` returns only the named rows (a few hundred bytes for
 * the handful of ids a picker cannot name), where the whole-fleet catalogue is
 * ~433 KB on this hub. The same read `use-linked-devices` already makes.
 *
 * `deviceIds` is newer than the pinned SDK router types, and a hub that
 * predates it strips the key and answers the whole fleet — so the answer is
 * filtered to the asked ids here, and is correct in either deploy order.
 *
 * Keyed on the SORTED ids: the same question asked in another order is the
 * same cache entry. Disabled for an empty list — nothing is ever read for it.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'
import { parsePickerCandidates } from './linked-device-wire.js'
import type { PickerCandidate } from './linked-device-picker.js'

const BY_IDS_STALE_MS = 30_000

export function devicesByIdsKey(sortedIds: readonly number[]): readonly unknown[] {
  return ['v2', 'devices-by-ids', sortedIds]
}

/**
 * The rows come back WHOLE (id, name, type, room, parent): a picker that lists
 * only these ids (the alarm's openings, the battery devices) groups them by
 * type and room without a second read. Every `NamedDevice` reader still reads
 * just `id` and `name`.
 */
export function useDevicesByIds(ids: readonly number[]): UseQueryResult<readonly PickerCandidate[]> {
  const { controller, state } = useConnection()
  // A fresh array, sorted in place: Hermes has no `toSorted`.
  const sortedIds = [...new Set(ids)].sort((a, b) => a - b)
  return useQuery<readonly PickerCandidate[]>({
    queryKey: devicesByIdsKey(sortedIds),
    enabled: sortedIds.length > 0 && state === 'connected',
    staleTime: BY_IDS_STALE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      // The capQuery boundary: the router is addressed by name, and its typed
      // input predates `deviceIds` (see the header).
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'deviceManager',
        'listAll',
        { projection: 'slim', deviceIds: sortedIds },
      )
      const rows = parsePickerCandidates(raw)
      // `capQuery` answers `null` for a failed call: that is NOT "none of them
      // exist", and must not become an empty answer (D315).
      if (rows === null) throw new Error('device lookup unreadable')
      const asked = new Set(sortedIds)
      return rows.filter((row) => asked.has(row.id))
    },
  })
}
