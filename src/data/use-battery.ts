import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { reportSessionEnded } from '../auth/session-ended.js'
import { useConnection } from '../connection/ConnectionProvider.js'
import { isRecord } from './cap-query.js'
import { BATTERY_LEVEL, readQuantityNumber } from './quantity-fields.js'
import { RECONCILE_MS } from './reconcile.js'

/** Battery status as exposed by the `battery` cap's auto-injected `getStatus`
 *  procedure. Shape mirrors `BatteryStatusSchema`
 *  (`packages/types/src/capabilities/battery.cap.ts`). Only the fields the card
 *  consumes are typed here; the procedure is server-typed end-to-end. */
export interface BatteryStatus {
  /** The charge, 0–100 (`level` on the hub; an older hub calls it `percentage`). */
  readonly level: number
  readonly charging: 'dc' | 'solar' | 'none' | 'unknown'
  readonly sleeping: boolean
  readonly binary?: boolean
}

/** Narrow a raw `battery` slice. `null` when it carries no numeric level. */
export function toBatteryStatus(raw: unknown): BatteryStatus | null {
  if (!isRecord(raw)) return null
  const level = readQuantityNumber(raw, BATTERY_LEVEL)
  if (level === undefined) return null
  const charging = raw.charging
  const battery: {
    level: number
    charging: BatteryStatus['charging']
    sleeping: boolean
    binary?: boolean
  } = {
    level,
    // 'none' is a NEGATIVE the hub reported; anything it did not say is unknown.
    charging:
      charging === 'dc' || charging === 'solar' || charging === 'none' ? charging : 'unknown',
    sleeping: raw.sleeping === true,
  }
  if (raw.binary === true) battery.binary = true
  return battery
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
        const raw: unknown = await system.trpcClient.battery.getStatus.query({ deviceId })
        return toBatteryStatus(raw)
      } catch (err) {
        // Swallowed to "unknown" on purpose; a revoked session must still be heard.
        reportSessionEnded(err)
        return null
      }
    },
  })
}
