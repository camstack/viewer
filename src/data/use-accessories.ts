/**
 * useAccessories — child / accessory devices linked to a camera.
 *
 * Reads the kernel-managed device tree via `deviceManager.getChildren(
 * { parentDeviceId })`, which returns each child `DeviceInfo` directly. This
 * replaces the device-scoped `accessories` cap (registered only by HA container
 * parents — it REJECTS "not registered" on real camera devices, leaving the
 * panel permanently empty). `getChildren` is uniform across all device types,
 * never rejects, and returns an empty list for a camera with no children.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { RECONCILE_MS } from './reconcile.js'

/** A resolved, UI-visible accessory child. */
export interface AccessoryDevice {
  readonly id: number
  readonly name: string
  /** Canonical device-type string (e.g. `light`, `siren`, `lock`, `sensor`). */
  readonly type: string
  readonly online: boolean
  /**
   * Kebab-case capability names the child advertises (`DeviceInfo.features`),
   * e.g. `switch`, `lock-control`, `cover`, `brightness`, `alarm-panel`,
   * `temperature-sensor`. The control registry picks the row's primary control
   * from this list. Empty when the child exposes no controllable caps.
   */
  readonly features: readonly string[]
}


/** True when `value` is an indexable object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Narrow an unknown value to a list of capability-name strings. */
export function toFeatures(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) return EMPTY_FEATURES
  const out = raw.filter((f): f is string => typeof f === 'string' && f.length > 0)
  return out.length > 0 ? out : EMPTY_FEATURES
}

/** Stable empty reference so childless rows don't churn the query cache. */
const EMPTY_FEATURES: readonly string[] = []

/** Narrow a resolved `DeviceInfo` to the fields the panel renders. Shared with
 *  `use-linked-devices`' children fallback so both paths map identically. */
export function toAccessory(raw: unknown): AccessoryDevice | null {
  if (!isRecord(raw)) return null
  const { id, name, type, online, features } = raw
  if (typeof id !== 'number' || typeof type !== 'string') return null
  return {
    id,
    name: typeof name === 'string' && name.trim() ? name.trim() : `Device #${id}`,
    type,
    online: online === true,
    features: toFeatures(features),
  }
}

/**
 * Visible accessory children for `deviceId`, resolved to display rows. React
 * Query caches and refetches periodically.
 */
export function useAccessories(deviceId: number): UseQueryResult<AccessoryDevice[]> {
  const { controller, state } = useConnection()
  return useQuery<AccessoryDevice[]>({
    queryKey: ['v2', 'accessories', deviceId],
    enabled: state === 'connected',
    // Paired with the interval on purpose: without it the global 5s
    // default makes this stale long before its own cadence, so every
    // remount refetches and the reconcile design does nothing.
    staleTime: RECONCILE_MS,
    refetchInterval: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return []
      try {
        // Children are the kernel-managed device tree (`parentDeviceId`), not
        // the `accessories` cap — which is only registered by HA container
        // parents and REJECTS ("not registered") on real camera devices.
        // `deviceManager.getChildren` is the authoritative parent→child surface:
        // it works for every device type (reolink/hikvision/onvif/nvr/HA),
        // never rejects, and returns `[]` for a childless camera.
        const children = await system.trpcClient.deviceManager.getChildren.query({
          parentDeviceId: deviceId,
        })
        const list = Array.isArray(children) ? children : []
        for (const c of list) {
          if (isRecord(c)) {
            console.warn(
              '[accessories] child',
              c.id,
              'type=',
              String(c.type),
              'keys=',
              Object.keys(c).join(','),
              'features=',
              JSON.stringify(c.features),
            )
          }
        }
        return list
          .map(toAccessory)
          .filter((a): a is AccessoryDevice => a !== null)
      } catch (e) {
        console.warn('[accessories] error device', deviceId, e instanceof Error ? e.message : String(e))
        return []
      }
    },
  })
}
