/**
 * use-face-review — hub-facing hooks for the admin-only face review tab
 * (Task C.4, redesigned 2026-08-26). See `face-cluster-review.ts`'s module
 * doc for why clustering moved OUT of the main grid and now backs only the
 * "Similar groups" modal.
 *
 *   • `useFaceReviewFaces` / `useFaceReviewData` — the main grid's data. The
 *     status filter, cameras, time window and sort are sent to the hub and are
 *     part of the query key; "infinite scroll" grows a `limit` and re-fetches
 *     the (still cheap — `includeCrops:false`) window. See
 *     `useFaceReviewFaces`'s doc.
 *   • `useUnassignedFacesPool` — the unassigned pool the Analyze modal scopes
 *     its clustering to, and the SAME window it asks the hub to cluster
 *     (`ANALYZE_POOL_SIZE`; the two used to disagree, see its doc).
 *   • `useSuggestFaceClusters` — unchanged from the original design, but now
 *     consumed ONLY by the Analyze modal (`enabled` should be `open`, not the
 *     whole screen's connected flag, so the 0.6 s / 29 KB clustering round
 *     trip only fires when the modal is actually open).
 */
import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery, BULK_QUERY_DEADLINE_MS } from './cap-query.js'
import { toFaceInfo, useIdentities, type TrackFace, type PersonIdentity } from './use-face-gallery.js'
import { toFaceClusters, buildFaceReviewRows, type FaceCluster, type FaceReviewRow } from './face-cluster-review.js'
import { useCameras } from './use-cameras.js'
import {
  faceReviewListInput,
  faceReviewListInputs,
  mergeFaceReviewPages,
  type FaceReviewFilterState,
  type FaceReviewListInput,
  type FaceReviewSort,
} from './face-review-filters.js'
import {
  ANALYZE_POOL_KEY,
  FACE_CLUSTERS_KEY,
  FACE_REVIEW_FACES_KEY,
} from './face-query-keys.js'

/**
 * The Analyze ("similar groups") window: how many of the newest UNASSIGNED
 * faces this modal both fetches and asks the hub to cluster.
 *
 * `listRecentFaces` applies `limit` AFTER the unassigned filter and never
 * before it (verified against the hub 2026-08-27,
 * `addon-post-analysis/.../store/face-store.ts` `listAllRecentFaces`), so this
 * is that many genuinely-unassigned faces, newest-first. Nothing anywhere
 * pre-selects "the most probable".
 *
 * ## Why it is 1 000 and not 100
 *
 * It was 100, while the hub clustered its own default of 1 000
 * (`FACE_SWEEP_PAGE`, one store page). The modal therefore paid for a sweep
 * ten times wider than the window it could show, and — worse —
 * `restrictClustersToPool` threw away every group that did not have two
 * members inside the narrow window. After one batch the faces still in the
 * newest 100 were exactly the ones whose look-alikes sat further back, so the
 * modal went quiet while the hub still had groups to give. That is the
 * operator's *"dopo il primo batch non mostra più niente"* (2026-09-13), and
 * it is not a cursor: there is no cursor here at all, just two windows that
 * disagreed. Pinned by `data/__tests__/face-review-analyze-window.spec.ts`.
 *
 * The two now travel together — {@link ANALYZE_CLUSTER_QUERY} sends this
 * number as `maxFacesScanned`, so the pool IS the horizon rather than a slice
 * of somebody else's default. The cost is the metadata-only page this hook
 * already fetches (`includeCrops:false`: 281 KB / 78 ms for 518 faces,
 * measured live — see `use-face-gallery.ts`), and only while the modal is open.
 */
export const ANALYZE_POOL_SIZE = 1000

/**
 * Clustering query knobs. `threshold: 0.5` / `minClusterSize: 2` match the
 * server's own defaults (and the admin-ui's `SimilarGroupsModal`, the one
 * other place this cap is consumed).
 *
 * `maxFacesScanned` is the ONE knob that narrows the sweep — `maxClusters` (and
 * its deprecated alias `limit`) cut the RESULT, not the scan, which is why
 * neither appears here. A hub too old to know the key strips it and falls back
 * to its own 1 000, which is the same number: the alignment holds either way.
 *
 * EXPORTED so the window rule can be asserted against
 * {@link ANALYZE_POOL_SIZE} instead of trusted.
 */
export const ANALYZE_CLUSTER_QUERY = {
  threshold: 0.5,
  minClusterSize: 2,
  maxFacesScanned: ANALYZE_POOL_SIZE,
} as const

/** Main-grid page size: how much `limit` grows on each `loadMore()`. */
const FACES_PAGE_SIZE = 200
/** Same generous ceiling the original unassigned-only query used unbounded
 *  at (974 unassigned faces measured live, 2026-08-26) — a sane stopping
 *  point for "infinite" scroll rather than truly unbounded growth now that
 *  `filter:'all'` also pulls in every already-assigned face ever reviewed. */
const FACES_MAX_LIMIT = 2000

/*
 * The three query keys this module reads are declared in
 * `face-query-keys.ts`, next to the invalidation that has to cover them: an
 * assignment changes all three answers, and a key only this file knew about is
 * exactly how the Analyze modal ended up re-serving a group the hub had
 * already taken.
 */

type FetchFacesInput =
  | FaceReviewListInput
  | { readonly filter: 'unassigned'; readonly limit: number; readonly includeCrops: boolean }

async function fetchFaces(
  trpcClient: Record<string, unknown>,
  input: FetchFacesInput,
): Promise<TrackFace[]> {
  const raw = await capQuery(trpcClient, 'faceGallery', 'listRecentFaces', input, {
    deadlineMs: BULK_QUERY_DEADLINE_MS,
  })
  if (!Array.isArray(raw)) return []
  const out: TrackFace[] = []
  for (const row of raw) {
    const face = toFaceInfo(row)
    if (face !== null) out.push(face)
  }
  return out
}

/**
 * The faces the operator is reviewing, as the HUB ranks and narrows them.
 *
 * Status, cameras, time window and sort travel in the request
 * ({@link faceReviewListInput}) and are part of the query key. They used to be
 * applied client-side over the newest 200 faces of `filter:'all'`, which spent
 * the window on assigned faces and ranked "by certainty" only inside it —
 * measured live, 49 of the 50 best suggestions sat beyond that window.
 *
 * "Infinite scroll" without a server cursor: `loadMore` grows `limit` and the
 * WHOLE window is re-fetched (metadata only, `includeCrops:false`). The order
 * is stable between calls, so a larger `limit` returns a superset.
 * `placeholderData` keeps the previous rows on screen while it loads, so
 * growing the window never blanks the list. A change of filter or sort resets
 * `limit` to one page.
 */
/** The merged faces of every call, and how many rows each call returned. */
interface FaceReviewPages {
  readonly faces: readonly TrackFace[]
  readonly pageSizes: readonly number[]
}

export function useFaceReviewFaces(
  enabled: boolean,
  filters: FaceReviewFilterState,
  sort: FaceReviewSort,
) {
  const { controller, state } = useConnection()
  // The window grows per VIEW: a new filter or sort starts again at one page
  // (derived from the view's signature, not reset by an effect).
  const view = JSON.stringify(faceReviewListInput(filters, sort, 0))
  const [grown, setGrown] = useState({ view, limit: FACES_PAGE_SIZE })
  const limit = grown.view === view ? grown.limit : FACES_PAGE_SIZE
  const inputs = faceReviewListInputs(filters, sort, limit)
  // A page per input; `pageSizes` tells `hasMore` whether ANY of them filled.
  const query = useQuery<FaceReviewPages>({
    queryKey: ['v2', FACE_REVIEW_FACES_KEY, inputs],
    enabled: enabled && state === 'connected' && inputs.length > 0,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system || inputs.length === 0) return { faces: [], pageSizes: [] }
      const client = system.trpcClient as Record<string, unknown>
      const pages = await Promise.all(inputs.map((input) => fetchFaces(client, input)))
      return { faces: mergeFaceReviewPages(pages), pageSizes: pages.map((page) => page.length) }
    },
  })
  const loadMore = useCallback(() => {
    setGrown({ view, limit: Math.min(FACES_MAX_LIMIT, limit + FACES_PAGE_SIZE) })
  }, [view, limit])
  // Heuristic, not a real cursor: a full page came back AND there is still
  // room to grow. A short page means the hub has nothing more that matches.
  const hasMore = limit < FACES_MAX_LIMIT && (query.data?.pageSizes ?? []).some((size) => size >= limit)
  return {
    ...query,
    data: query.data?.faces,
    loadMore,
    hasMore,
    isFetchingMore: query.isFetching && (query.data?.faces.length ?? 0) > 0,
  }
}

/** The newest {@link ANALYZE_POOL_SIZE} unassigned faces, metadata only — the
 *  Analyze modal's pool, and the exact horizon it asks the hub to cluster.
 *  A SEPARATE, fixed-size query from the main grid's (which is `filter:'all'`
 *  and grows) so the modal's scope does not move with how far the operator has
 *  scrolled the main list. */
export function useUnassignedFacesPool(enabled: boolean) {
  const { controller, state } = useConnection()
  return useQuery<TrackFace[]>({
    queryKey: ['v2', ANALYZE_POOL_KEY],
    enabled: enabled && state === 'connected',
    staleTime: 30_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return []
      return fetchFaces(system.trpcClient as Record<string, unknown>, {
        filter: 'unassigned',
        limit: ANALYZE_POOL_SIZE,
        includeCrops: false,
      })
    },
  })
}

/**
 * The look-alike clusters over currently-unassigned faces — consumed ONLY by
 * the Analyze modal; pass `open` (not the screen's connected flag) as
 * `enabled` so this never fires while the modal is closed.
 *
 * The scope asymmetry this used to carry is GONE. The cap grew
 * `maxFacesScanned` — the knob that bounds the POOL rather than the result —
 * and {@link ANALYZE_CLUSTER_QUERY} sends {@link ANALYZE_POOL_SIZE} through
 * it, so the faces clustered here are the same faces
 * {@link useUnassignedFacesPool} fetched. `restrictClustersToPool` stays as
 * the guard it always was (a member the operator cannot see must not be
 * silently adoptable) and now has nothing left to cut.
 */
export function useSuggestFaceClusters(enabled: boolean) {
  const { controller, state } = useConnection()
  return useQuery<FaceCluster[]>({
    queryKey: ['v2', FACE_CLUSTERS_KEY, ANALYZE_CLUSTER_QUERY],
    enabled: enabled && state === 'connected',
    staleTime: 30_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return []
      const raw = await capQuery(
        system.trpcClient as Record<string, unknown>,
        'faceGallery',
        'suggestFaceClusters',
        ANALYZE_CLUSTER_QUERY,
        { deadlineMs: BULK_QUERY_DEADLINE_MS },
      )
      return toFaceClusters(raw)
    },
  })
}

export interface FaceReviewData {
  /** UNSORTED and UNFILTERED — the screen owns both now (the operator picks
   *  them), so this hook must not bake in an order that a sort control would
   *  then silently fight. */
  readonly rows: readonly FaceReviewRow[]
  readonly identities: readonly PersonIdentity[]
  readonly isLoading: boolean
  readonly isError: boolean
  readonly refetch: () => Promise<unknown>
  readonly loadMore: () => void
  readonly hasMore: boolean
  readonly isFetchingMore: boolean
}

/**
 * Composes faces + identities + CAMERA NAMES into the main grid's rows (one
 * per face). Order and filtering are the screen's, through
 * `face-review-filters.ts` — this hook hands over the whole loaded window.
 *
 * The camera list comes from the app-wide `useCameras` query, which is
 * already cached and reconciled for every other screen: the review tab reads
 * the device fact where it is owned instead of keeping a second copy of it.
 */
export function useFaceReviewData(
  enabled: boolean,
  filters: FaceReviewFilterState,
  sort: FaceReviewSort,
): FaceReviewData {
  const faces = useFaceReviewFaces(enabled, filters, sort)
  const { data: cameras } = useCameras()
  const {
    data: identities = [],
    isLoading: identitiesLoading,
    isError: identitiesError,
    refetch: refetchIdentities,
  } = useIdentities(enabled)

  const cameraNameById = useMemo(
    () => new Map((cameras ?? []).map((c) => [c.id, c.name])),
    [cameras],
  )

  const rows = useMemo(
    () => buildFaceReviewRows(faces.data ?? [], identities, cameraNameById),
    [faces.data, identities, cameraNameById],
  )

  const refetch = useCallback(async () => {
    await Promise.all([faces.refetch(), refetchIdentities()])
  }, [faces, refetchIdentities])

  return {
    rows,
    identities,
    isLoading: faces.isLoading || identitiesLoading,
    isError: faces.isError || identitiesError,
    refetch,
    loadMore: faces.loadMore,
    hasMore: faces.hasMore,
    isFetchingMore: faces.isFetchingMore,
  }
}
