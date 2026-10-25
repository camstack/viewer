/**
 * reel-filter-store — what the Recent-events reel on the Cameras screen shows.
 *
 * A SECOND filter store, deliberately. The reel and the events page are
 * different scopes: a 24 h strip above the camera grid is a glance, the events
 * page is an investigation, and narrowing one has nothing to say about the
 * other. They share their SHAPE through `track-filter.ts` — the ABSENT /
 * EMPTY discipline, the toggle reducer, the source derivation — and share no
 * value at all. (The third, `camera-local-store.timelineClasses`, is per-camera
 * and keyed by device; it is the same idea at a third scope.)
 *
 * ## One field, three answers
 *
 * `classes` is the whole state, and its three readings are the design:
 *
 *  - `null`  — the DEFAULT preset: the macro tier of the detection category,
 *    resolved from the live taxonomy on every read (see
 *    {@link resolveReelClasses}). Never frozen into storage.
 *  - `[]`    — the operator cleared the filter: show everything, and KEEP
 *    showing everything after a restart.
 *  - a list  — an explicit selection.
 *
 * Storing the default as `null` rather than as the list it resolves to is what
 * keeps the taxonomy the single source of truth. Materialising `['person',
 * 'vehicle','animal']` at first launch would freeze today's vocabulary into
 * every install: a detection macro the hub learns next year would be missing
 * from the default forever, silently, and nobody would ever look.
 *
 * ## Why the default is the detection macros
 *
 * Because it is the tier a glance is FOR, and because it leaves the synthetic
 * projections out by construction — `audio` is its own taxonomy category and
 * `sensor`/`control` are theirs, so no second mechanism hides them. The strip
 * says so: the reel caption and the fan-menu action both carry the condition,
 * because a strip that is quietly shorter than reality is the failure this
 * whole change set exists to remove.
 */
import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { onServerScopeChange, scopedStorageKey, whenServerScoped } from './server-scope.js'
import type { EventsTrackSource } from '../../shared/events/events-share-url.js'
import type { EventKindDescriptor } from '../data/event-kinds.js'
import {
  type FilterPreset,
  filterStrings,
  isFilterRecord,
  resolveFilterClasses,
  resolveFilterExcludeSources,
  toggleMember,
} from './track-filter.js'

/**
 * The strip is a GLANCE, so its preset is the macro tier — a tighter default
 * than the events page's `all-but-audio`. Two scopes, two presets, ONE
 * resolver: the routing from a ticked node to the dimension that can select it
 * is `track-filter.ts`'s and neither store owns a copy of it.
 */
const REEL_PRESET: FilterPreset = 'detection-macros'

/** Base key; an ACCOUNT setting, so one cached copy per hub
 *  (`scopedStorageKey`), synced by `account/account-settings-sync.ts`. */
export const REEL_FILTER_STORAGE_KEY = 'camstack.v2.reel-filter'

export interface ReelFilter {
  /** Taxonomy kinds to KEEP. `null` = the default preset. `[]` = everything.
   *  See the module docblock — the three readings are not interchangeable. */
  readonly classes: readonly string[] | null
}

export const REEL_DEFAULTS: ReelFilter = Object.freeze({ classes: null })

// ── Pure reducers / resolution ───────────────────────────────────────────────

/**
 * Parse a stored blob. Absent and malformed both give the DEFAULT preset; a
 * well-formed array (empty included) is the operator's own choice.
 */
export function parseReelFilter(raw: unknown): ReelFilter {
  if (!isFilterRecord(raw)) return REEL_DEFAULTS
  const stored = raw['classes']
  if (!Array.isArray(stored)) return REEL_DEFAULTS
  return { classes: filterStrings(stored) }
}

/**
 * The kinds the reel actually asks for, resolving the default preset against
 * the taxonomy that is loaded right now.
 *
 * `[]` here always means "no class narrowing", whether that is the operator's
 * explicit choice or a taxonomy that has not answered. Those are different
 * facts, and the surface must not confuse them — but the REQUEST is the same
 * either way, because a filter built from a taxonomy nobody has read would
 * narrow by a name no row carries (D315). The source exclusion below still
 * applies, so the default is never wholly inert while the taxonomy loads.
 */
export function resolveReelClasses(
  filter: ReelFilter,
  descriptors: readonly EventKindDescriptor[] | undefined,
): readonly string[] {
  return resolveFilterClasses(filter.classes, REEL_PRESET, descriptors)
}

/**
 * The track SOURCES the reel hides — derived, never stored.
 *
 * The default preset gets `['audio','sensor']` WITHOUT waiting for the
 * taxonomy: "the detection macros" cannot contain an audio or a sensor kind
 * whatever the vocabulary turns out to be, so the one part of the default that
 * needs no lookup is applied immediately. Otherwise the strip would show a
 * second of unfiltered audio markers on every cold launch — the flash of the
 * thing the operator asked to hide.
 */
export function resolveReelExcludeSources(
  filter: ReelFilter,
  descriptors: readonly EventKindDescriptor[] | undefined,
): readonly EventsTrackSource[] {
  return resolveFilterExcludeSources(filter.classes, REEL_PRESET, descriptors)
}

/**
 * How to describe the reel's state in one word next to the strip.
 *
 * `default` is reported as NARROWED, not as "all": it hides audio and sensor
 * markers, and an operator who is not told that is left wondering where an
 * event went with nothing to ask.
 */
export type ReelFilterCondition =
  | { readonly kind: 'all' }
  | { readonly kind: 'default' }
  | { readonly kind: 'selection'; readonly count: number }

export function reelFilterCondition(filter: ReelFilter): ReelFilterCondition {
  if (filter.classes === null) return { kind: 'default' }
  if (filter.classes.length === 0) return { kind: 'all' }
  return { kind: 'selection', count: filter.classes.length }
}

// ── Store ───────────────────────────────────────────────────────────────────

interface ReelFilterState {
  readonly filter: ReelFilter
  readonly hydrated: boolean
  /** The hub `filter` belongs to; `null` before the first load. */
  readonly serverId: string | null
  hydrate: () => Promise<void>
  toggleClass: (kind: string, resolved: readonly string[]) => void
  showAll: () => void
  useDefault: () => void
  /** Adopt a value from the account (validated here). */
  applyAccount: (raw: unknown) => void
}

/** The default is written as an ABSENT document, so the next read re-resolves
 *  the preset against whatever the taxonomy says then. */
function persist(serverId: string | null, filter: ReelFilter): void {
  if (serverId === null) return
  const key = scopedStorageKey(REEL_FILTER_STORAGE_KEY, serverId)
  const write = filter.classes === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, JSON.stringify(filter))
  void write.catch(() => {})
}

async function readScoped(serverId: string): Promise<ReelFilter> {
  try {
    const raw = await AsyncStorage.getItem(scopedStorageKey(REEL_FILTER_STORAGE_KEY, serverId))
    return raw ? parseReelFilter(JSON.parse(raw)) : REEL_DEFAULTS
  } catch {
    return REEL_DEFAULTS
  }
}

export const useReelFilterStore = create<ReelFilterState>((set, get) => {
  const commit = (filter: ReelFilter): void => {
    set({ filter })
    persist(get().serverId, filter)
  }
  return {
    filter: REEL_DEFAULTS,
    hydrated: false,
    serverId: null,
    hydrate: async () => {
      if (get().hydrated) return
      const serverId = await whenServerScoped()
      const filter = await readScoped(serverId)
      if (get().hydrated) return
      set({ filter, serverId, hydrated: true })
    },
    toggleClass: (kind, resolved) => {
      const base = get().filter.classes ?? resolved
      commit({ classes: toggleMember(base, kind) })
    },
    showAll: () => commit({ classes: [] }),
    useDefault: () => commit(REEL_DEFAULTS),
    applyAccount: (raw) => commit(parseReelFilter(raw)),
  }
})

onServerScopeChange((serverId) => {
  void readScoped(serverId).then((filter) => useReelFilterStore.setState({ filter, serverId, hydrated: true }))
})
