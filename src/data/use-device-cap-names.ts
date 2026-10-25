import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'
import { parseBindingCapNames } from './use-device-live-fields.js'

const EMPTY: readonly string[] = Object.freeze([])

/**
 * The capability NAMES a device is bound to (`deviceManager.getBindings`),
 * for gating a UI section on a cap the camera model does not flag as a
 * feature (`navigation` on a robot camera). Asked once per sheet open and
 * kept for five minutes: bindings change on re-registration, not by the
 * minute. Empty while unknown — a section gated on it stays hidden rather
 * than flashing.
 */
export function useDeviceCapNames(
  deviceId: number,
  enabled: boolean,
): UseQueryResult<readonly string[]> {
  const { controller, state } = useConnection()
  return useQuery<readonly string[]>({
    queryKey: ['v2', 'device-cap-names', deviceId],
    enabled: enabled && deviceId >= 0 && state === 'connected',
    staleTime: 5 * 60_000,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return EMPTY
      const raw = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'deviceManager',
        'getBindings',
        { deviceId },
      )
      return parseBindingCapNames(raw)
    },
  })
}
