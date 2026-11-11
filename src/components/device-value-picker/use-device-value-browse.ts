/**
 * The device list's state, held ABOVE the page that draws it: the sheet's
 * value page (page 2) replaces the list on screen, and Back must find the
 * search, the facets and the scroll's data exactly as they were.
 *
 * Every decision is the shared model's (`device-value-picker-model.ts`,
 * byte-identical with the admin's); this hook only wires it to the reads.
 */
import { useMemo, useState } from 'react'
import type { DeviceSearchItem, DeviceSearchRequires, DeviceSearchResult } from '@camstack/types'

import {
  buildSections,
  derivePickerState,
  excludeItems,
  hasFacets,
  NO_FACETS,
  toggleFacet,
  toSearchFilters,
  type FacetKey,
  type FacetSelection,
  type ListSection,
  type PickerState,
} from './device-value-picker-model.js'
import {
  SEARCH_DEBOUNCE_MS,
  useDebouncedValue,
  useDeviceValueSearch,
  useResolvedDevices,
} from './use-device-search.js'

export interface DeviceValueBrowseOptions {
  readonly requires?: DeviceSearchRequires
  /** The device the field belongs to; its room is suggested first. */
  readonly contextDeviceId?: number
  /** Device types the field is fixed to, narrowed by the Type facet. */
  readonly fixedTypes?: readonly string[]
  readonly excludeIds?: readonly number[]
  readonly excludeTypes?: readonly string[]
  /** Ids this field offered last, most recent first. */
  readonly recentIds: readonly number[]
  /** False while the list is not on screen: nothing is asked. */
  readonly enabled: boolean
}

export interface DeviceValueBrowse {
  readonly text: string
  readonly setText: (next: string) => void
  /** The text the hub was asked about (debounced, trimmed). */
  readonly query: string
  readonly facets: FacetSelection
  readonly toggleFacet: (key: FacetKey, value: string) => void
  /** The facet whose options are open under the chips; null = all collapsed. */
  readonly openFacet: FacetKey | null
  readonly setOpenFacet: (next: FacetKey | null) => void
  readonly showIncompatible: boolean
  readonly setShowIncompatible: (next: boolean) => void
  readonly first: DeviceSearchResult | undefined
  readonly items: readonly DeviceSearchItem[]
  readonly sections: readonly ListSection[]
  readonly state: PickerState
  readonly isFetchingNextPage: boolean
  readonly fetchNextPage: () => void
  readonly refetch: () => void
  readonly clear: () => void
}

export function useDeviceValueBrowse(options: DeviceValueBrowseOptions): DeviceValueBrowse {
  const [text, setText] = useState('')
  const [facets, setFacets] = useState<FacetSelection>(NO_FACETS)
  const [openFacet, setOpenFacet] = useState<FacetKey | null>(null)
  const [showIncompatible, setShowIncompatible] = useState(false)
  const query = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS)

  const filters = toSearchFilters(facets, options.fixedTypes)
  const search = useDeviceValueSearch(
    {
      ...(query !== '' ? { text: query } : {}),
      ...(options.requires !== undefined ? { requires: options.requires } : {}),
      ...(filters !== undefined ? { filters } : {}),
      ...(showIncompatible ? { includeIncompatible: true } : {}),
      ...(options.contextDeviceId !== undefined ? { contextDeviceId: options.contextDeviceId } : {}),
    },
    options.enabled,
  )
  const recent = useResolvedDevices(options.enabled ? options.recentIds : [], options.requires)

  const narrowed = query !== '' || hasFacets(facets)
  const { excludeIds, excludeTypes } = options
  const items = useMemo(
    () => excludeItems(search.items, { ids: excludeIds, types: excludeTypes }),
    [search.items, excludeIds, excludeTypes],
  )
  const suggestedRaw = search.first?.suggested
  const recentRaw = recent.result?.items
  const sections = useMemo(() => {
    const exclude = { ids: excludeIds, types: excludeTypes }
    return buildSections({
      items,
      suggested: excludeItems(suggestedRaw ?? [], exclude),
      recent: excludeItems((recentRaw ?? []).filter((i) => i.compatible), exclude),
      shortlist: !narrowed,
    })
  }, [items, suggestedRaw, recentRaw, narrowed, excludeIds, excludeTypes])

  const state = derivePickerState({
    isPending: search.isPending,
    isError: search.isError,
    result: search.first,
    itemCount: items.length,
    narrowed,
  })

  return {
    text,
    setText,
    query,
    facets,
    toggleFacet: (key, value) => setFacets((f) => toggleFacet(f, key, value)),
    openFacet,
    setOpenFacet,
    showIncompatible,
    setShowIncompatible,
    first: search.first,
    items,
    sections,
    state,
    isFetchingNextPage: search.isFetchingNextPage,
    fetchNextPage: search.fetchNextPage,
    refetch: search.refetch,
    clear: () => {
      setText('')
      setFacets(NO_FACETS)
      setOpenFacet(null)
    },
  }
}
