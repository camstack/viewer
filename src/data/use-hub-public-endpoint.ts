import { useQuery } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'

/** `pending` = not answered yet (never read as "not configured"); `absent` = the
 *  hub answered and no address is flagged / resolved as public. */
export type HubPublicEndpoint =
  | { readonly status: 'pending' }
  | { readonly status: 'absent' }
  | { readonly status: 'present'; readonly url: string }

/** Pure projection of a `localNetwork.getAddresses` answer: the
 *  `roles.publicEndpoint.resolved` address, or null. */
export function publicEndpointOf(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const roles: unknown = Reflect.get(raw, 'roles')
  if (typeof roles !== 'object' || roles === null) return null
  const role: unknown = Reflect.get(roles, 'publicEndpoint')
  if (typeof role !== 'object' || role === null) return null
  const resolved: unknown = Reflect.get(role, 'resolved')
  return typeof resolved === 'string' && resolved.length > 0 ? resolved : null
}

/** The hub's public address, from `localNetwork.getAddresses` (the address
 *  flagged public on the Network page) — never config or env. */
export function useHubPublicEndpoint(enabled: boolean): HubPublicEndpoint {
  const { controller, state } = useConnection()
  const query = useQuery<string | null>({
    queryKey: ['v2', 'hub-public-endpoint'],
    enabled: enabled && state === 'connected',
    staleTime: 60_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'localNetwork',
        'getAddresses',
        { scheme: 'https' },
        { rethrow: true },
      )
      if (raw === null) throw new Error('localNetwork.getAddresses unavailable')
      return publicEndpointOf(raw)
    },
  })
  if (query.status === 'success') {
    return query.data === null ? { status: 'absent' } : { status: 'present', url: query.data }
  }
  return { status: 'pending' }
}
