import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { isUnauthorizedError } from '../auth/unauthorized.js'
import { setUnauthorizedHandler, signalUnauthorized } from '../auth/unauthorized-signal.js'
import { isForbiddenError, reportOutOfScopeCall, setForbiddenHandler, signalForbidden } from '../auth/forbidden.js'
import { log } from '../lib/logger.js'
import { COLD_QUERY_MAX_LINES, createColdQueryBudget } from './cold-query-budget.js'

// The handler is registered by the app (`use-session-renewal.ts`) so a hub
// `UNAUTHORIZED` from ANY query/mutation is handled in one place: the session
// is renewed, and only a refused renewal signs out and bounces to login. The
// registry lives in `auth/unauthorized-signal.ts`, which the swallowing call
// helpers (`capQuery`) report to as well.
export { setUnauthorizedHandler }

/**
 * The two auth outcomes, told apart at the one place every call passes.
 *
 * `UNAUTHORIZED` = the token was refused → renew, or sign out if the hub
 * refuses that too (`ServerProvider.renewSession`). `FORBIDDEN` = the session is
 * healthy and the SCOPE gate refused this call → never sign out, never surface
 * an error to the operator (who did nothing wrong), but never swallow it
 * either: a refusal means a control was drawn, or a query fired, for something
 * the hidden-surface rules in `hooks/user-scope.ts` should already have kept
 * off screen. `reportOutOfScopeCall` gives that bug a greppable name.
 *
 * Everything else stays silently swallowed here, as before.
 */
function handleError(error: unknown, source: string): void {
  if (isUnauthorizedError(error)) {
    signalUnauthorized()
    return
  }
  if (isForbiddenError(error)) {
    reportOutOfScopeCall(source, error)
    signalForbidden()
  }
}

/** The `auth.me` family (`meQueryKey`), every hub and session. */
const ME_QUERY_PREFIX: readonly unknown[] = ['v2', 'me']

function mutationName(mutationKey: readonly unknown[] | undefined): string {
  return mutationKey === undefined ? 'unkeyed' : queryName(mutationKey)
}

const COLD_QUERY_TRACE_MS = 30_000

function queryName(queryKey: readonly unknown[]): string {
  return queryKey
    .slice(0, 3)
    .map((part) =>
      typeof part === 'string' || typeof part === 'number'
        ? String(part)
        : Array.isArray(part)
          ? `[${String(part.length)}]`
          : '{…}',
    )
    .join('/')
}

function attachColdQueryTrace(cache: QueryCache): void {
  const traceStartedAt = Date.now()
  const startedAt = new Map<string, number>()
  const attempts = new Map<string, number>()
  // 30 s bounds WHEN this trace runs; it did not bound how much it says, and a
  // cold start fires hundreds of queries. See `cold-query-budget.ts` for the
  // measurement (782 lines from one launch).
  const budget = createColdQueryBudget()

  /** Write, summarise once, or stay quiet. Keeps the cap in ONE place. */
  const write = (msg: string, data: Record<string, unknown>): void => {
    const verdict = budget.admit()
    if (verdict === 'log') {
      log.info('cold-query', msg, data)
      return
    }
    if (verdict === 'summarise') {
      log.info('cold-query', 'trace capped', {
        wrote: COLD_QUERY_MAX_LINES,
        note: 'further cold-start query lines suppressed for this launch',
      })
    }
  }

  cache.subscribe((event) => {
    if (Date.now() - traceStartedAt > COLD_QUERY_TRACE_MS || event.type !== 'updated') return
    const action = event.action
    const hash = event.query.queryHash
    const name = queryName(event.query.queryKey)

    if (action.type === 'fetch') {
      const attempt = (attempts.get(hash) ?? 0) + 1
      attempts.set(hash, attempt)
      startedAt.set(hash, Date.now())
      write('start', { name, attempt })
      return
    }

    if (action.type !== 'success' && action.type !== 'error') return
    const started = startedAt.get(hash)
    startedAt.delete(hash)
    write(action.type, {
      name,
      attempt: attempts.get(hash) ?? 1,
      ms: started === undefined ? null : Date.now() - started,
    })
  })
}

/** Build a React Query client with srcV2 defaults: short staleness window,
 *  a single retry, and no window-focus refetch (RN has no window focus).
 *  Cache-level `onError` centrally funnels every hub `UNAUTHORIZED` into the
 *  registered sign-out handler (FIX 1) — an expired session takes the user
 *  back to login instead of surfacing a raw "unauthorized" error. */
export function createQueryClient(): QueryClient {
  const queryCache = new QueryCache({
    onError: (error, query) => handleError(error, `query ${queryName(query.queryKey)}`),
  })
  attachColdQueryTrace(queryCache)
  const client = new QueryClient({
    queryCache,
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) =>
        handleError(error, `mutation ${mutationName(mutation.options.mutationKey)}`),
    }),
    defaultOptions: {
      queries: {
        staleTime: 5000,
        // Backgrounding the app disables the socket-gated queries; with the
        // default 5-minute gcTime their data (frame identities, minted links)
        // is COLLECTED while suspended, and every tile remounts with an
        // unversioned bootstrap URL on resume — a full-grid refetch wave and
        // the "all snapshots blank until the next refresh" report
        // (2026-08-16). Snapshot rows are ~40 B per device; keeping them is
        // free. Queries that genuinely must expire set their own gcTime.
        gcTime: 30 * 60_000,
        // Never burn retries on an auth rejection — fail fast so the
        // central handler bounces to login without a retry delay.
        retry: (failureCount, error) => !isUnauthorizedError(error) && failureCount < 1,
        refetchOnWindowFocus: false,
      },
    },
  })
  // A refusal re-asks the role, so a feature switched off on the hub takes its
  // section with it instead of failing on every open (`forbidden.ts`).
  setForbiddenHandler(() => {
    void client.invalidateQueries({ queryKey: [...ME_QUERY_PREFIX] })
  })
  return client
}
