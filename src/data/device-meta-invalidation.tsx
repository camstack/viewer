/**
 * Metadata changes on the hub reach the app IMMEDIATELY, instead of whenever a
 * staleness window happens to lapse.
 *
 * Before this, the viewer subscribed to server events for motion and doorbell
 * only. Every other fact about a device — its location, its name, which child a
 * container stands for, whether it is disabled — refreshed by poll or by
 * remount. So the operator changed something on the hub and watched an
 * unchanged screen: a camera list that still said "disabled" until a
 * pull-to-refresh, and companion devices that never appeared. The server knew
 * and never said so.
 *
 * The invalidation is DELIBERATELY broad. A meta change on ANY device can move
 * ANOTHER device's linked list, because the auto-link rule matches on location:
 * re-saving a container's room changes what a camera in that room links to.
 * Narrowing this to the changed `deviceId` would be precise and wrong.
 */
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { log } from '../lib/logger.js'

/**
 * Bus category for an operator-edited meta field (`EventCategory.DeviceMetaChanged`).
 * MUST equal the hub's kebab-case bus value — a regression test pins it.
 */
export const DEVICE_META_CHANGED_CATEGORY = 'device.meta-changed'

/** Query-key heads a metadata change can invalidate. */
export const META_SENSITIVE_KEY_HEADS: readonly (readonly string[])[] = [
  ['v2', 'cameras'],
  ['v2', 'linked-devices'],
  ['v2', 'accessories'],
]

/** The changed device's id, when the payload carries one. */
export function parseMetaChangedDeviceId(event: unknown): number | null {
  if (typeof event !== 'object' || event === null) return null
  const data = Reflect.get(event, 'data')
  if (typeof data !== 'object' || data === null) return null
  const id = Reflect.get(data, 'deviceId')
  return typeof id === 'number' && Number.isFinite(id) ? id : null
}

/**
 * Headless bridge: subscribe once, invalidate the meta-sensitive queries on
 * every change. Mounted near the top of the tree, inside the connection
 * provider.
 */
export function DeviceMetaInvalidationBridge({
  children,
}: {
  children: React.ReactNode
}): React.ReactNode {
  const queryClient = useQueryClient()
  const { controller, state } = useConnection()

  useEffect(() => {
    if (state !== 'connected') return
    const system = controller.getSystem()
    if (!system) return

    const unsubscribe = system.subscribeEvent(DEVICE_META_CHANGED_CATEGORY, (event: unknown) => {
      const deviceId = parseMetaChangedDeviceId(event)
      log.info('data:reconcile', 'device meta changed — invalidating', {
        deviceId: deviceId ?? 'unknown',
      })
      for (const queryKey of META_SENSITIVE_KEY_HEADS) {
        void queryClient.invalidateQueries({ queryKey: [...queryKey] })
      }
    })

    return () => unsubscribe()
  }, [controller, state, queryClient])

  return children
}
