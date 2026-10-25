/**
 * useTrackBestDetection — resolve the best detection (bbox + inference-frame
 * dimensions) for a track, so the detail can draw the bounding box CLIENT-SIDE
 * when the server did not persist a `fullFrameBoxed` image.
 *
 * Only fetched when `enabled` (the boxed image is missing but a clean full frame
 * exists): a single `getObjectEvents` full-projection query over the track's
 * [firstSeen, lastSeen] window, filtered to the trackId, picking the row matching
 * `bestEventId` (else the highest-confidence row carrying a bbox). Defensive:
 * returns null on error / no bbox.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'
import { toDetailDetection, type DetailDetection } from '../components/camera/theater/detail/cluster-detail.js'

export interface TrackBestDetectionResult {
  readonly detection: DetailDetection | null
  readonly loading: boolean
}

/** Small slack around the track window so a boundary detection is included. */
const WINDOW_SLACK_MS = 2000

export function useTrackBestDetection(
  deviceId: number,
  trackId: string | null,
  bestEventId: string | null,
  firstSeen: number,
  lastSeen: number,
  enabled: boolean,
): TrackBestDetectionResult {
  const { controller, state } = useConnection()

  const query = useQuery<DetailDetection | null>({
    queryKey: ['v2', 'analytics', 'track-best-detection', deviceId, trackId ?? 'none'],
    enabled: enabled && state === 'connected' && trackId !== null,
    staleTime: 60_000,
    queryFn: async (): Promise<DetailDetection | null> => {
      const system = controller.getSystem()
      if (!system || trackId === null) return null
      const raw = await capQuery(system.trpcClient as Record<string, unknown>, 'pipelineAnalytics', 'getObjectEvents', {
        deviceId,
        since: firstSeen - WINDOW_SLACK_MS,
        until: lastSeen + WINDOW_SLACK_MS,
        limit: 500,
        projection: 'full',
      })
      if (!Array.isArray(raw)) return null

      let best: DetailDetection | null = null
      for (const row of raw) {
        const d = toDetailDetection(row)
        if (d === null || d.trackId !== trackId || d.bbox === undefined) continue
        if (bestEventId !== null && d.id === bestEventId) return d
        if (best === null || (d.confidence ?? 0) > (best.confidence ?? 0)) best = d
      }
      return best
    },
  })

  return useMemo(
    () => ({ detection: query.data ?? null, loading: query.isLoading }),
    [query.data, query.isLoading],
  )
}
