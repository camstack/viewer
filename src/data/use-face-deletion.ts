/**
 * use-face-deletion — the write half of "delete the parked faces".
 *
 * The rule (which faces may be deleted at all) is `face-review-deletion.ts`;
 * this is the call. It lives in its own module rather than in
 * `use-face-gallery.ts` because it needs `runWithConcurrency` from
 * `face-cluster-review.ts`, which imports `use-face-gallery.ts` — putting it
 * there would close an import cycle.
 *
 * ## Why a loop and not a batch
 *
 * `faceGallery` has `assignFaces` and `unassignFaces`, and NO `deleteFaces`.
 * So the client fans out `deleteFace` per id, bounded — an unbounded
 * `Promise.all` over a 200-face selection is a few hundred simultaneous
 * requests at an addon whose disk is under contention, which is the shape the
 * recompute button already had to be taught (`runWithConcurrency`).
 *
 * ## What it reports
 *
 * Per-face outcome, never a flat pass/fail. Each `deleteFace` is its own round
 * trip and any one of them can be refused on its own; a caller told only "it
 * failed" would re-run the whole selection over the faces that already went.
 * A refusal is LOGGED with the faceId as well as counted — a branch that drops
 * work silently is the thing this repo keeps paying for.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useConnection } from '../connection/ConnectionProvider.js'
import { log } from '../lib/logger.js'
import { capMutateOrThrow } from './cap-query.js'
import { runWithConcurrency } from './face-cluster-review.js'
import { invalidateFaceAssignmentQueriesNow } from './face-query-keys.js'

/** How many `faceGallery.deleteFace` calls are in flight at once. Same bound
 *  the recompute fan-out uses, and for the same reason. */
const DELETE_CONCURRENCY = 4

/** Outcome of a batch delete, normalised for the UI. */
export interface FaceDeleteResult {
  readonly deleted: number
  readonly failed: readonly string[]
}

export interface DeleteFacesInput {
  readonly faceIds: readonly string[]
}

/**
 * Remove buffered faces from the review buffer (row + crop media), one hub call
 * per face, at most {@link DELETE_CONCURRENCY} at a time.
 *
 * Resolves to the honest per-face outcome. Invalidates the whole face-assignment
 * key set once, at the end: a deleted face must leave the main grid, the Analyze
 * pool AND the clusters, and the deferred path would leave it on screen for four
 * seconds after the operator watched it go (D434's reasoning, applied to a
 * delete: the surface IS the list).
 */
export function useDeleteFaces() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<FaceDeleteResult, Error, DeleteFacesInput>({
    mutationFn: async ({ faceIds }): Promise<FaceDeleteResult> => {
      const system = controller.getSystem()
      if (!system) throw new Error('faceGallery.deleteFace: not connected')
      const client = system.trpcClient as Record<string, unknown>
      const failed: string[] = []
      let deleted = 0
      await runWithConcurrency([...faceIds], DELETE_CONCURRENCY, async (faceId) => {
        try {
          await capMutateOrThrow(client, 'faceGallery', 'deleteFace', { faceId })
          deleted += 1
        } catch (error: unknown) {
          // Counted AND named. "18 of 20 deleted" with no idea which two is a
          // number the operator cannot act on.
          failed.push(faceId)
          log.warn('face-delete', 'the hub refused to delete a face', {
            faceId,
            error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          })
        }
      })
      return { deleted, failed }
    },
    onSuccess: async () => {
      await invalidateFaceAssignmentQueriesNow(queryClient)
    },
  })
}
