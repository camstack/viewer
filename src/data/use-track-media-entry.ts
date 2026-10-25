/**
 * useTrackMediaEntry — the bytes of ONE selected media entry, never the block.
 *
 * The detail's strip is built from `listTrackMedia` (a manifest: 7 rows in
 * 0.25 s, no pixels). This hook is the second half of that split: when the
 * operator selects an entry, it asks `pipelineAnalytics.getTrackMedia` with
 * `kinds` restricted to that ONE kind — see {@link restrictKindsToEntry},
 * whose one-tuple return type is what stops the argument from quietly growing
 * back into the whole gallery.
 *
 * ## What the block fetch cost
 *
 * Unfiltered, `getTrackMedia` returns every stored variant as base64. Measured
 * across 12 tracks on the live hub: mean 1223 ms / 1536 KB, worst 6936 ms /
 * 4308 KB — and on a hub under disk contention it simply runs into the 60 s
 * transport ceiling. The modal then showed nothing at all, which an operator
 * (and an audit) reads as "this track has no media" even though the index
 * listed every row. One kind at a time keeps a slow entry slow instead of
 * making the whole detail empty, and keeps the other entries selectable.
 *
 * ## `rethrow` is not optional here
 *
 * `capQuery`'s default collapses "the read failed" into `null`, which React
 * Query records as a SUCCESS carrying no bytes — indistinguishable from an
 * entry that does not exist. That is the precise lie this whole feature is
 * built to stop, so the failure propagates and becomes
 * {@link TrackMediaEntryState} `error`, with a retry the operator can press.
 *
 * The deadline is the BULK one: this call is sized by bytes, not by whether
 * some node is answering, and the badge-sized 6 s ceiling would abandon a
 * perfectly healthy 400 KB key frame.
 */
import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery, BULK_QUERY_DEADLINE_MS } from './cap-query.js'
import { parseMediaFiles, type MediaFileLite } from './track-events.js'
import {
  resolveTrackMediaEntryState,
  restrictKindsToEntry,
  trackMediaEntryNeedsFetch,
  isTrackMediaByteKind,
  type TrackMediaEntryState,
} from './track-media-entry.js'

export interface TrackMediaEntryResult {
  /** Loading / error / absent / ready — see {@link TrackMediaEntryState}. */
  readonly state: TrackMediaEntryState
  /** Re-run the byte read for this entry (the view's "Retry"). */
  readonly retry: () => void
}

/** The input `getTrackMedia` is called with — named, so no inline shape. */
interface TrackMediaBytesInput {
  readonly deviceId: number
  readonly trackId: string
  readonly kinds: readonly string[]
}

/**
 * Load the bytes of `selected` and nothing else.
 *
 * @param selected - the entry the operator picked, or `null` when the manifest
 *                   lists none — which resolves to `absent`, the honest answer.
 */
export function useTrackMediaEntry(
  deviceId: number,
  trackId: string | null,
  selected: MediaFileLite | null,
): TrackMediaEntryResult {
  const { controller, state: connectionState } = useConnection()

  const needsFetch = trackMediaEntryNeedsFetch(selected)
  const kind = selected?.kind ?? null

  const query = useQuery<MediaFileLite[]>({
    // Keyed by the ENTRY, not by the track: selecting another tile is another
    // query, so a failed entry keeps its own error and its own retry while the
    // rest of the strip stays navigable.
    queryKey: ['v2', 'analytics', 'track-media-entry', deviceId, trackId ?? 'none', kind ?? 'none'],
    enabled: connectionState === 'connected' && trackId !== null && needsFetch,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<MediaFileLite[]> => {
      const system = controller.getSystem()
      if (system === null || trackId === null || kind === null || !isTrackMediaByteKind(kind)) {
        return []
      }
      const input: TrackMediaBytesInput = {
        deviceId,
        trackId,
        kinds: restrictKindsToEntry(kind),
      }
      const raw = await capQuery(
        system.trpcClient as Record<string, unknown>,
        'pipelineAnalytics',
        'getTrackMedia',
        input,
        { rethrow: true, deadlineMs: BULK_QUERY_DEADLINE_MS },
      )
      return parseMediaFiles(raw)
    },
  })

  const retry = useCallback((): void => {
    void query.refetch()
  }, [query])

  const state = useMemo<TrackMediaEntryState>(
    () =>
      resolveTrackMediaEntryState({
        selected,
        fetchFailed: query.isError,
        rows: query.data ?? null,
      }),
    [selected, query.isError, query.data],
  )

  return { state, retry }
}
