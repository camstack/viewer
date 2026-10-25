/**
 * The account SECTIONS: which viewer store contributes what to which account
 * namespace, and how each is read, applied and found in another hub's cache.
 *
 *   viewer.app      settings (account half) · language · reelFilter ·
 *                   reelHighlight · devicePickerGroupBy · eventsView
 *   viewer.cameras  prefs (names, hidden, order, highlight, overlay,
 *                   clip / recording source, accessories)
 *   viewer.grids    grids (definitions; the layout is per device)
 *
 * Every value an account section applies goes through the store's own parser:
 * what arrives from the account is untrusted until then.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AccountNamespace } from './account-settings-port.js'
import type { AccountSection } from './account-settings-sync.js'
import { scopedStorageKey, useServerScopeStore } from '../store/server-scope.js'
import { SETTINGS_ACCOUNT_STORAGE_KEY, useSettingsStore } from '../store/settings-store.js'
import { pickSettingsLevel } from '../store/settings-levels.js'
import {
  LANGUAGE_STORAGE_KEY,
  parseLanguagePreference,
  useLanguageStore,
} from '../store/language-store.js'
import { REEL_DEFAULTS, REEL_FILTER_STORAGE_KEY, useReelFilterStore } from '../store/reel-filter-store.js'
import { REEL_HIGHLIGHT_STORAGE_KEY, useReelHighlightStore } from '../store/reel-highlight-store.js'
import { REEL_HIGHLIGHT_DEFAULTS } from '../store/reel-highlight.js'
import { DEVICE_PICKER_GROUP_KEY, useDevicePickerGroupStore } from '../store/device-picker-group-store.js'
import { PICKER_DEFAULT_GROUP_BY } from '../components/notifications/device-picker-model.js'
import {
  DEFAULTS as EVENTS_DEFAULTS,
  EVENTS_FILTER_STORAGE_KEY,
  eventsViewPrefsOf,
  useEventsFilterStore,
} from '../store/events-filter-store.js'
import { CAMERA_PREFS_STORAGE_KEY, useCameraPrefsStore } from '../store/camera-prefs-store.js'
import { accountGridsOf, useGridStore } from '../store/grid-store.js'

/** The slice of a zustand store a section needs. */
interface StoreLike<S> {
  getState(): S
  subscribe(listener: (state: S, previous: S) => void): () => void
}

interface SectionSpec<S> {
  readonly namespace: AccountNamespace
  readonly name: string
  readonly store: StoreLike<S>
  /** The slice whose identity changes on every edit (cheap change test). */
  readonly slice: (state: S) => unknown
  readonly scope: (state: S) => string | null
  readonly read: (state: S) => unknown
  readonly apply: (value: unknown) => void
  readonly readCached: (serverId: string) => Promise<unknown>
}

function section<S>(spec: SectionSpec<S>): AccountSection {
  return {
    namespace: spec.namespace,
    name: spec.name,
    scope: () => spec.scope(spec.store.getState()),
    read: () => spec.read(spec.store.getState()),
    apply: spec.apply,
    readCached: spec.readCached,
    subscribe: (listener) =>
      spec.store.subscribe((state, previous) => {
        if (spec.slice(state) !== spec.slice(previous) || spec.scope(state) !== spec.scope(previous)) listener()
      }),
  }
}

/** A stored JSON document of one hub, or `fallback` when it has none. */
async function cachedJson(base: string, serverId: string, fallback: unknown): Promise<unknown> {
  const raw = await AsyncStorage.getItem(scopedStorageKey(base, serverId))
  if (raw === null) return fallback
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed
  } catch {
    return fallback
  }
}

export function buildAccountSections(): readonly AccountSection[] {
  return [
    section({
      namespace: 'viewer.app',
      name: 'settings',
      store: useSettingsStore,
      slice: (s) => s.settings,
      scope: (s) => (s.hydrated ? s.accountServerId : null),
      read: (s) => pickSettingsLevel(s.settings, 'account'),
      apply: (v) => useSettingsStore.getState().applyAccount(v),
      readCached: (id) => cachedJson(SETTINGS_ACCOUNT_STORAGE_KEY, id, {}),
    }),
    section({
      namespace: 'viewer.app',
      name: 'language',
      store: useLanguageStore,
      slice: (s) => s.preference,
      scope: (s) => (s.hydrated ? s.serverId : null),
      read: (s) => s.preference,
      apply: (v) => useLanguageStore.getState().setPreference(parseLanguagePreference(v)),
      readCached: async (id) =>
        parseLanguagePreference(await AsyncStorage.getItem(scopedStorageKey(LANGUAGE_STORAGE_KEY, id))),
    }),
    section({
      namespace: 'viewer.app',
      name: 'reelFilter',
      store: useReelFilterStore,
      slice: (s) => s.filter,
      scope: (s) => (s.hydrated ? s.serverId : null),
      read: (s) => s.filter,
      apply: (v) => useReelFilterStore.getState().applyAccount(v),
      readCached: (id) => cachedJson(REEL_FILTER_STORAGE_KEY, id, REEL_DEFAULTS),
    }),
    section({
      namespace: 'viewer.app',
      name: 'reelHighlight',
      store: useReelHighlightStore,
      slice: (s) => s.highlight,
      scope: (s) => (s.hydrated ? s.serverId : null),
      read: (s) => s.highlight,
      apply: (v) => useReelHighlightStore.getState().applyAccount(v),
      readCached: (id) => cachedJson(REEL_HIGHLIGHT_STORAGE_KEY, id, REEL_HIGHLIGHT_DEFAULTS),
    }),
    section({
      namespace: 'viewer.app',
      name: 'devicePickerGroupBy',
      store: useDevicePickerGroupStore,
      slice: (s) => s.groupBy,
      scope: (s) => (s.hydrated ? s.serverId : null),
      read: (s) => s.groupBy,
      apply: (v) => useDevicePickerGroupStore.getState().applyAccount(v),
      readCached: async (id) =>
        (await AsyncStorage.getItem(scopedStorageKey(DEVICE_PICKER_GROUP_KEY, id))) ?? PICKER_DEFAULT_GROUP_BY,
    }),
    section({
      namespace: 'viewer.app',
      name: 'eventsView',
      store: useEventsFilterStore,
      slice: (s) => s.filter.showStationary,
      scope: (s) => (s.hydrated ? s.serverId : null),
      read: (s) => eventsViewPrefsOf(s.filter),
      apply: (v) => useEventsFilterStore.getState().applyAccount(v),
      readCached: (id) => cachedJson(EVENTS_FILTER_STORAGE_KEY, id, eventsViewPrefsOf(EVENTS_DEFAULTS)),
    }),
    section({
      namespace: 'viewer.cameras',
      name: 'prefs',
      store: useCameraPrefsStore,
      slice: (s) => s.prefs,
      scope: (s) => (s.hydrated ? s.serverId : null),
      read: (s) => s.prefs,
      apply: (v) => useCameraPrefsStore.getState().applyAccount(v),
      readCached: (id) => cachedJson(CAMERA_PREFS_STORAGE_KEY, id, { byId: {}, order: [] }),
    }),
    section({
      namespace: 'viewer.grids',
      name: 'grids',
      store: useGridStore,
      slice: (s) => s.grids,
      // The list holds every hub's grids; it is this hub's once it has loaded
      // and the hub is bound (the bind waits for the grids to be stamped).
      scope: (s) => (s.hydrated ? useServerScopeStore.getState().serverId : null),
      read: (s) => {
        const id = useServerScopeStore.getState().serverId
        return id === null ? [] : accountGridsOf(s.grids, id)
      },
      apply: (v) => {
        const id = useServerScopeStore.getState().serverId
        if (id !== null) useGridStore.getState().applyAccountGrids(id, v)
      },
      // Every hub's grids are in memory; a copied id that collides with
      // another hub's grid is suffixed on apply (`replaceServerGridsEntry`).
      readCached: async (id) => accountGridsOf(useGridStore.getState().grids, id),
    }),
  ]
}
