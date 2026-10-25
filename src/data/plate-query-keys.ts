/**
 * plate-query-keys — the React Query keys that hold plate-assignment state, and
 * the one invalidation that covers them (the twin of `face-query-keys.ts`: an
 * assignment changes the grid, the vehicle counts AND the similar groups, and a
 * key only one module knew about is how a taken group came back).
 */
import type { QueryClient } from '@tanstack/react-query'

const NAMESPACE = 'v2'

export const PLATE_REVIEW_KEY = 'plate-review-plates'
export const PLATE_VEHICLES_KEY = 'plate-vehicles'
export const PLATE_CLUSTERS_KEY = 'plate-review-clusters'

const PLATE_ASSIGNMENT_QUERY_KEYS: readonly string[] = [PLATE_REVIEW_KEY, PLATE_VEHICLES_KEY, PLATE_CLUSTERS_KEY]

/** Re-ask the hub for everything a plate write just changed; resolves when they landed. */
export async function invalidatePlateQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all(
    PLATE_ASSIGNMENT_QUERY_KEYS.map((key) => queryClient.invalidateQueries({ queryKey: [NAMESPACE, key] })),
  )
}
