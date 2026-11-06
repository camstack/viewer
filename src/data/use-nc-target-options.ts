/**
 * use-nc-target-options — the two reads a target form field makes of the hub.
 *
 *  - {@link useNcInstances}: the existing instances of one function cap (and kind),
 *    read through the `integration-instances` holders, for an `instance-select` field.
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

const ProviderRowSchema = z.object({ addonId: z.string() })
const ProviderListSchema = z.array(ProviderRowSchema)
const KindRowSchema = z.object({
  id: z.string(),
  functionCap: z.string().optional(),
  brokerKind: z.string().optional(),
})
const DescriptionSchema = z.object({ kinds: z.array(KindRowSchema).optional() })
const InstanceRowSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  kind: z.string().optional(),
  configured: z.boolean().optional(),
  enabled: z.boolean().optional(),
  status: z.object({ state: z.string().optional() }).optional(),
})
const InstanceListSchema = z.array(InstanceRowSchema)

export interface NcInstance {
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

type InstanceRow = z.infer<typeof InstanceRowSchema>

/** Switched on, configured and not failing; the chosen one is always kept by the caller. */
function isUsable(row: InstanceRow): boolean {
  return (
    row.enabled !== false &&
    row.configured !== false &&
    row.status?.state !== 'off' &&
    row.status?.state !== 'error'
  )
}

/** Every provider of `functionCap` that also holds `integration-instances`, then their
 *  instances whose kind is configured for the cap (narrowed to `kind`). Same read the admin
 *  picker makes. */
export function useNcInstances(functionCap: string, kind?: string): UseQueryResult<NcInstance[]> {
  const { controller, state } = useConnection()
  return useQuery<NcInstance[]>({
    queryKey: ['nc', 'instances', functionCap, kind ?? null],
    enabled: state === 'connected' && functionCap !== '',
    queryFn: async (): Promise<NcInstance[]> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      const root = system.trpcClient
      const providers = ProviderListSchema.parse(
        await procedure(root, ['addons', 'listCapabilityProviders'])({ capName: functionCap }),
      )
      const holders = ProviderListSchema.parse(
        await procedure(root, ['addons', 'listCapabilityProviders'])({ capName: 'integration-instances' }),
      )
      const holding = new Set(holders.map((p) => p.addonId))
      const addonIds = providers.map((p) => p.addonId).filter((id) => holding.has(id))
      const out: NcInstance[] = []
      for (const addonId of addonIds) {
        const [description, rows] = await Promise.all([
          procedure(root, ['integrationInstances', 'describe'])({ addonId }).then((r) => DescriptionSchema.parse(r)),
          procedure(root, ['integrationInstances', 'listInstances'])({ addonId }).then((r) => InstanceListSchema.parse(r)),
        ])
        const kinds = description.kinds ?? []
        for (const row of rows) {
          const own = kinds.find((k) => k.id === row.kind)
          if (own === undefined || own.functionCap !== functionCap) continue
          if (kind !== undefined && (own.brokerKind ?? own.id) !== kind) continue
          if (isUsable(row)) out.push({ id: row.id, name: row.name ?? row.id })
        }
      }
      return out
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
