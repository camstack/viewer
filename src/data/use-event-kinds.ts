/**
 * useEventKinds — the event-kind taxonomy for one or more cameras.
 *
 * The wire is {@link loadEventKinds}: one `listEventKindsBatch`, with a
 * per-camera fan-out only when that procedure is missing. A timeout returns
 * `[]` rather than amplifying hub-main load. Degrades to `[]` when not
 * connected.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { loadEventKinds } from './event-kinds-load.js'
import type { EventKindDescriptor } from './event-kinds.js'

const EMPTY: readonly EventKindDescriptor[] = []

/**
 * Event kinds for one or more cameras (merged, de-duped by kind). `[]` when the
 * device set is empty, not connected, or the cap is absent.
 */
export function useEventKinds(
  deviceIds: readonly number[],
): UseQueryResult<readonly EventKindDescriptor[]> {
  const { controller, state } = useConnection()
  // Stable, order-independent key so re-selecting the same set is cache-hot.
  const idsKey = [...new Set(deviceIds)].sort((a, b) => a - b)

  return useQuery<readonly EventKindDescriptor[]>({
    queryKey: ['v2', 'event-kinds', idsKey],
    enabled: state === 'connected' && idsKey.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return EMPTY
      return loadEventKinds(system.trpcClient as Record<string, unknown>, idsKey)
    },
  })
}
