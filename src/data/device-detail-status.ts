/**
 * What the device detail screen reads natively: the device's identity, for its
 * header. Everything below the header is the hub's device card
 * (`src/device-embed/`), which reads its own slices.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'
import { RECONCILE_MS } from './reconcile.js'
import { toProviderRef, type DeviceProviderRef } from './device-provider-label.js'
import { toAccessory, type AccessoryDevice } from './use-accessories.js'

/** A device's identity plus who provides it (`null` when the row names no addon). */
export interface DeviceIdentity extends AccessoryDevice {
  readonly provider: DeviceProviderRef | null
}

/** A tRPC client proxy is a callable node (typeof 'function'), a plain client an object. */
function isCallableNode(v: unknown): v is Record<string, unknown> {
  return v !== null && (typeof v === 'object' || typeof v === 'function')
}

/** One device's identity (name, type, online, features) — `null` while unanswered or unreadable. */
export function useDeviceIdentity(deviceId: number): UseQueryResult<DeviceIdentity | null> {
  const { controller, state } = useConnection()
  return useQuery<DeviceIdentity | null>({
    queryKey: ['v2', 'device-identity', deviceId],
    enabled: state === 'connected',
    staleTime: RECONCILE_MS,
    refetchInterval: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return null
      const client: unknown = system.trpcClient
      if (!isCallableNode(client)) return null
      const raw: unknown = await capQuery(
        client,
        'deviceManager',
        'listAll',
        { deviceIds: [deviceId] },
      )
      if (!Array.isArray(raw)) return null
      for (const row of raw) {
        const device = toAccessory(row)
        if (device !== null && device.id === deviceId) return { ...device, provider: toProviderRef(row) }
      }
      return null
    },
  })
}
