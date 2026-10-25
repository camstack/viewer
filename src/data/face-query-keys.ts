/**
 * face-query-keys — the ONE list of React Query keys that hold face-assignment
 * state, and the one invalidation that covers all of them.
 *
 * ## What went wrong without it (operator report, 2026-09-01)
 *
 * Assigning through the "Similar groups" modal (then labelled "Analyze the
 * last 100 unassigned") wrote through
 * to the hub — verified against the live hub, which reported
 * `{assigned:1, failed:[]}` and dropped the face from both
 * `listRecentFaces{filter:'unassigned'}` and `suggestFaceClusters` on the very
 * next call — and the SAME groups with the SAME faces came straight back.
 *
 * They came back because the write invalidated two keys (`track-face`,
 * `face-identities`) and the modal reads two OTHERS
 * (`face-review-analyze-pool`, `face-review-clusters`), both with a 30 s
 * `staleTime`. Nothing connected them: the screen's own `refetch()` reaches
 * only the main grid, so no button the operator could press — reopen,
 * re-analyse, recompute, pull-to-refresh — could make either query ask the hub
 * again. The modal re-rendered its cache and looked like a hub that had
 * ignored the write.
 *
 * ## The rule
 *
 * A key that answers "is this face assigned, and to whom" belongs in
 * {@link FACE_ASSIGNMENT_QUERY_KEYS}, and every mutation that changes that
 * answer calls {@link invalidateFaceAssignmentQueries}. A new face query that
 * skips this list is a new copy of the same bug — which is why the keys live
 * here, in a leaf module both `use-face-gallery.ts` and `use-face-review.ts`
 * import, and not privately inside either of them.
 */
import type { QueryClient } from '@tanstack/react-query'
import { unrefTimer } from '../lib/unref-timer.js'

/** Every key in this app is namespaced under `v2`. */
export const FACE_QUERY_NAMESPACE = 'v2'

/** Per-track face lookup (`useTrackFace`). */
export const TRACK_FACE_KEY = 'track-face'
/** The saved people (`useIdentities`). */
export const IDENTITIES_KEY = 'face-identities'
/** The review tab's main grid — `filter:'all'`, growing window. */
export const FACE_REVIEW_FACES_KEY = 'face-review-faces'
/** The Analyze modal's unassigned pool. */
export const ANALYZE_POOL_KEY = 'face-review-analyze-pool'
/** The Analyze modal's look-alike clusters. */
export const FACE_CLUSTERS_KEY = 'face-review-clusters'

/**
 * Every query whose answer changes when a face is assigned or unassigned.
 *
 * The clusters belong here as much as the faces do: `suggestFaceClusters`
 * groups UNASSIGNED faces only, so an assignment shrinks or removes a group.
 * Leaving them out is what made an assigned group reappear intact.
 */
/**
 * The half an assignment WAITS for: what the open sheet is showing.
 *
 * `FaceAssignSheet` says it in its own header — "every mutation here is a
 * multi-second round trip (the write, two query invalidations AND an embed
 * reload ride `mutateAsync` before it resolves)" — and the mitigation shipped
 * for that was a spinner, which explains the wait without removing it. On
 * 2026-09-10 the operator reported assigning faces as blocked (D434).
 *
 * Only the per-track lookup has to land before the write resolves: it is the
 * one the operator is looking at.
 */
export const FACE_ASSIGNMENT_IMMEDIATE_KEYS: readonly string[] = [TRACK_FACE_KEY]

/**
 * The half that lands AFTER the burst: gallery-wide lists.
 *
 * Deferred, never dropped — every one still refetches, once the operator stops
 * assigning. Refetching them per assignment also re-sorted the very grid under
 * his finger, which is the other half of "blocked".
 */
export const FACE_ASSIGNMENT_DEFERRED_KEYS: readonly string[] = [
  IDENTITIES_KEY,
  FACE_REVIEW_FACES_KEY,
  ANALYZE_POOL_KEY,
  FACE_CLUSTERS_KEY,
]

export const FACE_ASSIGNMENT_QUERY_KEYS: readonly string[] = [
  TRACK_FACE_KEY,
  IDENTITIES_KEY,
  FACE_REVIEW_FACES_KEY,
  ANALYZE_POOL_KEY,
  FACE_CLUSTERS_KEY,
]

/**
 * Re-ask the hub for everything an assignment write just changed.
 *
 * Awaited as a whole so a caller that reports a result does it AFTER the
 * screens behind it have been told to catch up.
 */
export async function invalidateFaceAssignmentQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    FACE_ASSIGNMENT_IMMEDIATE_KEYS.map((key) =>
      queryClient.invalidateQueries({ queryKey: [FACE_QUERY_NAMESPACE, key] }),
    ),
  )
  armDeferredInvalidation(queryClient)
}

/**
 * Every key, awaited — for a mutation that writes MANY faces in ONE call.
 *
 * A batch is not a burst: it is a single round trip, so nothing is gained by
 * deferring, and the surface the operator is looking at IS the list. The
 * Analyze modal's group must be gone the moment its write lands — that exact
 * regression is pinned by `face-review-analyze-modal.spec.ts` ("does not show
 * the same group again once the hub has taken those faces"), and deferring the
 * clusters brought it back for four seconds (D434).
 */
export async function invalidateFaceAssignmentQueriesNow(
  queryClient: QueryClient,
): Promise<void> {
  if (deferredTimer !== null) {
    cancelDeferred(deferredTimer)
    deferredTimer = null
  }
  await Promise.all(
    FACE_ASSIGNMENT_QUERY_KEYS.map((key) =>
      queryClient.invalidateQueries({ queryKey: [FACE_QUERY_NAMESPACE, key] }),
    ),
  )
}

/** How long after the LAST assignment the gallery-wide lists refetch. */
const DEFERRED_INVALIDATION_MS = 4_000
let deferredTimer: ReturnType<typeof setTimeout> | null = null

/** Injectable for the test; production uses the platform timer. */
let scheduleDeferred: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout
let cancelDeferred: (t: ReturnType<typeof setTimeout>) => void = clearTimeout

/** Test seam: swap the timer, and put it back. */
export function __setFaceInvalidationTimerForTest(
  schedule: typeof scheduleDeferred,
  cancel: typeof cancelDeferred,
): void {
  scheduleDeferred = schedule
  cancelDeferred = cancel
}

/**
 * (Re)start the deferred refetch. Every assignment pushes it out, so a burst
 * costs ONE pass over the lists instead of one per face — and the pass lands
 * only once the operator has stopped.
 */
function armDeferredInvalidation(queryClient: QueryClient): void {
  if (deferredTimer !== null) cancelDeferred(deferredTimer)
  deferredTimer = scheduleDeferred(() => {
    deferredTimer = null
    for (const key of FACE_ASSIGNMENT_DEFERRED_KEYS) {
      void queryClient.invalidateQueries({ queryKey: [FACE_QUERY_NAMESPACE, key] })
    }
  }, DEFERRED_INVALIDATION_MS)
  unrefTimer(deferredTimer)
}
