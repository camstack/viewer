import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { reportSessionEnded } from '../auth/session-ended.js'
import { useConnection } from '../connection/ConnectionProvider.js'
import { RECONCILE_MS } from './reconcile.js'

/** Battery status as exposed by the `battery` cap's auto-injected `getStatus`
 *  procedure. Shape mirrors `BatteryStatusSchema`
 *  (`packages/types/src/capabilities/battery.cap.ts`). Only the fields the card
 *  consumes are typed here; the procedure is server-typed end-to-end. */
export interface BatteryStatus {
  readonly percentage: number
  readonly charging: 'dc' | 'solar' | 'none' | 'unknown'
  readonly sleeping: boolean
  readonly binary?: boolean
}


/** Live battery status for a battery-operated device.
 *
 *  Backed by the `battery` cap: declaring a `status` block auto-injects a
 *  `getStatus({ deviceId })` query on the provider, surfaced on the tRPC client
 *  as `battery.getStatus.query({ deviceId })` (confirmed against the cap def).
 *  Gate `enabled` on the `'battery-operated'` feature so wired cams never call
 *  it (and never wake nonexistent firmware). Returns `null` on error. */
export function useBattery(deviceId: number, enabled: boolean): UseQueryResult<BatteryStatus | null> {
  const { controller, state } = useConnection()
  return useQuery<BatteryStatus | null>({
    queryKey: ['v2', 'battery', deviceId],
    enabled: enabled && state === 'connected',
    // Paired with the interval on purpose: without it the global 5s
    // default makes this stale long before its own cadence, so every
    // remount refetches and the reconcile design does nothing.
    staleTime: RECONCILE_MS,
    refetchInterval: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return null
      try {
        return (await system.trpcClient.battery.getStatus.query({ deviceId })) as BatteryStatus
      } catch (err) {
        // Swallowed to "unknown" on purpose; a revoked session must still be heard.
        reportSessionEnded(err)
        return null
      }
    },
  })
}
