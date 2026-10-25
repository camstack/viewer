/**
 * useTrackGeometry — fetch one track's POSITION geometry (its `positions[]`
 * pixel samples + server-normalised `envelope`) via
 * `pipelineAnalytics.getTrack({ deviceId, trackId })`, for the detail's
 * trajectory ("path") image.
 *
 * The timeline's listTracks rows already carry `positionBoxes` client-side, but
 * NOT the per-position timestamps the dwell rendering needs, and the timeline's
 * `ObjectEvent` shape must not grow another field for one consumer — so the
 * detail fetches the full track row itself. Defensive: disabled until connected
 * and a track is selected; null on error / older hubs / a positionless
 * (synthetic) track, so the detail simply shows no path tile.
 */

import { useQuery } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'
import {
  parseTrackPositions,
  type TrackPositionSample,
} from '../components/camera/theater/detail/track-trajectory.js'
import {
  parseNormalizedEnvelope,
  type ZoneRect,
} from '../components/camera/theater/zone-filter.js'

/** The two halves the trajectory model needs, read off the SAME raw row
 *  (mirrors `TrackTimelineGeometry` — see use-device-tracks.ts for why the
 *  envelope must travel with the boxes). */
export interface TrackGeometry {
  readonly positions: readonly TrackPositionSample[]
  readonly envelope: ZoneRect | null
}

export interface TrackGeometryResult {
  readonly geometry: TrackGeometry | null
  readonly loading: boolean
}

export function useTrackGeometry(deviceId: number, trackId: string | null): TrackGeometryResult {
  const { controller, state } = useConnection()

  const query = useQuery<TrackGeometry | null>({
    queryKey: ['v2', 'analytics', 'track-geometry', deviceId, trackId ?? 'none'],
    enabled: state === 'connected' && trackId !== null,
    staleTime: 60_000,
    queryFn: async (): Promise<TrackGeometry | null> => {
      if (trackId === null) return null
      const system = controller.getSystem()
      if (!system) return null
      const raw = await capQuery(
        system.trpcClient as Record<string, unknown>,
        'pipelineAnalytics',
        'getTrack',
        { deviceId, trackId },
      )
      const positions = parseTrackPositions(raw)
      if (positions.length === 0) return null
      return { positions, envelope: parseNormalizedEnvelope(raw) }
    },
  })

  return { geometry: query.data ?? null, loading: query.isLoading }
}
