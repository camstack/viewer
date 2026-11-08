/**
 * Reads behind the device detail's History tab: the series a device keeps, one
 * `query` per series, and (for a washer, dryer, dishwasher) its runs.
 *
 * The viewer principal is not an admin, so `queryMany` is refused for it and
 * every series is read on its own. A read that failed is `null` (unanswered),
 * never an empty series (D315).
 */
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'
import { isCallableNode } from './device-detail-status.js'
import {
  toRunBands,
  toSeriesList,
  toSeriesSamples,
  type HistoryWindow,
  type RunBand,
  type SeriesInfo,
  type SeriesSamples,
} from './device-history-model.js'

/** Fine enough for a phone's width; the hub downsamples to it. */
const MAX_POINTS = 240
const SERIES_STALE_MS = 60_000
const RUNS_LIMIT = 100

/** Device types the hub records runs for (`device-runs`). */
const RUN_DEVICE_TYPES: ReadonlySet<string> = new Set(['washer', 'dryer', 'dishwasher'])

export function hasDeviceRuns(deviceType: string): boolean {
  return RUN_DEVICE_TYPES.has(deviceType)
}

function useTrpcClient(): { readonly client: () => Record<string, unknown> | null; readonly ready: boolean } {
  const { controller, state } = useConnection()
  return {
    ready: state === 'connected',
    client: () => {
      const system = controller.getSystem()
      const c: unknown = system?.trpcClient
      return isCallableNode(c) ? c : null
    },
  }
}

export function useDeviceSeries(deviceId: number, enabled: boolean): UseQueryResult<readonly SeriesInfo[] | null> {
  const { client, ready } = useTrpcClient()
  return useQuery<readonly SeriesInfo[] | null>({
    queryKey: ['v2', 'device-history', 'series', deviceId],
    enabled: enabled && ready,
    staleTime: SERIES_STALE_MS,
    queryFn: async () => {
      const c = client()
      if (c === null) return null
      return toSeriesList(await capQuery(c, 'deviceHistory', 'listSeries', { deviceId }))
    },
  })
}

export interface SeriesReading {
  readonly info: SeriesInfo
  /** `null` while unanswered or when the read failed. */
  readonly data: SeriesSamples | null
  readonly loading: boolean
}

/** One `query` per series over the window; the order of `series` is kept. */
export function useSeriesReadings(
  deviceId: number,
  series: readonly SeriesInfo[],
  window: HistoryWindow,
  windowId: string,
): readonly SeriesReading[] {
  const { client, ready } = useTrpcClient()
  const results = useQueries({
    queries: series.map((info) => ({
      queryKey: ['v2', 'device-history', 'query', deviceId, info.key, info.scope, windowId],
      enabled: ready,
      staleTime: SERIES_STALE_MS,
      queryFn: async (): Promise<SeriesSamples | null> => {
        const c = client()
        if (c === null) return null
        return toSeriesSamples(
          await capQuery(c, 'deviceHistory', 'query', {
            deviceId,
            key: info.key,
            scope: info.scope,
            from: window.from,
            to: window.to,
            resolution: 'auto',
            maxPoints: MAX_POINTS,
          }),
          info.kind,
        )
      },
    })),
  })
  return series.map((info, i) => ({ info, data: results[i]?.data ?? null, loading: results[i]?.isLoading === true }))
}

export function useDeviceRunBands(
  deviceId: number,
  enabled: boolean,
  window: HistoryWindow,
  windowId: string,
): UseQueryResult<readonly RunBand[] | null> {
  const { client, ready } = useTrpcClient()
  return useQuery<readonly RunBand[] | null>({
    queryKey: ['v2', 'device-history', 'runs', deviceId, windowId],
    enabled: enabled && ready,
    staleTime: SERIES_STALE_MS,
    queryFn: async () => {
      const c = client()
      if (c === null) return null
      const raw = await capQuery(c, 'deviceRuns', 'listRuns', {
        deviceId,
        atFrom: window.from,
        atTo: window.to,
        limit: RUNS_LIMIT,
      })
      return raw === null ? null : toRunBands(raw, window)
    },
  })
}
