/**
 * useZoneRefs — the admin zones of a set of cameras, by NAME.
 *
 * The `zones` cap is device-scoped, so "the zones this rule can talk about" is
 * the union over the rule's selected cameras. The fan-out lives inside ONE
 * query (keyed on the sorted device ids) rather than a `useQueries` array so
 * the caller gets a single loading flag: a picker that flickers between
 * "loading" and "this zone no longer exists" as each camera lands would mark a
 * perfectly good zone as deleted.
 *
 * Degrades to an empty list off-connection or when the cap is absent —
 * `capQuery` already absorbs both — and the caller must treat EMPTY as "not
 * known yet", never as "the zone was deleted".
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'
import { mergeZoneLists, parseZoneList, type NcZoneRef } from './zones.js'
import type { CameraZoneList } from './zone-choices.js'

/** Stable empty list so consumers get a referentially-stable default. */
const EMPTY_ZONES: readonly NcZoneRef[] = []

/** The union of the given cameras' admin zones. Empty with no camera selected. */
export function useZoneRefs(deviceIds: readonly number[]): UseQueryResult<readonly NcZoneRef[]> {
  const { controller, state } = useConnection()
  const ids = [...deviceIds].sort((a, b) => a - b)
  return useQuery<readonly NcZoneRef[]>({
    queryKey: ['v2', 'zones', 'refs', ids],
    enabled: state === 'connected' && ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return EMPTY_ZONES
      const client = system.trpcClient as Record<string, unknown>
      const lists = await Promise.all(
        ids.map(async (deviceId) => parseZoneList(await capQuery(client, 'zones', 'listZones', { deviceId }))),
      )
      return mergeZoneLists(lists)
    },
  })
}

/**
 * Each camera's admin zones, kept PER CAMERA — what the rule's zone scope
 * field names as `camera:zone`. The same one-query fan-out as
 * {@link useZoneRefs}; `enabled` lets the field read nothing until it is
 * shown in a list mode.
 */
export function useCameraZoneLists(
  deviceIds: readonly number[],
  enabled: boolean,
): UseQueryResult<readonly CameraZoneList[]> {
  const { controller, state } = useConnection()
  const ids = [...deviceIds].sort((a, b) => a - b)
  return useQuery<readonly CameraZoneList[]>({
    queryKey: ['v2', 'zones', 'by-camera', ids],
    enabled: enabled && state === 'connected' && ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return []
      const client = system.trpcClient as Record<string, unknown>
      return Promise.all(
        ids.map(async (deviceId) => ({
          deviceId,
          zones: parseZoneList(await capQuery(client, 'zones', 'listZones', { deviceId })),
        })),
      )
    },
  })
}
