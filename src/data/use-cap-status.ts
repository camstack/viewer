/**
 * Shared device-scoped cap status reader.
 *
 * Every controllable accessory cap (`switch`, `lock-control`, `cover`,
 * `brightness`, `alarm-panel`, sensors…) declares a `status` block, which the
 * server codegen auto-injects as a `getStatus({ deviceId })` query on that cap's
 * tRPC router (confirmed against `generated-cap-routers.ts`). This helper wraps
 * the call in a uniform react-query hook so each per-cap status hook is a tiny,
 * typed narrowing on top.
 *
 * The raw payload is server-validated end-to-end; on the client it arrives as
 * `unknown` here and each caller narrows it with a type guard (no `any`).
 */
import { useCallback } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { RECONCILE_MS } from './reconcile.js'

/**
 * Read a device-scoped cap's `getStatus({ deviceId })` and narrow it to `T`.
 *
 * `capKey` is the camelCase tRPC client key (`switch`, `lockControl`,
 * `alarmPanel`, `temperatureSensor`…) — NOTE the wire `features` array carries
 * kebab-case names, so the registry maps kebab → this camelCase key.
 *
 * `enabled` gates the query (skip offline rows / absent caps). Returns `null`
 * on error or when the payload fails the guard.
 */
export function useCapStatus<T>(
  capKey: string,
  deviceId: number,
  guard: (raw: unknown) => raw is T,
  enabled: boolean,
): UseQueryResult<T | null> {
  const { controller, state } = useConnection()
  const narrow = useCallback(
    (raw: unknown): T | null => (guard(raw) ? raw : null),
    [guard],
  )
  return useQuery<T | null>({
    queryKey: ['v2', 'cap-status', capKey, deviceId],
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
        const router = (system.trpcClient as Record<string, unknown>)[capKey]
        if (!isStatusRouter(router)) return null
        const raw = await router.getStatus.query({ deviceId })
        return narrow(raw)
      } catch {
        return null
      }
    },
  })
}

/** A tRPC cap router exposing the auto-injected `getStatus` query. */
interface StatusRouter {
  readonly getStatus: { readonly query: (input: { deviceId: number }) => Promise<unknown> }
}

/** True when a value is a navigable node: a plain object OR a tRPC v11 client
 *  proxy node (which is a callable `Proxy(noop)` → `typeof === 'function'`, NOT
 *  an object). The old `typeof === 'object'`-only check REJECTED every real
 *  client proxy, so `getStatus` never ran and controls read as absent. */
function isNode(value: unknown): value is Record<string, unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/** True when `value` exposes a callable `getStatus.query`. */
export function isStatusRouter(value: unknown): value is StatusRouter {
  if (!isNode(value)) return false
  const status = value.getStatus
  if (!isNode(status)) return false
  return typeof status.query === 'function'
}
