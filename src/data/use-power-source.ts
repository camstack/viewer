/**
 * use-power-source — the power-source row's data: the status of a device's
 * linked switch and the three actions over it (`powerSource.getStatus`,
 * `powerOn`, `powerOff`, `forceRestart`).
 *
 * The status read keeps what went wrong. `capQuery` answers `null` only for a
 * hub that has no such procedure (an absent feature, a real answer: the row is
 * not drawn); a failed or unanswered call rethrows, so the query is in error
 * and the row says "unknown" instead of vanishing (an unanswered read must not
 * look like "no power source").
 *
 * An action is a mutation that RESOLVES with the typed result — a refusal is a
 * value the row shows as text, not an exception. Only a transport failure
 * rejects. After any action the status is read again.
 *
 * Cadence: a switch moves when a person moves it, so the backstop is the
 * app-wide reconcile interval; while a forced restart runs the row re-reads
 * every {@link RESTART_POLL_MS} so it follows the switch back on.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'

import { useConnection } from '../connection/ConnectionProvider.js'
import { capMutateOrThrow, capQuery } from './cap-query.js'
import { RECONCILE_MS } from './reconcile.js'
import {
  parsePowerSourceActionResult,
  parsePowerSourceStatus,
  type PowerSourceAction,
  type PowerSourceActionResult,
  type PowerSourceStatus,
} from './power-source.js'

const RESTART_POLL_MS = 3_000

export function powerSourceKey(deviceId: number): readonly unknown[] {
  return ['v2', 'power-source', deviceId]
}

/** `null` data = the hub has no power-source capability; an error = unknown. */
export function usePowerSourceStatus(deviceId: number): UseQueryResult<PowerSourceStatus | null> {
  const { controller, state } = useConnection()
  return useQuery<PowerSourceStatus | null>({
    queryKey: powerSourceKey(deviceId),
    enabled: Number.isFinite(deviceId) && state === 'connected',
    staleTime: RECONCILE_MS,
    refetchInterval: (query) =>
      query.state.data?.restartInProgress === true ? RESTART_POLL_MS : RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'powerSource',
        'getStatus',
        { deviceId },
        { rethrow: true },
      )
      if (raw === null) return null
      const status = parsePowerSourceStatus(raw)
      if (status === null) throw new Error('power source unreadable')
      return status
    },
  })
}

export function usePowerSourceAction(
  deviceId: number,
): UseMutationResult<PowerSourceActionResult, Error, PowerSourceAction> {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<PowerSourceActionResult, Error, PowerSourceAction>({
    mutationFn: async (action) => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw: unknown = await capMutateOrThrow(
        system.trpcClient as unknown as Record<string, unknown>,
        'powerSource',
        action,
        { deviceId },
      )
      const result = parsePowerSourceActionResult(raw)
      if (result === null) throw new Error('power source answer unreadable')
      return result
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: powerSourceKey(deviceId) })
    },
  })
}
