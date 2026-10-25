/**
 * useNodeDirectory — every node of the cluster as the system family's node
 * picker lists it (D637): `nodes.directory`, the registry's nodes plus the
 * node history, with `complete: false` when that history could not be read.
 *
 * It is cheap (no fan-out to the nodes, unlike `nodes.topology`), but it is
 * still read only while `enabled` — the picker's sheet is open, or a stored
 * id needs naming.
 *
 * An answer that does not parse THROWS: the query errors and the picker says
 * "could not read", never "no nodes" (D315).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { NodeDirectorySchema } from '@camstack/types/client'
import type { NodeDirectory } from '@camstack/types'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'

const NODE_DIRECTORY_STALE_MS = 60_000

export function nodeDirectoryKey(): readonly unknown[] {
  return ['v2', 'nc-pickers', 'node-directory']
}

/** The directory, or `null` when the answer is not one. */
export function parseNodeDirectory(raw: unknown): NodeDirectory | null {
  const parsed = NodeDirectorySchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export function useNodeDirectory(enabled: boolean): UseQueryResult<NodeDirectory> {
  const { controller, state } = useConnection()
  return useQuery<NodeDirectory>({
    queryKey: nodeDirectoryKey(),
    enabled: enabled && state === 'connected',
    staleTime: NODE_DIRECTORY_STALE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'nodes',
        'directory',
        undefined,
        { rethrow: true },
      )
      const directory = parseNodeDirectory(raw)
      if (directory === null) throw new Error('node directory unreadable')
      return directory
    },
  })
}
