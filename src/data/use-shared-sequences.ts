import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { z } from 'zod'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'
import { NcSharedSequenceSchema, type NcSharedSequence } from './notification-center.js'

const ListSequencesResultSchema = z.object({ sequences: z.array(NcSharedSequenceSchema) })

/**
 * The answer of `notificationRules.listSequences`, or `null` when it is not
 * that shape. A payload we cannot read is "unknown", never "the hub has no
 * sequences" (D315).
 */
export function parseSharedSequences(raw: unknown): readonly NcSharedSequence[] | null {
  const parsed = ListSequencesResultSchema.safeParse(raw)
  return parsed.success ? parsed.data.sequences : null
}

const SEQUENCES_STALE_MS = 30_000

/**
 * The hub's SHARED action sequences (`notificationRules.listSequences`,
 * admin-only) — what a rule's hook bindings and notification buttons point at
 * by id. Read only when `enabled` (the Actions sub-screen is an admin's).
 *
 * A read that FAILED is an error, never `[]`: "the hub has no sequence" and
 * "we could not ask" lead the operator to different fixes (D315).
 */
export function useSharedSequences(enabled = true): UseQueryResult<readonly NcSharedSequence[]> {
  const { controller, state } = useConnection()
  return useQuery<readonly NcSharedSequence[]>({
    queryKey: ['v2', 'nc-shared-sequences'],
    enabled: enabled && state === 'connected',
    staleTime: SEQUENCES_STALE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      // Documented boundary: the tRPC proxy is walked by path (see cap-query.ts).
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'notificationRules',
        'listSequences',
        {},
      )
      const sequences = parseSharedSequences(raw)
      if (sequences === null) throw new Error('notificationRules.listSequences: unreadable or unavailable')
      return sequences
    },
  })
}
