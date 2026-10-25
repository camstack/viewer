/**
 * Corpus frames for the Library Retrain tab — frames already in the dataset,
 * not staging tracks. Marking stays on Events; this surface browses and
 * organises collections.
 */
import { useCallback, useMemo } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RetrainFrame } from '@camstack/types'

import { useConnection } from '../connection/ConnectionProvider.js'
import { useServer } from '../app/ServerProvider.js'
import { sessionDiscriminator } from '../app/session-key.js'
import { BULK_QUERY_DEADLINE_MS, capMutateOrThrow, capQuery } from './cap-query.js'
import { parseRetrainCorpusPage, type RetrainCorpusPageResult } from './retrain-parse.js'
import { retrainCollectionsQueryKey } from './use-retrain-collections.js'
import { useHasFeature } from './use-me.js'

/**
 * The hub's `RetrainCorpusFilterSchema.pageSize` is `.max(100)`. A larger ask
 * is rejected by Zod before the handler runs, `capQuery` rethrows, and the
 * whole Retrain tab reads "could not load" (1.0.598 sent 200).
 */
export const RETRAIN_CORPUS_PAGE_SIZE = 100
const CORPUS_FRAME_LIMIT = 2_000

export const RETRAIN_CORPUS_QUERY_KEY = 'retrain-corpus-frames'

interface CorpusFilter {
  readonly deviceIds?: readonly number[]
  readonly collectionIds?: readonly string[]
}

function trpcClient(controller: {
  getSystem(): { trpcClient: unknown } | null
}): Record<string, unknown> | null {
  const system = controller.getSystem()
  if (!system) return null
  return system.trpcClient as Record<string, unknown>
}

async function requestCorpusPage(
  client: Record<string, unknown>,
  filter: CorpusFilter,
  page: number,
  collectionId: string | undefined,
): Promise<RetrainCorpusPageResult> {
  const raw = await capQuery(
    client,
    'pipelineAnalytics',
    'listRetrainCorpusPage',
    {
      ...(filter.deviceIds !== undefined && filter.deviceIds.length > 0
        ? { deviceIds: [...filter.deviceIds] }
        : {}),
      ...(collectionId !== undefined ? { collectionId } : {}),
      page,
      pageSize: RETRAIN_CORPUS_PAGE_SIZE,
    },
    { deadlineMs: BULK_QUERY_DEADLINE_MS, rethrow: true },
  )
  const parsed = parseRetrainCorpusPage(raw)
  if (parsed === undefined) throw new Error('unparseable corpus frames')
  return parsed
}

/**
 * One page. The grid paints this and asks for the next on scroll.
 *
 * A single collection (or none) is the Library filter. Several collections
 * are the editor's full walk, which still uses {@link fetchRetrainCorpus}.
 */
export async function fetchRetrainCorpusPage(
  client: Record<string, unknown>,
  filter: CorpusFilter,
  page: number,
): Promise<RetrainCorpusPageResult> {
  const collectionId =
    filter.collectionIds !== undefined && filter.collectionIds.length > 0
      ? filter.collectionIds[0]
      : undefined
  return requestCorpusPage(client, filter, page, collectionId)
}

/** The next page index, or undefined when this page already covers the total. */
export function nextRetrainCorpusPage(page: RetrainCorpusPageResult): number | undefined {
  if (page.frames.length === 0) return undefined
  if (page.page * page.pageSize >= page.total) return undefined
  return page.page + 1
}

/** Walk the paged corpus (one `collectionId` per call), merged by `frameId`. */
export async function fetchRetrainCorpus(
  client: Record<string, unknown>,
  filter: CorpusFilter,
): Promise<readonly RetrainFrame[]> {
  const scopes: readonly (string | undefined)[] =
    filter.collectionIds !== undefined && filter.collectionIds.length > 0
      ? filter.collectionIds
      : [undefined]
  const byId = new Map<string, RetrainFrame>()
  for (const collectionId of scopes) {
    for (let page = 1; byId.size < CORPUS_FRAME_LIMIT; page += 1) {
      const parsed = await requestCorpusPage(client, filter, page, collectionId)
      for (const frame of parsed.frames) byId.set(frame.frameId, frame)
      if (nextRetrainCorpusPage(parsed) === undefined) break
    }
  }
  return [...byId.values()]
}

export interface RetrainCorpusGrid {
  readonly frames: readonly RetrainFrame[]
  readonly total: number
  readonly isLoading: boolean
  readonly isPending: boolean
  readonly isError: boolean
  readonly isFetching: boolean
  readonly isFetchingNextPage: boolean
  readonly hasNextPage: boolean
  readonly fetchNextPage: () => void
  readonly refetch: () => Promise<unknown>
}

/**
 * The Library grid: the first page paints, later pages load as the operator
 * scrolls. The editor still uses {@link useRetrainCorpusFrames}, which walks
 * every page so prev/next can name a frame that is not on page one.
 */
export function useRetrainCorpusPages(filter: CorpusFilter, enabled: boolean): RetrainCorpusGrid {
  const canRetrain = useHasFeature('retrain')
  const { controller, state } = useConnection()
  const deviceKey = filter.deviceIds?.join(',') ?? ''
  const collectionKey = filter.collectionIds?.join(',') ?? ''
  const query = useInfiniteQuery({
    queryKey: ['v2', RETRAIN_CORPUS_QUERY_KEY, 'pages', deviceKey, collectionKey],
    enabled: enabled && canRetrain && state === 'connected',
    staleTime: 20_000,
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<RetrainCorpusPageResult> => {
      const client = trpcClient(controller)
      if (!client) throw new Error('not connected')
      const page = typeof pageParam === 'number' ? pageParam : 1
      return fetchRetrainCorpusPage(client, filter, page)
    },
    getNextPageParam: (last) => nextRetrainCorpusPage(last),
  })
  const frames = useMemo<readonly RetrainFrame[]>(
    () => (query.data?.pages ?? []).flatMap((page) => [...page.frames]),
    [query.data],
  )
  const total = query.data?.pages[query.data.pages.length - 1]?.total ?? 0
  const { fetchNextPage: fetchNext, refetch: refetchQuery, hasNextPage, isFetchingNextPage } = query
  const fetchNextPage = useCallback((): void => {
    if (hasNextPage && !isFetchingNextPage) void fetchNext()
  }, [fetchNext, hasNextPage, isFetchingNextPage])
  const refetch = useCallback(() => refetchQuery(), [refetchQuery])
  return {
    frames,
    total,
    isLoading: query.isLoading,
    isPending: query.isPending,
    isError: query.isError,
    isFetching: query.isFetching,
    isFetchingNextPage,
    hasNextPage: hasNextPage === true,
    fetchNextPage,
    refetch,
  }
}

export function useRetrainCorpusFrames(filter: CorpusFilter, enabled: boolean) {
  const canRetrain = useHasFeature('retrain')
  const { controller, state } = useConnection()
  const deviceKey = filter.deviceIds?.join(',') ?? ''
  const collectionKey = filter.collectionIds?.join(',') ?? ''
  return useQuery<readonly RetrainFrame[]>({
    queryKey: ['v2', RETRAIN_CORPUS_QUERY_KEY, deviceKey, collectionKey],
    enabled: enabled && canRetrain && state === 'connected',
    staleTime: 20_000,
    queryFn: async () => {
      const client = trpcClient(controller)
      if (!client) throw new Error('not connected')
      return fetchRetrainCorpus(client, filter)
    },
  })
}

export function useRenameRetrainCollection() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  const { server, sessionToken } = useServer()
  return useMutation({
    mutationFn: async (input: { id: string; name: string }) => {
      const client = trpcClient(controller)
      if (!client) throw new Error('not connected')
      return capMutateOrThrow(client, 'pipelineAnalytics', 'renameRetrainCollection', input)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: retrainCollectionsQueryKey(server?.serverUrl ?? null, sessionToken),
      })
    },
  })
}

export function useDeleteRetrainCollection() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  const { server, sessionToken } = useServer()
  return useMutation({
    mutationFn: async (id: string) => {
      const client = trpcClient(controller)
      if (!client) throw new Error('not connected')
      return capMutateOrThrow(client, 'pipelineAnalytics', 'deleteRetrainCollection', { id })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: retrainCollectionsQueryKey(server?.serverUrl ?? null, sessionToken),
      })
      void queryClient.invalidateQueries({ queryKey: ['v2', RETRAIN_CORPUS_QUERY_KEY] })
    },
  })
}

export function useAddRetrainFramesToCollection() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  const { server, sessionToken } = useServer()
  return useMutation({
    mutationFn: async (input: { collectionId: string; frameIds: readonly string[] }) => {
      const client = trpcClient(controller)
      if (!client) throw new Error('not connected')
      return capMutateOrThrow(client, 'pipelineAnalytics', 'addRetrainFramesToCollection', {
        collectionId: input.collectionId,
        frameIds: [...input.frameIds],
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: retrainCollectionsQueryKey(server?.serverUrl ?? null, sessionToken),
      })
      void queryClient.invalidateQueries({ queryKey: ['v2', RETRAIN_CORPUS_QUERY_KEY] })
    },
  })
}

export function useRemoveRetrainFrameFromCollection() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  const { server, sessionToken } = useServer()
  return useMutation({
    mutationFn: async (input: { collectionId: string; frameId: string }) => {
      const client = trpcClient(controller)
      if (!client) throw new Error('not connected')
      return capMutateOrThrow(client, 'pipelineAnalytics', 'removeRetrainFrameFromCollection', input)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: retrainCollectionsQueryKey(server?.serverUrl ?? null, sessionToken),
      })
      void queryClient.invalidateQueries({ queryKey: ['v2', RETRAIN_CORPUS_QUERY_KEY] })
    },
  })
}
