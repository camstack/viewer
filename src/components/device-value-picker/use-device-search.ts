/**
 * The device → value picker's reads: `deviceManager.search`, one cursor page
 * at a time, and the same method resolving exactly the picked ids.
 *
 * Both are the hub's own answer (server-side filtering, facet counts, the
 * reading of each matching value). A failed read THROWS so the query is
 * `isError` — never an empty answer (D315): "no device provides it" is a
 * claim only an answer can make.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { DeviceSearchInput, DeviceSearchItem, DeviceSearchResult } from '@camstack/types'

import { useConnection } from '../../connection/ConnectionProvider.js'
import { capQuery, isRecord } from '../../data/cap-query.js'
import { mergePages } from './device-value-picker-model.js'

/** The text the hub is asked about trails the keystrokes by this much. */
export const SEARCH_DEBOUNCE_MS = 250

/** A search answer stays fresh this long: readings move, the fleet rarely does. */
const SEARCH_STALE_MS = 15_000

/** The query minus the cursor, which the paging owns, and the ids, which the resolve owns. */
export type DeviceSearchQuery = Omit<DeviceSearchInput, 'cursor' | 'ids'>

/**
 * The shape check at the wire. The hub validates its own output against
 * `DeviceSearchResultSchema`; the app holds no copy of that schema (it is not
 * on `@camstack/types/client`), so this checks the parts the picker walks and
 * refuses anything else as unreadable rather than drawing it as "nothing".
 */
export function isDeviceSearchResult(raw: unknown): raw is DeviceSearchResult {
  if (!isRecord(raw)) return false
  const facets = raw.facets
  return (
    Array.isArray(raw.items) &&
    Array.isArray(raw.suggested) &&
    Array.isArray(raw.missingIds) &&
    typeof raw.total === 'number' &&
    typeof raw.compatibleTotal === 'number' &&
    typeof raw.fleetTotal === 'number' &&
    typeof raw.hiddenIncompatible === 'number' &&
    isRecord(facets) &&
    Array.isArray(facets.locations) &&
    Array.isArray(facets.integrations) &&
    Array.isArray(facets.types)
  )
}

export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(handle)
  }, [value, ms])
  return debounced
}

/** One `deviceManager.search` call; throws on a failed or unreadable answer. */
function useSearchCall(): (input: DeviceSearchInput) => Promise<DeviceSearchResult> {
  const { controller } = useConnection()
  return async (input) => {
    const system = controller.getSystem()
    if (!system) throw new Error('not connected')
    // Documented boundary: the tRPC proxy is walked by path (see cap-query.ts).
    const raw: unknown = await capQuery(
      system.trpcClient as unknown as Record<string, unknown>,
      'deviceManager',
      'search',
      input,
      { rethrow: true },
    )
    if (!isDeviceSearchResult(raw)) throw new Error('device search unreadable')
    return raw
  }
}

export interface DeviceValueSearch {
  /** The first page: facets, totals and suggestions. */
  readonly first: DeviceSearchResult | undefined
  readonly items: readonly DeviceSearchItem[]
  readonly isPending: boolean
  readonly isError: boolean
  readonly isFetchingNextPage: boolean
  readonly fetchNextPage: () => void
  readonly refetch: () => void
}

export function deviceSearchKey(query: DeviceSearchQuery): readonly unknown[] {
  return ['v2', 'device-search', JSON.stringify(query)]
}

/** The picker's list. `enabled` keeps a closed picker from asking. */
export function useDeviceValueSearch(query: DeviceSearchQuery, enabled: boolean): DeviceValueSearch {
  const { state } = useConnection()
  const call = useSearchCall()
  const q = useInfiniteQuery<DeviceSearchResult, Error>({
    queryKey: deviceSearchKey(query),
    enabled: enabled && state === 'connected',
    staleTime: SEARCH_STALE_MS,
    // The previous answer stays on screen while a keystroke's answer loads.
    placeholderData: (previous) => previous,
    initialPageParam: null,
    queryFn: ({ pageParam }) =>
      call({ ...query, cursor: typeof pageParam === 'string' ? pageParam : null }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const pages = q.data?.pages
  const items = useMemo(() => mergePages(pages ?? []), [pages])
  const { hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = q
  return {
    first: pages?.[0],
    items,
    isPending: q.isPending,
    isError: q.isError,
    isFetchingNextPage,
    fetchNextPage: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
    },
    refetch: () => void refetch(),
  }
}

export interface ResolvedDevices {
  readonly result: DeviceSearchResult | undefined
  readonly isError: boolean
}

/**
 * Resolve exactly these devices (picked values, recents) regardless of any
 * filter; `requires` is passed so each item carries its readings. A device
 * the hub does not have comes back in `missingIds` — only that answer may call
 * it gone (D315).
 */
export function useResolvedDevices(
  ids: readonly number[],
  requires: DeviceSearchInput['requires'],
): ResolvedDevices {
  const { state } = useConnection()
  const call = useSearchCall()
  // A fresh array sorted in place: Hermes has no `toSorted`.
  const sorted = [...new Set(ids)].sort((a, b) => a - b)
  const q = useQuery<DeviceSearchResult, Error>({
    queryKey: ['v2', 'device-search-ids', sorted, JSON.stringify(requires ?? null)],
    enabled: sorted.length > 0 && state === 'connected',
    staleTime: SEARCH_STALE_MS,
    queryFn: () =>
      call({
        ids: sorted,
        ...(requires !== undefined ? { requires } : {}),
        limit: Math.min(Math.max(sorted.length, 1), 200),
      }),
  })
  return { result: q.data, isError: q.isError }
}
