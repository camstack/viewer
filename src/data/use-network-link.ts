import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery, isRecord } from './cap-query.js'
import { NETWORK_SIGNAL, readQuantityNullable } from './quantity-fields.js'
import { RECONCILE_MS } from './reconcile.js'

/** The device's own network link, as the `network-link` cap's auto-injected
 *  `getStatus` reports it. Shape mirrors `NetworkLinkStatusSchema`
 *  (`packages/types/src/capabilities/network-link.cap.ts`). Only the fields the
 *  badge consumes are typed here. */
export interface NetworkLinkStatus {
  readonly type: 'wifi' | 'ethernet' | 'cellular' | 'unknown'
  /** `null` = not known or not applicable (a wire has no signal). */
  readonly signal: number | null
  readonly ssid?: string
}

/** Narrow a raw slice. `unknown` is the absence of a read: kept as such, never
 *  turned into a wire. Exported for the badge-batch parser. */
export function toNetworkLink(raw: unknown): NetworkLinkStatus | null {
  if (!isRecord(raw)) return null
  const type = raw.type
  if (type !== 'wifi' && type !== 'ethernet' && type !== 'cellular' && type !== 'unknown') return null
  // `signal` on the hub; an older hub calls it `signalPercent`.
  const link: { type: NetworkLinkStatus['type']; signal: number | null; ssid?: string } = {
    type,
    signal: readQuantityNullable(raw, NETWORK_SIGNAL) ?? null,
  }
  if (typeof raw.ssid === 'string' && raw.ssid !== '') link.ssid = raw.ssid
  return link
}

/** Live link status for a device. Returns `null` when the hub has no such
 *  procedure (an older server) or the device carries no slice. */
export function useNetworkLink(
  deviceId: number,
  enabled: boolean,
): UseQueryResult<NetworkLinkStatus | null> {
  const { controller, state } = useConnection()
  return useQuery<NetworkLinkStatus | null>({
    queryKey: ['v2', 'network-link', deviceId],
    enabled: enabled && state === 'connected',
    staleTime: RECONCILE_MS,
    refetchInterval: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return null
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'networkLink',
        'getStatus',
        { deviceId },
      )
      return toNetworkLink(raw)
    },
  })
}
