/**
 * The apps the shell may offer: `apps.listApps` (D1096).
 *
 * The hub filters by the caller's role, so the shell asks once per session and
 * draws exactly what came back. A read that FAILED throws, so the query is in
 * error and the catalog is `unknown` — never an empty list that would claim "no
 * app is offered" (D315). A hub without the `apps` capability answers `null`,
 * which is likewise unreadable, not empty.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useServer } from '../app/ServerProvider.js'
import { sessionDiscriminator } from '../app/session-key.js'
import { catalogOf, parseAppInfos, type AppCatalog } from '../apps/app-catalog.js'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'

/** The list moves with addon installs, not by the second. */
const APPS_STALE_MS = 60_000

export function appsQueryKey(serverUrl: string | null, token: string | null): readonly unknown[] {
  return ['v2', 'apps', serverUrl, sessionDiscriminator(token)]
}

export interface AppCatalogHandle {
  readonly catalog: AppCatalog
  readonly refetch: () => void
}

export function useAppCatalog(): AppCatalogHandle {
  const { controller, state } = useConnection()
  const { server, sessionToken } = useServer()
  const query = useQuery({
    queryKey: appsQueryKey(server?.serverUrl ?? null, sessionToken),
    enabled: state === 'connected',
    staleTime: APPS_STALE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      // Documented boundary: the tRPC proxy is walked by path (see cap-query.ts).
      const raw: unknown = await capQuery(system.trpcClient as unknown as Record<string, unknown>, 'apps', 'listApps', {}, { rethrow: true })
      const apps = parseAppInfos(raw)
      if (apps === null) throw new Error('apps.listApps unreadable')
      return apps
    },
  })
  const { status, data, refetch } = query
  // Not connected yet is pending (no answer), not a failure.
  const catalog = useMemo(() => catalogOf({ status: state === 'connected' || status !== 'pending' ? status : 'pending', data }), [state, status, data])
  return { catalog, refetch: () => void refetch() }
}
