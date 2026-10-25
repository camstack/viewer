/**
 * reel-highlight-store — the tablet camera REEL's highlight settings, persisted.
 *
 * One object for the whole reel. The scope argument, the rejected homes and the
 * default's reasoning are all in `reel-highlight.ts`; this is only the store.
 *
 * A dedicated store, the way `reel-filter-store.ts` is one for the same reel's
 * filter: small, one field, its own storage key. `settings-store` would have
 * been the better neighbour and cannot be (it is imported BY `grid-store`, so
 * taking `GridHighlightSettings` into it closes a cycle).
 *
 * Stored as a PARTIAL and read through `withHighlightDefaults`, which is the
 * forward-compat path the shared shape already has: a field added to
 * `GridHighlightSettings` next release is filled from the defaults for every
 * install that persisted before it existed, instead of arriving `undefined` in
 * a component.
 */
import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { onServerScopeChange, scopedStorageKey, whenServerScoped } from './server-scope.js'
import {
  withHighlightDefaults,
  type GridHighlightSettings,
} from './grid-store.js'
import { REEL_HIGHLIGHT_DEFAULTS } from './reel-highlight.js'

/** Base key; an ACCOUNT setting, so one cached copy per hub
 *  (`scopedStorageKey`), synced by `account/account-settings-sync.ts`. */
export const REEL_HIGHLIGHT_STORAGE_KEY = 'camstack.v2.reel-highlight'

/**
 * Merge a stored blob onto the REEL's defaults.
 *
 * Note which defaults: `REEL_HIGHLIGHT_DEFAULTS`, not the grid's. An install
 * that has never opened the editor must get motion+audio, and an install that
 * stored only `{ detection: true }` must keep motion+audio too — so the base is
 * the reel's and `withHighlightDefaults` fills anything the reel's own object
 * would also be missing.
 */
export function parseReelHighlight(raw: unknown): GridHighlightSettings {
  if (typeof raw !== 'object' || raw === null) return REEL_HIGHLIGHT_DEFAULTS
  const stored: Partial<GridHighlightSettings> = raw
  return withHighlightDefaults({ ...REEL_HIGHLIGHT_DEFAULTS, ...stored })
}

interface ReelHighlightState {
  readonly highlight: GridHighlightSettings
  readonly hydrated: boolean
  /** The hub `highlight` belongs to; `null` before the first load. */
  readonly serverId: string | null
  hydrate: () => Promise<void>
  setHighlight: (patch: Partial<GridHighlightSettings>) => void
  reset: () => void
  /** Adopt a value from the account (validated here). */
  applyAccount: (raw: unknown) => void
}

function persist(serverId: string | null, highlight: GridHighlightSettings | null): void {
  if (serverId === null) return
  const key = scopedStorageKey(REEL_HIGHLIGHT_STORAGE_KEY, serverId)
  const write = highlight === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, JSON.stringify(highlight))
  void write.catch(() => {})
}

async function readScoped(serverId: string): Promise<GridHighlightSettings> {
  try {
    const raw = await AsyncStorage.getItem(scopedStorageKey(REEL_HIGHLIGHT_STORAGE_KEY, serverId))
    return raw ? parseReelHighlight(JSON.parse(raw)) : REEL_HIGHLIGHT_DEFAULTS
  } catch {
    return REEL_HIGHLIGHT_DEFAULTS
  }
}

export const useReelHighlightStore = create<ReelHighlightState>((set, get) => ({
  highlight: REEL_HIGHLIGHT_DEFAULTS,
  hydrated: false,
  serverId: null,
  hydrate: async () => {
    if (get().hydrated) return
    const serverId = await whenServerScoped()
    const highlight = await readScoped(serverId)
    if (get().hydrated) return
    set({ highlight, serverId, hydrated: true })
  },
  setHighlight: (patch) => {
    const highlight: GridHighlightSettings = { ...get().highlight, ...patch }
    set({ highlight })
    persist(get().serverId, highlight)
  },
  reset: () => {
    set({ highlight: REEL_HIGHLIGHT_DEFAULTS })
    persist(get().serverId, null)
  },
  applyAccount: (raw) => {
    const highlight = parseReelHighlight(raw)
    set({ highlight })
    persist(get().serverId, highlight)
  },
}))

onServerScopeChange((serverId) => {
  void readScoped(serverId).then((highlight) => useReelHighlightStore.setState({ highlight, serverId, hydrated: true }))
})
