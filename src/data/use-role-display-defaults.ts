/**
 * useRoleIconDefaults — the operator-authored per-role display defaults
 * (`deviceManager.getRoleDisplayDefaults`, view access), icon only.
 *
 * One level of the accessory panel's icon precedence (local → device display
 * override → THIS → built-in role glyph → type). It is asked once per session
 * and shared: the map is fleet-wide and changes only when an admin edits it.
 * A hub that does not answer yields an EMPTY map, and every row falls through
 * to the next level — a glyph, not a claim about the fleet, so the fallback
 * loses nothing an operator could be misled by.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'
import { parseRoleIconDefaults } from '../accessories/accessory-wire.js'

const ROLE_DEFAULTS_STALE_MS = 5 * 60_000

export const EMPTY_ROLE_ICONS: Readonly<Record<string, string>> = Object.freeze({})

export function roleIconDefaultsKey(): readonly unknown[] {
  return ['v2', 'role-icon-defaults']
}

export function useRoleIconDefaults(
  enabled = true,
): UseQueryResult<Readonly<Record<string, string>>> {
  const { controller, state } = useConnection()
  return useQuery<Readonly<Record<string, string>>>({
    queryKey: roleIconDefaultsKey(),
    enabled: enabled && state === 'connected',
    staleTime: ROLE_DEFAULTS_STALE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return EMPTY_ROLE_ICONS
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'deviceManager',
        'getRoleDisplayDefaults',
        {},
      )
      return parseRoleIconDefaults(raw) ?? EMPTY_ROLE_ICONS
    },
  })
}
