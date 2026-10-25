/**
 * useDeviceIdsByCaps — which devices are bound to one of these capabilities?
 *
 * The TARGETED read (D636): `deviceManager.listDeviceIdsByCaps` answers ids
 * only, resolved server-side with the same binding resolver `getBindings`
 * uses. It replaced the whole-fleet catalogue (~433 KB) plus
 * `getBindingsBatch` over ~900 ids that the alarm's household scan and the
 * battery section's picker used to make. Names come from the targeted
 * `useDevicesByIds` over the answer.
 *
 * Keyed on the cap names (a handful of short strings), never on ids. A read
 * that failed THROWS — "no device carries it" is a claim only an answer can
 * make (D315). An older hub without the method fails the same way, and the
 * caller says it could not check.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { BULK_QUERY_DEADLINE_MS, capQuery } from './cap-query.js'

const BY_CAPS_STALE_MS = 60_000

export function deviceIdsByCapsKey(capNames: readonly string[]): readonly unknown[] {
  // A fresh array sorted in place: Hermes has no `toSorted`.
  return ['v2', 'device-ids-by-caps', [...capNames].sort().join(',')]
}

/** The ids out of a `listDeviceIdsByCaps` answer; null when it is not a list of ids. */
export function parseDeviceIds(raw: unknown): readonly number[] | null {
  if (!Array.isArray(raw)) return null
  const ids: number[] = []
  for (const value of raw) {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null
    ids.push(value)
  }
  return ids
}

export function useDeviceIdsByCaps(
  capNames: readonly string[],
  enabled: boolean,
): UseQueryResult<readonly number[]> {
  const { controller, state } = useConnection()
  return useQuery<readonly number[]>({
    queryKey: deviceIdsByCapsKey(capNames),
    enabled: enabled && capNames.length > 0 && state === 'connected',
    staleTime: BY_CAPS_STALE_MS,
    queryFn: async (): Promise<readonly number[]> => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      // Documented boundary: the tRPC proxy is walked by path (see cap-query.ts).
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'deviceManager',
        'listDeviceIdsByCaps',
        { capNames: [...capNames] },
        { deadlineMs: BULK_QUERY_DEADLINE_MS, rethrow: true },
      )
      const ids = parseDeviceIds(raw)
      if (ids === null) throw new Error('device ids by capability unreadable')
      return ids
    },
  })
}
