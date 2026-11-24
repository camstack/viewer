/**
 * The drawer's device and integration results: one `deviceManager.search` on the
 * debounced text. Integrations come from the facets of that same answer. A
 * failed read is not shown as "nothing found" — the caller gets `failed`.
 */
import { useMemo } from 'react'

import { useDebouncedValue, useDeviceValueSearch, SEARCH_DEBOUNCE_MS } from '../components/device-value-picker/use-device-search.js'
import type { SearchDevice, SearchIntegration } from '../apps/app-search.js'

export interface DrawerSearchData {
  readonly devices: readonly SearchDevice[]
  readonly integrations: readonly SearchIntegration[]
  readonly pending: boolean
  readonly failed: boolean
  /** The text the hub was actually asked about (trails the keystrokes). */
  readonly settledQuery: string
}

export function useDrawerSearch(query: string, enabled: boolean): DrawerSearchData {
  const text = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS)
  const active = enabled && text !== ''
  const search = useDeviceValueSearch({ text, includeIncompatible: true }, active)
  const { items, first } = search
  const devices = useMemo<readonly SearchDevice[]>(
    () => items.map((d) => ({ id: d.id, name: d.name, location: d.location, integrationLabel: d.integrationLabel })),
    [items],
  )
  const integrations = useMemo<readonly SearchIntegration[]>(
    () => (first?.facets.integrations ?? []).map((f) => ({ id: f.id, label: f.label, count: f.count })),
    [first],
  )
  return { devices, integrations, pending: active && search.isPending, failed: active && search.isError, settledQuery: text }
}
