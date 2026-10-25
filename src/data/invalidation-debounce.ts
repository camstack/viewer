/**
 * invalidation-debounce — the coalescer in front of the live invalidation
 * bridge (`use-live-invalidation.ts`).
 *
 * ## What went wrong without it
 *
 * `use-live-invalidation` maps ONE hub event category onto several query-key
 * prefixes and called `queryClient.invalidateQueries` once per event, per key.
 * `device.state-changed` is emitted per device per state slice, so a cold start
 * — every camera provider announcing itself at once — is a burst, not a
 * trickle. Measured on the live system: `['v2','children-states']` was
 * dispatched **18,924 times in 30 s**.
 *
 * Two things made that burst expensive rather than merely wasteful:
 *
 *  1. React Query's `invalidateQueries` defaults to `cancelRefetch: true`. Each
 *     dispatch therefore ABORTED the in-flight refetch of every matching
 *     observer and started it again. With 19 observers on that prefix, the work
 *     never finished — it was restarted faster than it could complete.
 *  2. Those refetches share ONE tRPC WebSocket (the SDK builds a single
 *     `wsLink`; there is no batching link). A restarted fan-out keeps occupying
 *     the socket, so an UNRELATED 50 ms RPC (`snapshot-overview`) measured
 *     6000 ms and the snapshot paint gate slipped by seconds.
 *
 * ## The shape
 *
 * A trailing debounce PER KEY. A burst of any size within the window collapses
 * to exactly one invalidation, and a key that keeps receiving events keeps
 * extending its own wait — which is the correct behaviour here, because the
 * point of the invalidation is to reflect the SETTLED state, not each
 * intermediate one. Different prefixes never share a timer: `cap-status`
 * settling must not be held back by `children-states` still churning.
 *
 * Kept out of the hook so it can be tested without a renderer — this repo has
 * no React test harness (`vitest` runs in the `node` environment), so anything
 * that must be proven correct lives in a plain module.
 * See `__tests__/invalidation-debounce.spec.ts`.
 */

/** A React Query key PREFIX, as the invalidation map declares them. */
export type QueryKeyPrefix = readonly string[]

/** Called once per key per window, with the key that settled. */
export type InvalidationFlush = (queryKey: QueryKeyPrefix) => void

/**
 * How long a key must be quiet before it is invalidated.
 *
 * 300 ms: long enough to swallow a provider-announcement burst (those arrive
 * within a few ms of each other), short enough that a single human-caused state
 * change — a light switched from another client — still reaches the screen
 * inside one frame budget of "instant". It is a floor on nothing: the D8
 * reconcile poll (`RECONCILE_MS`) remains the backstop.
 */
export const INVALIDATION_DEBOUNCE_MS = 300

/**
 * Serialize a key prefix into a Map key.
 *
 * NUL (\u0000) rather than a printable separator so no segment can forge a
 * boundary: `['v2','a/b']` and `['v2','a','b']` are different prefixes to React
 * Query and must be different timers here.
 */
export function serializeQueryKey(queryKey: QueryKeyPrefix): string {
  return queryKey.join('\u0000')
}

/** A live debouncer. Owned by the hook's effect; `dispose` on teardown. */
export interface InvalidationDebouncer {
  /** Record an event for `queryKey`; flushes once the key goes quiet. */
  readonly schedule: (queryKey: QueryKeyPrefix) => void
  /** Cancel every pending timer. Safe to call more than once. */
  readonly dispose: () => void
}

/**
 * Create a per-key trailing debouncer.
 *
 * @param delayMs Quiet period a key must observe before it flushes.
 * @param flush   Invoked with the key once the window elapses.
 */
export function createInvalidationDebouncer(
  delayMs: number,
  flush: InvalidationFlush,
): InvalidationDebouncer {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const schedule = (queryKey: QueryKeyPrefix): void => {
    const id = serializeQueryKey(queryKey)
    const pending = timers.get(id)
    // Trailing: a new event inside the window replaces the pending fire rather
    // than adding one, so N events cost one invalidation, not N.
    if (pending !== undefined) clearTimeout(pending)
    timers.set(
      id,
      setTimeout(() => {
        // Dropped BEFORE the callback so the map never retains a fired timer,
        // and so a `schedule` made from within `flush` starts a fresh window.
        timers.delete(id)
        flush(queryKey)
      }, delayMs),
    )
  }

  const dispose = (): void => {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
  }

  return { schedule, dispose }
}
