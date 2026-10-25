/**
 * events-filter-store — filter state for the (track-centric) Events page,
 * thin zustand glue over an immutable value.
 *
 * Three levels in one object (declared in {@link EVENTS_FILTER_LEVELS}):
 * whether the page shows parked rows is an ACCOUNT setting (operator decision
 * 2026-10-21), cached per hub under `camstack.v2.events-filter@<serverId>` and
 * synced; what the filter bar narrows to (cameras, classes, attributes, the
 * marks) is a DEVICE setting (operator, 2026-10-23: "the Library filters
 * persist on the device"), stored per hub under
 * `camstack.v2.library-filter.events@<serverId>` and never synced; the label
 * text lives in MEMORY only. A remembered camera the hub no longer has is
 * dropped ({@link EventsFilterState.pruneCameras}).
 *
 *   • cameraIds — selected camera ids; EMPTY = all cameras.
 *   • classes   — ticked taxonomy nodes. NULL = the default preset, EMPTY =
 *                 no narrowing, a list = an explicit selection. It drives the
 *                 class filter AND the source filter — see the field.
 *   • attributes— per-track attribute chips (`face` / `plate`); EMPTY = all.
 *   • label     — free-text label/identity filter (client-side contains).
 *
 * `date` is intentionally NOT persisted (a day is a question about that day);
 * it lives in screen state and every visit opens on today. Unknown/corrupt storage degrades to DEFAULTS field-by-field. The
 * grouped-feed-only facets (grouping window, only-with-clips) were retired with
 * the classic feed — a stored blob that still carries them parses fine (ignored).
 */
import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { onServerScopeChange, scopedStorageKey, whenServerScoped } from './server-scope.js'
import {
  type EventsAttribute,
  type EventsTrackSource,
  isEventsAttribute,
} from '../../shared/events/events-share-url.js'
// The SHAPE is shared with the reel's filter (`reel-filter-store`) and the
// per-camera timeline's; the VALUE is not. See `track-filter.ts` — three
// scopes, one idea of what a filter is, and ONE routing from a ticked
// taxonomy node to the dimension that can actually select it.
import {
  type FilterPreset,
  isFilterRecord,
  resolveFilterClasses,
  resolveFilterExcludeSources,
  toggleMember,
} from './track-filter.js'
import type { EventKindDescriptor } from '../data/event-kinds.js'

/**
 * The events page is an INVESTIGATION surface, so its preset hides only what
 * was reported as noise: everything the hub advertises except the audio nodes.
 * A door opening is an event the operator asked to see, which is why `sensor`
 * is not in it. (The Recent strip's preset is tighter — see
 * `reel-filter-store`; two scopes, two presets, one resolver.)
 */
export const EVENTS_PRESET: FilterPreset = 'all-but-audio'

// ── Domain types ──────────────────────────────────────────────────────────────

export interface EventsFilter {
  readonly cameraIds: readonly number[]
  /**
   * Ticked taxonomy nodes — the ONE control, driving BOTH dimensions.
   *
   * The tree already offers Motion, Audio, Person, Vehicle, Animal, Package,
   * Control and Sensor. Underneath, a pipeline node rides `classes` on the
   * query and a synthetic one (Audio / Sensor / Control) rides
   * `excludeSources`, because those rows carry no class the hub can filter on.
   * The split is `nodeDrivesSource`, decided by the node's own taxonomy
   * category — see `track-filter.ts`. A source row in a second menu was the
   * first attempt and it was two controls for one question.
   *
   * Three readings, and they are the design:
   *
   *  - `null`  — the DEFAULT preset (`all-but-audio`), resolved against the
   *    live taxonomy on every read. In the tree it looks like every row ticked
   *    except Audio, which is exactly what it is.
   *  - `[]`    — the operator unticked everything: no narrowing, show it all,
   *    and KEEP showing it all after a restart.
   *  - a list  — an explicit selection.
   *
   * Stored as `null` and not as the list it resolves to: materialising today's
   * vocabulary would leave a kind the hub learns next year out of the default
   * forever, silently.
   */
  readonly classes: readonly string[] | null
  /**
   * Per-track ATTRIBUTES to keep — Faces / Plates. A second axis, not members
   * of `classes`: the event taxonomy refuses `face`/`plate` as kinds, because a
   * track CARRIES one alongside whatever class it is. Selected attributes OR
   * together and the axis ANDs with the classes, so "vehicles with a plate" is
   * one selection in each.
   */
  readonly attributes: readonly EventsAttribute[]
  readonly label: string
  /** Mark-filter chips. Independent; OR when several are on. */
  readonly filterDebug: boolean
  readonly filterTrain: boolean
  readonly filterFavourited: boolean
  /** Parked (stationary-promoted) rows. Default off — they live on the
   *  registry, not in the passage feed. */
  readonly showStationary: boolean
}

export const DEFAULTS: EventsFilter = Object.freeze({
  cameraIds: [],
  classes: null,
  attributes: [],
  label: '',
  filterDebug: false,
  filterTrain: false,
  filterFavourited: false,
  showStationary: false,
})

/**
 * The ticks the tree renders and the `classes` the query carries — the stored
 * selection, or {@link EVENTS_PRESET} resolved against the taxonomy that has
 * loaded. Both the picker and the chip read this, so they cannot disagree
 * about what is narrowed.
 */
export function resolveEventsClasses(
  stored: readonly string[] | null,
  descriptors: readonly EventKindDescriptor[] | undefined,
): readonly string[] {
  return resolveFilterClasses(stored, EVENTS_PRESET, descriptors)
}

/**
 * The SAME selection in the other dimension: the sources the query must drop,
 * because those rows carry no class the hub can filter on.
 *
 * Derived from the ticks, never stored beside them — a second stored field is
 * a second filter that can disagree with the first. The preset's answer
 * (`['audio']`) needs no taxonomy, so the default is never inert on a cold
 * launch while `listEventKinds` is in flight.
 */
export function resolveEventsExcludeSources(
  stored: readonly string[] | null,
  descriptors: readonly EventKindDescriptor[] | undefined,
): readonly EventsTrackSource[] {
  return resolveFilterExcludeSources(stored, EVENTS_PRESET, descriptors)
}

/** The base key; each hub's filter lives at `<key>@<serverId>`: its camera
 *  ids are that hub's (`server-scope.ts`). */
export const EVENTS_FILTER_STORAGE_KEY = 'camstack.v2.events-filter'

/** The base key of the DEVICE half (the filter bar's narrowing); per hub. */
export const EVENTS_FILTER_DEVICE_STORAGE_KEY = 'camstack.v2.library-filter.events'

export type EventsFilterLevel = 'account' | 'device' | 'ephemeral'

/** Where each field lives. Exhaustive by type: a new field needs a decision. */
export const EVENTS_FILTER_LEVELS: Readonly<Record<keyof EventsFilter, EventsFilterLevel>> = {
  showStationary: 'account',
  cameraIds: 'device',
  classes: 'device',
  attributes: 'device',
  filterDebug: 'device',
  filterTrain: 'device',
  filterFavourited: 'device',
  label: 'ephemeral',
}

/** The DEVICE part of the filter: what the filter bar narrows to. */
export type EventsDeviceFilter = Pick<
  EventsFilter,
  'cameraIds' | 'classes' | 'attributes' | 'filterDebug' | 'filterTrain' | 'filterFavourited'
>

export function eventsDeviceFilterOf(filter: EventsFilter): EventsDeviceFilter {
  return {
    cameraIds: filter.cameraIds,
    classes: filter.classes,
    attributes: filter.attributes,
    filterDebug: filter.filterDebug,
    filterTrain: filter.filterTrain,
    filterFavourited: filter.filterFavourited,
  }
}

/** A stored device half; anything malformed is its default. */
export function parseEventsDeviceFilter(raw: unknown): EventsDeviceFilter {
  return eventsDeviceFilterOf(parseFilter(raw))
}

/**
 * The filter a page opens on: the device half and the account half read from
 * their two documents, the memory-only fields at their defaults. Either
 * document unreadable or absent is that half's defaults.
 */
export function readEventsFilter(accountRaw: string | null, deviceRaw: string | null): EventsFilter {
  return {
    ...DEFAULTS,
    ...parseEventsDeviceFilter(parseJsonOrNull(deviceRaw)),
    ...parseEventsViewPrefs(parseJsonOrNull(accountRaw)),
  }
}

function parseJsonOrNull(raw: string | null): unknown {
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** The camera ids that still exist, or the SAME filter when none was dropped.
 *  `known` undefined (the list has not answered) drops nothing. */
export function pruneEventsCameras(filter: EventsFilter, known: ReadonlySet<number> | undefined): EventsFilter {
  if (known === undefined || filter.cameraIds.every((id) => known.has(id))) return filter
  return { ...filter, cameraIds: filter.cameraIds.filter((id) => known.has(id)) }
}

/** The persisted (account) part of the filter. */
export type EventsViewPrefs = Pick<EventsFilter, 'showStationary'>

/** The account part of a filter, as it is stored and synced. */
export function eventsViewPrefsOf(filter: EventsFilter): EventsViewPrefs {
  return { showStationary: filter.showStationary }
}

/** A stored (or synced) value read as the account part; the rest is default. */
export function parseEventsViewPrefs(raw: unknown): EventsViewPrefs {
  return eventsViewPrefsOf(parseFilter(raw))
}

/**
 * Blob schema version, written from the change that made `classes` nullable.
 *
 * It exists for ONE migration and it is load-bearing. Before it, an operator
 * who had never narrowed anything stored `classes: []` — which now means "the
 * operator asked for everything" and would have kept audio visible on every
 * install that had ever opened the page. Absent-or-older `v` with an EMPTY
 * `classes` is therefore read as never-configured (`null`, the preset); a
 * non-empty one is a real selection and is left exactly as it was, because
 * overriding a narrowing the operator made is worse than a missed default.
 */
const SCHEMA_VERSION = 2

// ── Pure validation / reducers ──────────────────────────────────────────────

function numbers(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** Parse a stored blob into a valid EventsFilter, degrading field-by-field.
 *  Retired facets (groupingRangeSec / onlyWithClips) in old blobs are ignored. */
export function parseFilter(raw: unknown): EventsFilter {
  if (!isFilterRecord(raw)) return DEFAULTS
  // A blob from the single `flaggedOnly` chip becomes all three on, so an
  // operator who had "Flagged" saved does not silently lose the filter. New
  // keys win when present.
  const legacyAll =
    raw['flaggedOnly'] === true &&
    raw['filterDebug'] === undefined &&
    raw['filterTrain'] === undefined &&
    raw['filterFavourited'] === undefined
  const version = typeof raw['v'] === 'number' ? raw['v'] : 1
  const storedClasses = raw['classes']
  return {
    cameraIds: numbers(raw['cameraIds']),
    classes: !Array.isArray(storedClasses)
      ? DEFAULTS.classes
      : // See SCHEMA_VERSION: `[]` in a pre-v2 blob is "never configured", not
        // "show everything" — that reading is only available to a blob written
        // by a build that knew the difference.
        version < SCHEMA_VERSION && storedClasses.length === 0
        ? DEFAULTS.classes
        : strings(storedClasses),
    // A token this build has never heard of is DROPPED, not kept: it would
    // otherwise ride into the embed's config, fail its enum and take the whole
    // patch with it.
    attributes: strings(raw['attributes']).filter(isEventsAttribute),
    label: typeof raw['label'] === 'string' ? raw['label'] : DEFAULTS.label,
    filterDebug: raw['filterDebug'] === true || legacyAll,
    filterTrain: raw['filterTrain'] === true || legacyAll,
    filterFavourited: raw['filterFavourited'] === true || legacyAll,
    showStationary: raw['showStationary'] === true,
  }
}

// ── Store ───────────────────────────────────────────────────────────────────

interface EventsFilterState {
  readonly filter: EventsFilter
  readonly hydrated: boolean
  /** The hub `filter` belongs to; `null` before the first load. */
  readonly serverId: string | null
  hydrate: () => Promise<void>
  toggleCamera: (id: number) => void
  /** Tick / untick one node. `resolved` is the selection the operator is
   *  LOOKING AT, so the first edit on the preset materialises it. */
  toggleClass: (className: string, resolved: readonly string[]) => void
  /** Toggle one attribute chip (Faces / Plates). */
  toggleAttribute: (attribute: EventsAttribute) => void
  /** Replace the whole class/kind selection (used by the hierarchical tree so a
   *  macro toggle can add/remove its subs atomically). */
  setClasses: (classes: readonly string[]) => void
  setLabel: (label: string) => void
  setFilterDebug: (on: boolean) => void
  setFilterTrain: (on: boolean) => void
  setFilterFavourited: (on: boolean) => void
  setShowStationary: (on: boolean) => void
  /** Back to the default preset — stored as ABSENT, re-resolved every read. */
  useDefaultClasses: () => void
  reset: () => void
  /** Drop remembered cameras the hub no longer has (`known` = every camera id
   *  it has; undefined = not answered, nothing dropped). */
  pruneCameras: (known: ReadonlySet<number> | undefined) => void
  /** Adopt the account part (parked rows) from the account sync; the
   *  investigation in memory is kept. */
  applyAccount: (raw: unknown) => void
}

/** Each half to its own document; the label is memory-only. */
function persist(filter: EventsFilter): void {
  const serverId = useEventsFilterStore.getState().serverId
  if (serverId === null) return
  // The version rides each blob, so a later read can tell a `classes: []` this
  // build wrote from one an older build wrote meaning something else.
  void AsyncStorage.setItem(
    scopedStorageKey(EVENTS_FILTER_STORAGE_KEY, serverId),
    JSON.stringify({ ...eventsViewPrefsOf(filter), v: SCHEMA_VERSION }),
  ).catch(() => {})
  void AsyncStorage.setItem(
    scopedStorageKey(EVENTS_FILTER_DEVICE_STORAGE_KEY, serverId),
    JSON.stringify({ ...eventsDeviceFilterOf(filter), v: SCHEMA_VERSION }),
  ).catch(() => {})
}

/** A hub's two stored halves. */
async function loadFilter(serverId: string): Promise<EventsFilter> {
  const [accountRaw, deviceRaw] = await Promise.all([
    AsyncStorage.getItem(scopedStorageKey(EVENTS_FILTER_STORAGE_KEY, serverId)).catch(() => null),
    AsyncStorage.getItem(scopedStorageKey(EVENTS_FILTER_DEVICE_STORAGE_KEY, serverId)).catch(() => null),
  ])
  return readEventsFilter(accountRaw, deviceRaw)
}

export const useEventsFilterStore = create<EventsFilterState>((set, get) => ({
  filter: DEFAULTS,
  hydrated: false,
  serverId: null,
  hydrate: async () => {
    if (get().hydrated) return
    const serverId = await whenServerScoped()
    if (get().hydrated) return
    const filter = await loadFilter(serverId)
    if (get().hydrated) return
    set({ filter, serverId, hydrated: true })
  },
  toggleCamera: (id) => {
    const filter = { ...get().filter, cameraIds: toggleMember(get().filter.cameraIds, id) }
    set({ filter }); persist(filter)
  },
  toggleClass: (className, resolved) => {
    // The base is the RESOLVED selection, so the first tick on the preset
    // materialises it: unticking Audio from "everything but audio" must leave
    // the other kinds ticked, not become a selection of one.
    const base = get().filter.classes ?? resolved
    const filter = { ...get().filter, classes: toggleMember(base, className) }
    set({ filter }); persist(filter)
  },
  toggleAttribute: (attribute) => {
    const filter = { ...get().filter, attributes: toggleMember(get().filter.attributes, attribute) }
    set({ filter }); persist(filter)
  },
  setClasses: (classes) => {
    // Already a whole selection (the tree's macro toggle builds it from the
    // resolved list), so there is nothing to materialise here.
    const filter = { ...get().filter, classes: [...new Set(classes)] }
    set({ filter }); persist(filter)
  },
  useDefaultClasses: () => {
    const filter = { ...get().filter, classes: null }
    set({ filter }); persist(filter)
  },
  setLabel: (label) => {
    const filter = { ...get().filter, label }
    set({ filter }); persist(filter)
  },
  setFilterDebug: (on) => {
    const filter = { ...get().filter, filterDebug: on }
    set({ filter }); persist(filter)
  },
  setFilterTrain: (on) => {
    const filter = { ...get().filter, filterTrain: on }
    set({ filter }); persist(filter)
  },
  setFilterFavourited: (on) => {
    const filter = { ...get().filter, filterFavourited: on }
    set({ filter }); persist(filter)
  },
  setShowStationary: (on) => {
    const filter = { ...get().filter, showStationary: on }
    set({ filter }); persist(filter)
  },
  // Back to the defaults, both halves written as such — parked rows included,
  // as before: Reset has always meant the whole filter.
  reset: () => { set({ filter: DEFAULTS }); persist(DEFAULTS) },
  pruneCameras: (known) => {
    if (!get().hydrated) return
    const filter = pruneEventsCameras(get().filter, known)
    if (filter === get().filter) return
    set({ filter }); persist(filter)
  },
  applyAccount: (raw) => {
    const filter = { ...get().filter, ...parseEventsViewPrefs(raw) }
    set({ filter }); persist(filter)
  },
}))

// A hub switch swaps the filter in ONE set carrying the new `serverId`, so the
// account sync can tell a switch from an edit. Each hub has its own copy of
// both halves: camera ids mean nothing on another hub.
onServerScopeChange((serverId) => {
  void loadFilter(serverId).then((filter) => useEventsFilterStore.setState({ filter, serverId, hydrated: true }))
})
