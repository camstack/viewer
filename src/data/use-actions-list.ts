import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'
import { parseListedActions, type NcListedAction } from './listed-actions.js'

const ACTIONS_STALE_MS = 30_000

/**
 * The hub's Actions (`actions.list`, admin-only) — what a rule's hook edges
 * and notification buttons point at by id. Read only when `enabled` (the
 * Actions sub-screen, and the snooze verdict on the rules list, are an admin's).
 *
 * A read that FAILED is an error, never `[]`: "the hub has no Action" and
 * "we could not ask" lead the operator to different fixes (D315).
 */
export function useActionsList(enabled = true): UseQueryResult<readonly NcListedAction[]> {
  const { controller, state } = useConnection()
  return useQuery<readonly NcListedAction[]>({
    queryKey: ['v2', 'actions-list'],
    enabled: enabled && state === 'connected',
    staleTime: ACTIONS_STALE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      // Documented boundary: the tRPC proxy is walked by path (see cap-query.ts).
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'actions',
        'list',
        {},
      )
      const actions = parseListedActions(raw)
      if (actions === null) throw new Error('actions.list: unreadable or unavailable')
      return actions
    },
  })
}
