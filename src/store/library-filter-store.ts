/**
 * library-filter-store — the remembered filter bars of the Library pages
 * (Media, People, Plates, Retrain), DEVICE level, one document per section per
 * hub (`library-filters.ts` says what each remembers and why the day does not).
 * Events keeps its own store (`events-filter-store`), which writes its device
 * half the same way.
 *
 * The store holds each section's last value IN MEMORY, so a page that remounts
 * in the same session opens on it with no storage round trip; storage carries
 * it across a restart. A hub switch reloads every section from that hub's copy.
 * Unreadable storage is "nothing remembered", never a throw.
 */
import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { onServerScopeChange, scopedStorageKey, whenServerScoped } from './server-scope.js'
import { LIBRARY_FILTER_SECTIONS, LIBRARY_FILTER_STORAGE_KEYS, type LibraryFilterSection } from './library-filters.js'

type Remembered = Readonly<Partial<Record<LibraryFilterSection, unknown>>>

interface LibraryFilterState {
  /** Each section's stored value, unparsed (each page parses its own). */
  readonly values: Remembered
  readonly hydrated: boolean
  /** The hub `values` belong to; `null` before the first load. */
  readonly serverId: string | null
  hydrate: () => Promise<void>
  /** Remember `value` for `section` (in memory and on this device). */
  write: (section: LibraryFilterSection, value: unknown) => void
  /** Forget `section` — the page opens on its defaults next time. */
  clear: (section: LibraryFilterSection) => void
}

function parseJson(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

async function readAll(serverId: string): Promise<Remembered> {
  const entries = await Promise.all(
    LIBRARY_FILTER_SECTIONS.map(async (section) => {
      const raw = await AsyncStorage.getItem(scopedStorageKey(LIBRARY_FILTER_STORAGE_KEYS[section], serverId)).catch(
        () => null,
      )
      return [section, parseJson(raw)] as const
    }),
  )
  const values: Partial<Record<LibraryFilterSection, unknown>> = {}
  for (const [section, value] of entries) if (value !== undefined) values[section] = value
  return values
}

export const useLibraryFilterStore = create<LibraryFilterState>((set, get) => ({
  values: {},
  hydrated: false,
  serverId: null,
  hydrate: async () => {
    if (get().hydrated) return
    const serverId = await whenServerScoped()
    if (get().hydrated) return
    const stored = await readAll(serverId)
    if (get().hydrated) return
    // An edit made before storage answered wins over the stored copy.
    set({ values: { ...stored, ...get().values }, serverId, hydrated: true })
  },
  write: (section, value) => {
    set({ values: { ...get().values, [section]: value } })
    const { serverId } = get()
    if (serverId === null) return
    void AsyncStorage.setItem(
      scopedStorageKey(LIBRARY_FILTER_STORAGE_KEYS[section], serverId),
      JSON.stringify(value),
    ).catch(() => {})
  },
  clear: (section) => {
    const values = { ...get().values }
    delete values[section]
    set({ values })
    const { serverId } = get()
    if (serverId === null) return
    void AsyncStorage.removeItem(scopedStorageKey(LIBRARY_FILTER_STORAGE_KEYS[section], serverId)).catch(() => {})
  },
}))

// Another hub's camera ids mean nothing here: a switch swaps every section.
onServerScopeChange((serverId) => {
  void readAll(serverId).then((values) => useLibraryFilterStore.setState({ values, serverId, hydrated: true }))
})
