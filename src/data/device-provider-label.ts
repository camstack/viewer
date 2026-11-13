/**
 * Who offers a device, for the device sheet's header: "{addon name}
 * ({integration name})" — the integration part only when the device comes from
 * a named integration instance — otherwise just "{addon name}". The same rule
 * the hub's device card draws on its own top line
 * (`formatProviderLabel` in the ui-library), so the sheet that replaces that
 * line says the same thing.
 *
 * A label is a hint, never a gate: an addon the hub does not name, or a read
 * that fails, draws no chip rather than a guess.
 */
import { useQuery } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery, isRecord } from './cap-query.js'

/** Who provides a device, as the identity row names it. */
export interface DeviceProviderRef {
  readonly addonId: string
  readonly integrationId: string | null
}

/**
 * "Home Assistant (Casa)", or "Home Assistant" when the instance has no name of
 * its own: empty, or one that repeats the addon's ("Home Assistant provider").
 */
export function formatProviderLabel(addonName: string, integrationName: string | null): string {
  const instance = integrationName?.trim() ?? ''
  const repeatsAddon = instance.toLowerCase().includes(addonName.trim().toLowerCase())
  return instance === '' || repeatsAddon ? addonName : `${addonName} (${instance})`
}

/** The providing addon and integration of a `deviceManager.listAll` row, or null. */
export function toProviderRef(row: unknown): DeviceProviderRef | null {
  if (!isRecord(row)) return null
  const { addonId, integrationId } = row
  if (typeof addonId !== 'string' || addonId === '') return null
  return {
    addonId,
    integrationId: typeof integrationId === 'string' && integrationId !== '' ? integrationId : null,
  }
}

/** The manifest name `addons.list` gives an addon id, or null. */
export function addonNameOf(list: unknown, addonId: string): string | null {
  if (!Array.isArray(list)) return null
  for (const entry of list) {
    if (!isRecord(entry) || !isRecord(entry.manifest)) continue
    const { id, name } = entry.manifest
    if (id === addonId && typeof name === 'string' && name.trim() !== '') return name.trim()
  }
  return null
}

/** The instance name `integrations.get` answered, or null. */
export function integrationNameOf(row: unknown): string | null {
  return isRecord(row) && typeof row.name === 'string' ? row.name : null
}

/** A tRPC client proxy is a callable node (typeof 'function'), a plain client an object. */
function isCallableNode(v: unknown): v is Record<string, unknown> {
  return v !== null && (typeof v === 'object' || typeof v === 'function')
}

/** Addon names barely move: one read serves every sheet for a while. */
const PROVIDER_LABEL_STALE_MS = 5 * 60_000

/** The provider label of a device, `null` while unanswered or when the hub names no addon. */
export function useDeviceProviderLabel(ref: DeviceProviderRef | null): string | null {
  const { controller, state } = useConnection()
  const query = useQuery<string | null>({
    queryKey: ['v2', 'device-provider-label', ref?.addonId ?? null, ref?.integrationId ?? null],
    enabled: state === 'connected' && ref !== null,
    staleTime: PROVIDER_LABEL_STALE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system || ref === null) return null
      const node: unknown = system.trpcClient
      if (!isCallableNode(node)) return null
      const [addons, integration] = await Promise.all([
        capQuery(node, 'addons', 'list'),
        ref.integrationId === null
          ? Promise.resolve(null)
          : capQuery(node, 'integrations', 'get', { id: ref.integrationId }),
      ])
      const addonName = addonNameOf(addons, ref.addonId)
      return addonName === null ? null : formatProviderLabel(addonName, integrationNameOf(integration))
    },
  })
  return query.data ?? null
}
