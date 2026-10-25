/**
 * useTrackById — resolve a SINGLE track by (deviceId, trackId) via the
 * `pipelineAnalytics.getTrack` cap, normalised to a {@link TrackSummary}.
 *
 * Powers the private deep-link open: the events screen reads `?trackId&deviceId`
 * off the URL and reopens the detail modal even for a track that isn't in the
 * currently-loaded feed page (a different day). Defensive: disabled until
 * connected + both ids present; returns null on error / older hubs.
 *
 * It is also THE source of a track's operator FLAGS on every embed surface. A
 * card click opens `trackSummaryFromEventsClick`, which carries no flags by
 * design (it must open before any round trip), so the toggles render off until
 * this row upgrades them. That makes the 60 s `staleTime` below load-bearing in
 * a way it does not look: a write that does not publish itself here leaves a
 * re-open reading the pre-write row for a full minute, and the operator sees
 * every flag they just set come back off. `useSetTrackFlags` therefore writes
 * the hub's answer into {@link trackByIdQueryKey} and invalidates it.
 */
import { useQuery } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'
import { toTrackSummary, type TrackSummary } from './track-events.js'

/**
 * The cache key one (device, track) row lives under.
 *
 * Exported because a WRITE has to be able to find the read it invalidates: the
 * flag toggles (`useSetTrackFlags`) publish the hub's answer here, and a key
 * spelled out twice is a key that drifts once. See {@link useTrackById} for why
 * that publication is load-bearing rather than an optimisation.
 */
export function trackByIdQueryKey(
  deviceId: number | null,
  trackId: string | null,
): readonly unknown[] {
  return ['v2', 'analytics', 'track-by-id', deviceId ?? 'none', trackId ?? 'none']
}

export function useTrackById(
  deviceId: number | null,
  trackId: string | null,
  cameraName: string,
): { track: TrackSummary | null; loading: boolean } {
  const { controller, state } = useConnection()

  const query = useQuery<TrackSummary | null>({
    queryKey: trackByIdQueryKey(deviceId, trackId),
    enabled: state === 'connected' && deviceId !== null && trackId !== null,
    staleTime: 60_000,
    queryFn: async (): Promise<TrackSummary | null> => {
      const system = controller.getSystem()
      if (!system || deviceId === null || trackId === null) return null
      const client = system.trpcClient as Record<string, unknown>
      const raw = await capQuery(client, 'pipelineAnalytics', 'getTrack', { deviceId, trackId })
      return toTrackSummary(raw, cameraName)
    },
  })

  return { track: query.data ?? null, loading: query.isLoading }
}
