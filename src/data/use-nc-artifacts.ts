/**
 * use-nc-artifacts — TanStack Query hooks over the {@link makeNcArtifactsClient}
 * bridge client, plus the ONE resolver that turns a record's relative
 * `downloadPath` into something a renderer can open.
 *
 * The list is an INFINITE query keyed on the filter set: the server pages by
 * `offset`/`limit` and answers `hasMore`, so a page param is an offset and the
 * gallery grows by `fetchNextPage` instead of refetching a bigger window. Keys
 * live in the repo's `['v2', 'nc', …]` namespace next to the rules and targets.
 *
 * Auth: the artifact data plane is `access: 'authenticated'`, the SAME plane
 * class as `event-media`. {@link useArtifactMedia} attaches the session Bearer
 * exactly as `TrackDetailView` / `CropTile` do — a URL rendered without it comes
 * back as a broken-image glyph, which is precisely how the track media strip
 * went blank the first time URL rendering shipped.
 */
import { useCallback, useMemo } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { useServer } from '../app/ServerProvider.js'
import { log } from '../lib/logger.js'
import type { NcClientDeps } from './notification-center.js'
import {
  artifactFilterKey,
  buildListArtifactsInput,
  makeNcArtifactsClient,
  nextArtifactsPageParam,
  resolveArtifactThumb,
  resolveArtifactUrl,
  toArtifactsPage,
  NC_ARTIFACTS_PAGE_SIZE,
  type ArtifactThumbSource,
  type NcArtifactFilters,
  type NcArtifactRecord,
  type NcArtifactsPage,
  type NcDeleteArtifactResult,
} from './nc-artifacts.js'

const ARTIFACTS_KEY = ['v2', 'nc', 'artifacts'] as const
const ARTIFACT_KEY = ['v2', 'nc', 'artifact'] as const

/**
 * Route one `addons.custom` call over the live tRPC proxy. `trpcClient` is typed
 * `unknown` by the SDK (the tRPC proxy boundary — a router/method is a callable
 * proxy), so the leaf `.mutate` is read structurally, exactly as
 * `use-notification-center.ts` does. Throws when the bridge procedure is absent
 * so the caller surfaces the failure rather than treating it as an empty list.
 */
async function addonsCustomCall(
  trpcClient: unknown,
  args: { addonId: string; action: string; input: unknown },
): Promise<unknown> {
  const client = trpcClient as Record<string, unknown>
  const addons = client.addons
  const custom =
    typeof addons === 'object' || typeof addons === 'function'
      ? (addons as Record<string, unknown> | null)?.custom
      : undefined
  const mutate = custom != null ? (custom as { mutate?: unknown }).mutate : undefined
  if (typeof mutate !== 'function') throw new Error('addons.custom unavailable')
  return await (mutate as (i: { addonId: string; action: string; input: unknown }) => Promise<unknown>)(args)
}

function artifactsDeps(trpcClient: unknown): NcClientDeps {
  return { addonsCustomMutate: (args) => addonsCustomCall(trpcClient, args) }
}

// ── List ───────────────────────────────────────────────────────────────────

/** Options for {@link useNcArtifacts}. */
export interface NcArtifactsOptions {
  /** Rows per page. Clamped to the server ceiling by the input builder. */
  readonly pageSize?: number
  /** Hold the query (e.g. the screen is not focused). Default: run. */
  readonly enabled?: boolean
}

/** What the gallery renders from. */
export interface NcArtifactsFeed {
  /** Every row loaded so far, newest `capturedAt` first (server order). */
  readonly artifacts: readonly NcArtifactRecord[]
  /** How many rows the FILTER matches on the hub — not how many are loaded. */
  readonly total: number
  readonly isLoading: boolean
  readonly isRefetching: boolean
  readonly error: Error | null
  readonly hasNextPage: boolean
  readonly isFetchingNextPage: boolean
  readonly fetchNextPage: () => void
  readonly refetch: () => void
}

/**
 * The artifact list for a filter set, paged by offset.
 *
 * `staleTime` is 30 s, matching the other NC lists: artifacts appear when a rule
 * fires or a timelapse closes its window — minutes apart, not seconds — so a
 * shorter window would only re-ask the hub for the same page.
 */
export function useNcArtifacts(
  filters: NcArtifactFilters,
  options?: NcArtifactsOptions,
): NcArtifactsFeed {
  const { controller, state } = useConnection()
  const pageSize = options?.pageSize ?? NC_ARTIFACTS_PAGE_SIZE
  const filterKey = artifactFilterKey(filters)

  const query = useInfiniteQuery<NcArtifactsPage, Error>({
    queryKey: [...ARTIFACTS_KEY, filterKey, pageSize],
    enabled: options?.enabled !== false && state === 'connected',
    staleTime: 30_000,
    // A filter change swaps the key: keep the previous rows on screen instead
    // of dropping the whole gallery to a spinner for one chip tap.
    placeholderData: (prev) => prev,
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<NcArtifactsPage> => {
      const offset = typeof pageParam === 'number' ? pageParam : 0
      const request = { limit: pageSize, offset }
      const system = controller.getSystem()
      if (!system) return { artifacts: [], total: 0, hasMore: false, nextOffset: offset }
      const input = buildListArtifactsInput(filters, request)
      const result = await makeNcArtifactsClient(artifactsDeps(system.trpcClient)).listArtifacts(input)
      log.debug('nc-artifacts', 'page loaded', {
        offset,
        limit: pageSize,
        rows: result.artifacts.length,
        total: result.total,
        hasMore: result.hasMore,
      })
      return toArtifactsPage(result, request)
    },
    getNextPageParam: (lastPage) => nextArtifactsPageParam(lastPage),
  })

  const artifacts = useMemo<readonly NcArtifactRecord[]>(
    () => (query.data?.pages ?? []).flatMap((p) => [...p.artifacts]),
    [query.data],
  )
  const total = query.data?.pages[query.data.pages.length - 1]?.total ?? 0

  // TanStack's own `fetchNextPage` / `refetch` are stable, so these wrappers
  // are too — a `FlatList`'s `onEndReached` must not change identity on every
  // render of a gallery that is already scrolling.
  const { fetchNextPage: fetchNext, refetch: refetchQuery, hasNextPage, isFetchingNextPage } = query
  const fetchNextPage = useCallback((): void => {
    if (hasNextPage && !isFetchingNextPage) void fetchNext()
  }, [fetchNext, hasNextPage, isFetchingNextPage])
  const refetch = useCallback((): void => {
    void refetchQuery()
  }, [refetchQuery])

  const { isLoading, isRefetching, error } = query
  return useMemo(
    () => ({
      artifacts,
      total,
      isLoading,
      isRefetching,
      error,
      hasNextPage,
      isFetchingNextPage,
      fetchNextPage,
      refetch,
    }),
    [
      artifacts, total, isLoading, isRefetching, error, hasNextPage, isFetchingNextPage,
      fetchNextPage, refetch,
    ],
  )
}

// ── Detail ─────────────────────────────────────────────────────────────────

/**
 * One artifact by id. `null` means the hub no longer has it (expired, deleted)
 * — a real answer the detail view renders as "gone", never as a loading state.
 *
 * Disabled for an empty id so a closed detail sheet issues no request.
 */
export function useNcArtifact(artifactId: string | null): UseQueryResult<NcArtifactRecord | null> {
  const { controller, state } = useConnection()
  return useQuery<NcArtifactRecord | null>({
    queryKey: [...ARTIFACT_KEY, artifactId ?? ''],
    enabled: state === 'connected' && artifactId !== null && artifactId.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<NcArtifactRecord | null> => {
      const system = controller.getSystem()
      if (!system || artifactId === null) return null
      const { artifact } = await makeNcArtifactsClient(artifactsDeps(system.trpcClient)).getArtifact(artifactId)
      return artifact
    },
  })
}

// ── Delete ────────────────────────────────────────────────────────────────

/**
 * Remove one artifact from the hub — the index row and the bytes.
 *
 * Two things this hook must not get wrong:
 *
 *  • **It drops every id the hub REPORTS, not the one it was asked for.** A
 *    video artifact is deleted together with its poster still, so `removedIds`
 *    can carry two ids for one card; a cached poster row that survives its
 *    video keeps a thumbnail pointing at bytes that are gone.
 *  • **`deleted: false` is not an error.** It is the hub's single answer to
 *    unknown / expired / not yours / global-and-not-admin, and it resolves
 *    normally so the caller can SAY so. Throwing would paint a refusal as a
 *    broken app. The list is refreshed either way — a refusal is also what a
 *    row somebody else already deleted looks like.
 */
export function useDeleteNcArtifact(): UseMutationResult<NcDeleteArtifactResult, Error, string> {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<NcDeleteArtifactResult, Error, string>({
    mutationFn: async (artifactId): Promise<NcDeleteArtifactResult> => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const result = await makeNcArtifactsClient(artifactsDeps(system.trpcClient)).deleteArtifact(
        artifactId,
      )
      log.info('nc-artifacts', 'delete', {
        artifactId,
        deleted: result.deleted,
        removed: result.removedIds.length,
      })
      return result
    },
    onSuccess: (result, artifactId) => {
      for (const id of new Set([artifactId, ...result.removedIds])) {
        queryClient.removeQueries({ queryKey: [...ARTIFACT_KEY, id] })
      }
      void queryClient.invalidateQueries({ queryKey: ARTIFACTS_KEY })
    },
  })
}

// ── Bytes ──────────────────────────────────────────────────────────────────

/** Everything a renderer needs to open an artifact's bytes. */
export interface ArtifactMediaResolver {
  /** The connected hub base a relative `downloadPath` resolves against. */
  readonly serverUrl: string | null
  /** Bearer header for the authenticated data plane; `undefined` when signed out. */
  readonly headers: Record<string, string> | undefined
  /** Absolute URL for the artifact's own bytes, or `null` with no hub. */
  readonly urlFor: (record: NcArtifactRecord) => string | null
  /** What a gallery tile should draw (own pixels, poster still, or placeholder). */
  readonly thumbFor: (record: NcArtifactRecord) => ArtifactThumbSource
}

/**
 * The single seam between an artifact record and a renderer.
 *
 * It reuses the app's existing data-plane conventions verbatim — hub base from
 * the live `SystemController`, `Authorization: Bearer <session>` from
 * `ServerProvider` — so an artifact URL is built and authenticated exactly like
 * an `event-media` URL. There is no second scheme to keep in step.
 */
export function useArtifactMedia(): ArtifactMediaResolver {
  const { controller, state } = useConnection()
  const { token } = useServer()
  const serverUrl = state === 'connected' ? (controller.getSystem()?.serverUrl ?? null) : null
  const headers = useMemo<Record<string, string> | undefined>(
    () => (token ? { Authorization: `Bearer ${token}` } : undefined),
    [token],
  )
  const urlFor = useCallback(
    (record: NcArtifactRecord): string | null => resolveArtifactUrl(serverUrl, record.downloadPath),
    [serverUrl],
  )
  const thumbFor = useCallback(
    (record: NcArtifactRecord): ArtifactThumbSource => resolveArtifactThumb(record, serverUrl),
    [serverUrl],
  )
  return { serverUrl, headers, urlFor, thumbFor }
}
