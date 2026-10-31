/**
 * use-nc-target-options — the two reads a target form field makes of the hub.
 *
 *  - {@link useNcBrokers}: the existing brokers of one kind (`broker.list`), for
 *    a `broker-select` field.
 *  - {@link useNcDiscoveredTargets}: the candidates `discoverTargets` answers for
 *    the form's current values, for a `select` with `discoverOptions`. It is
 *    `enabled` only once the field's `dependsOn` values are filled, so a kind
 *    that needs credentials is never asked without them. `discoverTargets` is
 *    `auth: 'admin'` on the hub: a caller it refuses gets the error state, and
 *    the field stays a free-text input.
 *
 * The tRPC proxy is typed `unknown` at this boundary (the hub owns the shape);
 * results are parsed with zod rather than cast.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { z } from 'zod'
import { useConnection } from '../connection/ConnectionProvider.js'
import { ncNotConnectedError } from './nc-errors.js'

const BrokerRowSchema = z.object({ id: z.string(), kind: z.string(), name: z.string().optional() })
const BrokerListSchema = z.array(BrokerRowSchema)

export interface NcBroker {
  readonly id: string
  readonly name: string
}

const DiscoveredSchema = z.array(
  z.object({ suggestedName: z.string(), config: z.record(z.string(), z.unknown()) }),
)
export type NcDiscoveredCandidate = z.infer<typeof DiscoveredSchema>[number]

function procedure(root: unknown, path: readonly string[]): (input: unknown) => Promise<unknown> {
  let node: unknown = root
  for (const key of path) {
    node = (typeof node === 'object' || typeof node === 'function') && node !== null
      ? Reflect.get(node, key)
      : undefined
  }
  const query: unknown = node != null ? Reflect.get(node, 'query') : undefined
  if (typeof query !== 'function') throw new Error(`${path.join('.')} unavailable`)
  return (input) => Promise.resolve(Reflect.apply(query, node, [input]))
}

export function useNcBrokers(brokerKind: string): UseQueryResult<NcBroker[]> {
  const { controller, state } = useConnection()
  return useQuery<NcBroker[]>({
    queryKey: ['nc', 'brokers', brokerKind],
    enabled: state === 'connected' && brokerKind !== '',
    queryFn: async (): Promise<NcBroker[]> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      const raw = await procedure(system.trpcClient, ['broker', 'list'])({ kind: brokerKind })
      return BrokerListSchema.parse(raw)
        .filter((row) => row.kind === brokerKind)
        .map((row) => ({ id: row.id, name: row.name ?? row.id }))
    },
  })
}

export interface NcDiscoverVars {
  readonly kind: string
  readonly config: Record<string, string | number | boolean>
  /** Only fetch when true (dependsOn filled and typing settled). */
  readonly enabled: boolean
  /** The target being edited: lets the hub restore a redacted secret. */
  readonly targetId?: string
}

export function useNcDiscoveredTargets(vars: NcDiscoverVars): UseQueryResult<NcDiscoveredCandidate[]> {
  const { controller, state } = useConnection()
  return useQuery<NcDiscoveredCandidate[]>({
    queryKey: ['nc', 'discover', vars.kind, vars.config, vars.targetId ?? null],
    enabled: state === 'connected' && vars.enabled,
    retry: false,
    queryFn: async (): Promise<NcDiscoveredCandidate[]> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      const raw = await procedure(system.trpcClient, ['notificationOutput', 'discoverTargets'])({
        kind: vars.kind,
        config: vars.config,
        ...(vars.targetId ? { targetId: vars.targetId } : {}),
      })
      return DiscoveredSchema.parse(raw)
    },
  })
}
