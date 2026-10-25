/**
 * useTrackMedia — list every stand-alone media file the pipeline captured for a
 * track via `pipelineAnalytics.listTrackMedia({ trackId })`. Manifest only —
 * keys, kinds, timestamps; JPEG travels HTTP. Defensive: disabled until
 * connected and a track is selected; returns [] on error or a missing method
 * (older hubs), so the gallery still renders its scene frames.
 */

import { useQuery } from '@tanstack/react-query'
import { useConnection } from '../../../../connection/ConnectionProvider.js'
import { capQuery } from '../../../../data/cap-query.js'
import { parseTrackMedia, type TrackMediaFile } from './track-media.js'

export interface TrackMediaResult {
  readonly media: TrackMediaFile[]
  readonly loading: boolean
}

export function useTrackMedia(deviceId: number, trackId: string | null): TrackMediaResult {
  const { controller, state } = useConnection()

  const query = useQuery<TrackMediaFile[]>({
    queryKey: ['v2', 'analytics', 'track-media', deviceId, trackId ?? 'none'],
    enabled: state === 'connected' && trackId !== null,
    staleTime: 60_000,
    queryFn: async (): Promise<TrackMediaFile[]> => {
      if (trackId === null) return []
      const system = controller.getSystem()
      if (!system) return []
      const raw = await capQuery(
        system.trpcClient as Record<string, unknown>,
        'pipelineAnalytics',
        'listTrackMedia',
        { trackId, deviceId },
      )
      return parseTrackMedia(raw)
    },
  })

  return { media: query.data ?? [], loading: query.isLoading }
}
