/**
 * useLocalAccessories — resolve the operator's LOCAL additions to devices.
 *
 * The additions are ids in the camera's prefs document; the hub is asked for
 * exactly those rows (`deviceManager.listAll` with `deviceIds`, `slim`) — a
 * join onto a handful of ids, never a fleet listing, the same discipline
 * `useLinkedDevices`' enrichment keeps. No additions ⇒ no call at all.
 *
 * A row the hub no longer has simply does not come back and the addition
 * draws nothing (the rule never invents a row); the addition itself is kept,
 * because a device that is offline or momentarily unlisted is not a device
 * the operator un-added.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from '../data/cap-query.js'
import { RECONCILE_MS } from '../data/reconcile.js'
import { parseAccessoryPanelDevices } from './accessory-wire.js'
import type { AccessoryPanelDevice } from './accessory-panel-rows.js'

const LOCAL_ACCESSORIES_STALE_MS = 30_000

export const NO_LOCAL_ACCESSORIES: readonly AccessoryPanelDevice[] = Object.freeze([])

export function localAccessoriesKey(deviceIds: readonly number[]): readonly unknown[] {
  return ['v2', 'local-accessories', [...deviceIds].sort((a, b) => a - b).join(',')]
}

export function useLocalAccessories(
  deviceIds: readonly number[],
): UseQueryResult<readonly AccessoryPanelDevice[]> {
  const { controller, state } = useConnection()
  const ids = [...deviceIds]
  return useQuery<readonly AccessoryPanelDevice[]>({
    queryKey: localAccessoriesKey(ids),
    enabled: ids.length > 0 && state === 'connected',
    staleTime: LOCAL_ACCESSORIES_STALE_MS,
    refetchInterval: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'deviceManager',
        'listAll',
        { projection: 'slim', deviceIds: ids },
      )
      const devices = parseAccessoryPanelDevices(raw)
      if (devices === null) throw new Error('local accessory rows unreadable')
      return devices
    },
  })
}
