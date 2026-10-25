/**
 * useDeviceCatalogue — every device the "add" picker may offer from.
 *
 * One unprojected fleet listing is ~1 MB on this hub (967 devices measured
 * 2026-08-25, camera credentials included); `slim` is ~433 KB and carries
 * every field the picker reads. `enabled` is what keeps even that off the
 * wire until the operator actually opens the picker — this is not a
 * background read, and it must never become one.
 *
 * `deviceManager.listAll` is a VIEW procedure, so a non-admin can open the
 * picker: what it feeds is a local addition, not a hub write.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery, BULK_QUERY_DEADLINE_MS } from '../data/cap-query.js'
import { parsePickerCandidates } from '../data/linked-device-wire.js'
import type { PickerCandidate } from '../data/linked-device-picker.js'

const CATALOGUE_STALE_MS = 30_000

export function deviceCatalogueKey(): readonly unknown[] {
  return ['v2', 'device-catalogue']
}

export function useDeviceCatalogue(enabled: boolean): UseQueryResult<readonly PickerCandidate[]> {
  const { controller, state } = useConnection()
  return useQuery<readonly PickerCandidate[]>({
    queryKey: deviceCatalogueKey(),
    enabled: enabled && state === 'connected',
    staleTime: CATALOGUE_STALE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'deviceManager',
        'listAll',
        { projection: 'slim' },
        // A fleet listing is a bulk read, not a status probe: the badge-sized
        // deadline abandons it on a busy hub and the picker then shows an
        // empty catalogue, which is the one thing it must never do.
        { deadlineMs: BULK_QUERY_DEADLINE_MS },
      )
      const candidates = parsePickerCandidates(raw)
      if (candidates === null) throw new Error('device catalogue unreadable')
      return candidates
    },
  })
}
