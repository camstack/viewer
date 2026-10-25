/**
 * useCurrentOccupancy / useCameraOccupancyHistory — TanStack Query hooks over the
 * hub's `zoneAnalytics` cap (per-camera occupancy).
 *
 * `useCurrentOccupancy` polls the LIVE snapshot (`getCurrentSnapshot`) — this is
 * the occupancy that renders on the live camera view. `useCameraOccupancyHistory`
 * fetches the frame-wide time series (`getCameraHistory`).
 *
 * ⚠️ History is a 60-MINUTE in-memory ring on the server (see `occupancy.ts`):
 * queries older than that return empty. Occupancy for the EVENTS page and PAST
 * recordings needs durable server-side history (a server task) before it can
 * render for arbitrary times — the client wiring here is correct regardless.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'
import {
  toCameraOccupancy,
  parseZoneNames,
  type CameraOccupancy,
  type ZoneNames,
} from './occupancy.js'
import { RECONCILE_MS } from './reconcile.js'


/** Stable empty dictionary so consumers get a referentially-stable default. */
const EMPTY_ZONE_NAMES: ZoneNames = Object.freeze({})

/**
 * The key a camera's zone NAMES live under.
 *
 * Deliberately NOT under `['v2','occupancy', …]`. Zone names are CONFIGURATION
 * — they move when an operator edits a zone — while `['v2','occupancy']` is the
 * prefix the live bridge invalidates on `zone-analytics.occupancy-changed` and
 * `pipeline-analytics.stationary-changed`, i.e. every time anything moves in
 * front of any camera in the cluster. Sitting under that prefix made a car
 * parking on one camera refetch the zone dictionary of the camera whose track
 * detail was open — a `zoneAnalytics.getCurrentSnapshot` round trip on the
 * single non-batching WebSocket, several times a second on a busy install, for
 * an answer that had not changed. The 60 s `staleTime` is the whole refresh
 * policy this needs: a rename is not an event the detail must see mid-view.
 */
export function zoneNamesQueryKey(deviceId: number): readonly unknown[] {
  return ['v2', 'zones', 'names', deviceId]
}

/**
 * A camera's `zoneId → zoneName` dictionary, from the `zoneAnalytics` snapshot
 * (the snapshot lists one entry per DEFINED zone). Used to render a track's
 * visited zones by NAME instead of id. Degrades to an empty (stable) dictionary
 * off-connection / when the cap is absent / before the pipeline emits a frame.
 *
 * The value is a plain object, never a `Map` — see {@link parseZoneNames} for
 * why that is load-bearing rather than a style choice.
 */
export function useZoneNames(deviceId: number, enabled = true): ZoneNames {
  const { controller, state } = useConnection()
  const query = useQuery<ZoneNames>({
    queryKey: zoneNamesQueryKey(deviceId),
    enabled: enabled && state === 'connected',
    staleTime: 60_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return EMPTY_ZONE_NAMES
      const client = system.trpcClient as Record<string, unknown>
      const raw = await capQuery(client, 'zoneAnalytics', 'getCurrentSnapshot', { deviceId })
      return parseZoneNames(raw)
    },
  })
  return query.data ?? EMPTY_ZONE_NAMES
}

/**
 * The current (live) occupancy snapshot for one camera. `null` until the
 * analytics pipeline has emitted a frame for the device. Reconciles on a
 * slow interval while enabled + connected; live movement arrives on
 * `zone-analytics.occupancy-changed` / `pipeline-analytics.stationary-changed`.
 *
 * `intervalMs` is the CALLER's cadence. It defaults to the five-minute
 * reconcile, which is right for anything an event already announces. The
 * parked-object overlay used to pass `STATIONARY_POLL_MS`; it now follows
 * `pipeline-analytics.stationary-changed` like occupancy. Observers of the
 * same query share one cache entry.
 */
export function useCurrentOccupancy(
  deviceId: number,
  enabled = true,
  intervalMs: number = RECONCILE_MS,
): UseQueryResult<CameraOccupancy | null> {
  const { controller, state } = useConnection()
  return useQuery<CameraOccupancy | null>({
    queryKey: ['v2', 'occupancy', 'current', deviceId],
    enabled: enabled && state === 'connected',
    // Paired with the interval, per the rule in `reconcile.ts` — whatever the
    // caller asked for. An unpaired staleTime inherits the global 5s default
    // (`src/app/query-client.ts`), so a query that intends to be five minutes
    // stale is stale after five seconds and every tab re-entry re-runs the
    // whole per-camera fan-out. This hook was the one left out of the
    // 2026-08-05 sweep — 419 dispatches in a 30s cold-start trace.
    staleTime: intervalMs,
    refetchInterval: intervalMs,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return null
      const client = system.trpcClient as Record<string, unknown>
      const raw = await capQuery(client, 'zoneAnalytics', 'getCurrentSnapshot', { deviceId })
      return toCameraOccupancy(raw)
    },
  })
}
