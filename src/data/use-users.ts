/**
 * The hub's users, for the rule editor's "Notify users" picker.
 *
 * `userManagement.listUsers` is admin-only on the hub, so the query runs only
 * for a CONFIRMED admin — asking as anyone else is a guaranteed refusal. Its
 * `isError` is a real state: a list the hub would not give must never read as
 * the empty list that means "there are no other users" (D315).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { z } from 'zod'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'

/** The two fields the picker uses out of the hub's `UserSummary`. */
const UserOptionRowSchema = z.object({ id: z.string().min(1), username: z.string() })
export type NcUserOption = z.infer<typeof UserOptionRowSchema>

/**
 * The wire → the picker's options. Not a list at all THROWS (unknown); a row
 * without an id is dropped (it cannot be addressed).
 */
export function parseUserOptions(raw: unknown): readonly NcUserOption[] {
  if (!Array.isArray(raw)) throw new Error('userManagement.listUsers: not a list')
  const rows: NcUserOption[] = []
  for (const row of raw) {
    const parsed = UserOptionRowSchema.safeParse(row)
    if (parsed.success) rows.push({ id: parsed.data.id, username: parsed.data.username })
  }
  return rows
}

export function useUsers(enabled: boolean): UseQueryResult<readonly NcUserOption[]> {
  const { controller, state } = useConnection()
  return useQuery<readonly NcUserOption[]>({
    queryKey: ['v2', 'users'],
    enabled: enabled && state === 'connected',
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      // Documented boundary: the tRPC proxy read through `capQuery` (as `useMe`).
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'userManagement',
        'listUsers',
        undefined,
        { rethrow: true },
      )
      return parseUserOptions(raw)
    },
  })
}
