import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'

/**
 * The cap names out of a `getBindings` answer — or `null` when the answer is
 * not `{ entries: [...] }`-shaped. A payload we cannot read is "unknown",
 * never "this device binds nothing" (D315).
 */
export function parseBoundCaps(raw: unknown): readonly string[] | null {
  if (raw === null || typeof raw !== 'object' || !('entries' in raw)) return null
  const { entries } = raw
  if (!Array.isArray(entries)) return null
  const names = new Set<string>()
  for (const entry of entries) {
    if (entry !== null && typeof entry === 'object' && 'capName' in entry) {
      const { capName } = entry
      if (typeof capName === 'string' && capName.length > 0) names.add(capName)
    }
  }
  return [...names]
}

const BOUND_CAPS_STALE_MS = 60_000

/**
 * The capability names ONE device is bound to (`deviceManager.getBindings`,
 * access: view), for the rule editor's Do step — the same list the admin's
 * step editor offers, and by construction the boundary the hub's executor
 * enforces (a cap the device does not hold fails at actuation time).
 *
 * Unlike `useDeviceCapNames` (a UI gate where unknown may read as empty), a
 * read that FAILED here is an error, never `[]`: "this device exposes nothing"
 * and "we could not ask" lead the operator to different fixes (D315).
 */
export function useDeviceBoundCaps(deviceId: number | undefined): UseQueryResult<readonly string[]> {
  const { controller, state } = useConnection()
  return useQuery<readonly string[]>({
    queryKey: ['v2', 'device-bound-caps', deviceId],
    enabled: deviceId !== undefined && state === 'connected',
    staleTime: BOUND_CAPS_STALE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system || deviceId === undefined) throw new Error('not connected')
      // Documented boundary: the tRPC proxy is walked by path (see cap-query.ts).
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'deviceManager',
        'getBindings',
        { deviceId },
      )
      const caps = parseBoundCaps(raw)
      if (caps === null) throw new Error(`device ${deviceId}: bindings unreadable`)
      return caps
    },
  })
}
