/**
 * useTrackDetailMedia — what media a track HAS, for the detail's strip.
 *
 * Fetches `listTrackMedia({ trackId })` as a MANIFEST: keys, kinds and sizes,
 * no bytes. Each tile then renders from the media data plane BY KEY, so the
 * platform fetches only what is on screen, at `?variant=thumb`, and caches it
 * on disk. `getEventMedia` used to ride along and ship JPEG through hub-main
 * for a strip that threw the bytes away — the leftover this deletes.
 *
 * ## Why the method name is the whole point
 *
 * `getTrackMedia` and `listTrackMedia` differ by one word and by three orders
 * of magnitude. Measured on the live hub, 12 tracks:
 *
 *     getTrackMedia    mean 1223 ms   mean 1536 KB   (worst 6936 ms / 4308 KB)
 *     listTrackMedia   mean   25 ms   mean  0.7 KB
 *
 * If you change this call, change it to something that returns NO bytes. The
 * strip is built from keys; bytes here buy nothing and cost the whole open.
 *
 * ## A failed read is an ERROR, never a silent empty
 *
 * Two tracks were reported as "no media in the detail, only the best shot"
 * while the hub verifiably held every row and blob. The open had raced a
 * saturated analytics runner: one call failed, `capQuery` swallowed it to
 * null, and React Query recorded a SUCCESS with an empty gallery — cached, no
 * retry, no message, the Media section silently absent. `rethrow` so a failure
 * propagates — the view says it failed and offers a retry. Genuinely empty
 * (the call answered, zero rows) stays a real, non-error answer.
 *
 * Defensive: disabled until connected + a track is selected.
 */
import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery } from './cap-query.js'
import {
  parseMediaManifest,
  buildTrackGallery,
  type MediaFileLite,
} from './track-events.js'

/** One stored media file reference (for the metadata view's copyable ids). */
export interface MediaIdRef {
  readonly mediaId: number
  readonly kind: string
}

export interface TrackDetailMediaResult {
  readonly loading: boolean
  /** True when the fetch FAILED and there is nothing to show — distinct from a
   *  track that genuinely has no media (`failed: false`, empty `gallery`). */
  readonly failed: boolean
  /** Refetch after a failure (the view's "Retry"). */
  readonly retry: () => void
  /** Every stored media row id (event-owned + track-owned), deduplicated. */
  readonly mediaIds: readonly MediaIdRef[]
  /** EVERY media file that exists for the track (event-owned + track-owned),
   *  deduped + ordered — the source for the detail's "all media" strip. */
  readonly gallery: readonly MediaFileLite[]
}

interface MediaBundle {
  readonly event: MediaFileLite[]
  readonly track: MediaFileLite[]
}

export function useTrackDetailMedia(
  deviceId: number,
  bestEventId: string | null,
  trackId: string | null,
): TrackDetailMediaResult {
  const { controller, state } = useConnection()

  const query = useQuery<MediaBundle>({
    queryKey: ['v2', 'analytics', 'track-detail-media', deviceId, bestEventId ?? 'none', trackId ?? 'none'],
    enabled: state === 'connected' && trackId !== null,
    staleTime: 60_000,
    queryFn: async (): Promise<MediaBundle> => {
      const system = controller.getSystem()
      if (!system || trackId === null) return { event: [], track: [] }
      const client = system.trpcClient as Record<string, unknown>
      // `rethrow`: a swallowed failure here is recorded by React Query as a
      // SUCCESS with an empty gallery — the exact lie this hook shipped once.
      const raw = await capQuery(
        client,
        'pipelineAnalytics',
        'listTrackMedia',
        { trackId, deviceId },
        { rethrow: true },
      )
      return { event: [], track: parseMediaManifest(raw) }
    },
  })

  const retry = useCallback((): void => {
    void query.refetch()
  }, [query])

  // Copyable media-id references for the metadata view — derived from the SAME
  // fetch (no extra call), deduplicated by id. A row with no id (should not
  // happen off a real manifest fetch, but parseMediaManifest is defensive) is
  // simply not copyable — never surfaced as `0`.
  const mediaIds = useMemo<MediaIdRef[]>(() => {
    if (!query.data) return []
    const seen = new Set<number>()
    const out: MediaIdRef[] = []
    for (const f of [...query.data.event, ...query.data.track]) {
      if (f.mediaId === undefined) continue
      if (seen.has(f.mediaId)) continue
      seen.add(f.mediaId)
      out.push({ mediaId: f.mediaId, kind: f.kind })
    }
    return out
  }, [query.data])

  // The full ordered media list (all existing kinds) for the "all media" strip —
  // derived from the SAME fetch, no extra call.
  const gallery = useMemo<MediaFileLite[]>(
    () => (query.data ? buildTrackGallery(query.data.event, query.data.track) : []),
    [query.data],
  )

  return { loading: query.isLoading, failed: query.isError, retry, mediaIds, gallery }
}
