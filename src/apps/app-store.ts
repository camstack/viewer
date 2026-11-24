/**
 * app-store — which app is on screen, the last one used and what to open at
 * launch.
 *
 * The last app and the launch preference are DEVICE settings (they describe
 * this install's habits, not the account), written under one key. What is on
 * screen right now lives in memory only.
 */
import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from '../lib/logger.js'
import {
  DEFAULT_APP,
  DEFAULT_LAUNCH_PREFERENCE,
  parseAppId,
  parseLaunchPreference,
  type AppId,
  type LaunchPreference,
} from './app-launch.js'

export const APP_SWITCHER_STORAGE_KEY = '@camstack/v2/app-switcher'

/** What fills the screen: one app (`null` = the app the shell hosts itself). */
export interface ActiveApp {
  readonly appId: AppId
}

export interface PersistedAppSwitcher {
  readonly lastApp: AppId
  readonly launchPreference: LaunchPreference
}

export const APP_SWITCHER_DEFAULTS: PersistedAppSwitcher = Object.freeze({
  lastApp: DEFAULT_APP,
  launchPreference: DEFAULT_LAUNCH_PREFERENCE,
})

/** Parse the persisted JSON field by field. Never throws. */
export function parseAppSwitcher(raw: string | null): PersistedAppSwitcher {
  if (!raw) return APP_SWITCHER_DEFAULTS
  try {
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null) return APP_SWITCHER_DEFAULTS
    return {
      lastApp: parseAppId('lastApp' in data ? data.lastApp : undefined),
      launchPreference: parseLaunchPreference('launchPreference' in data ? data.launchPreference : undefined),
    }
  } catch {
    return APP_SWITCHER_DEFAULTS
  }
}

function persist(doc: PersistedAppSwitcher): void {
  void AsyncStorage.setItem(APP_SWITCHER_STORAGE_KEY, JSON.stringify(doc)).catch((e: unknown) => {
    log.error('apps', 'app-switcher persist failed', { error: e instanceof Error ? e.message : String(e) })
  })
}

interface AppSwitcherState extends PersistedAppSwitcher {
  readonly hydrated: boolean
  /** The app on screen. The hosted one until the launch resolution is spent. */
  readonly active: ActiveApp
  /** A path the next embedded app should open on (a search result), spent once it says `ready`. */
  readonly entryPath: string | null
  /** True once the launch resolution decided what opens first. */
  readonly launchSettled: boolean
  readonly drawerOpen: boolean
  /** The drawer was opened from the top bar's search field: its search takes focus. */
  readonly drawerSearchFocus: boolean
  /** The account sheet (avatar): account, saved servers, "open at launch". */
  readonly accountOpen: boolean
  /** The path the embedded app last reported, to tick its nav item. */
  readonly framePath: string | null
  hydrate: () => Promise<void>
  /** Show an app; it becomes the one remembered. */
  open: (app: ActiveApp, entryPath?: string) => void
  /** Spend the launch resolution once (does not touch the remembered app). */
  settleLaunch: (app: AppId) => void
  setLaunchPreference: (preference: LaunchPreference) => void
  setDrawerOpen: (open: boolean) => void
  /** Open the drawer with its search focused (the wide top bar's search field). */
  openDrawerSearch: () => void
  setAccountOpen: (open: boolean) => void
  setFramePath: (path: string | null) => void
  /** The embedded app took the path it was asked to open on. */
  clearEntryPath: () => void
  /**
   * Sign-out / server switch: leave the embedded app, close the drawer and
   * let the next session resolve its own launch app. The remembered app and the
   * launch preference are this device's and stay.
   */
  resetSession: () => void
}

export const useAppStore = create<AppSwitcherState>((set, get) => ({
  ...APP_SWITCHER_DEFAULTS,
  hydrated: false,
  active: { appId: DEFAULT_APP },
  entryPath: null,
  launchSettled: false,
  drawerOpen: false,
  drawerSearchFocus: false,
  accountOpen: false,
  framePath: null,
  hydrate: async () => {
    if (get().hydrated) return
    let raw: string | null = null
    try {
      raw = await AsyncStorage.getItem(APP_SWITCHER_STORAGE_KEY)
    } catch (e) {
      log.error('apps', 'app-switcher read failed', { error: e instanceof Error ? e.message : String(e) })
    }
    set({ ...parseAppSwitcher(raw), hydrated: true })
  },
  open: (app, entryPath) => {
    set({ active: app, lastApp: app.appId, drawerOpen: false, entryPath: entryPath ?? null, framePath: null })
    persist({ lastApp: app.appId, launchPreference: get().launchPreference })
  },
  settleLaunch: (app) => {
    if (get().launchSettled) return
    set({ active: { appId: app }, launchSettled: true })
  },
  setLaunchPreference: (launchPreference) => {
    set({ launchPreference })
    persist({ lastApp: get().lastApp, launchPreference })
  },
  setDrawerOpen: (drawerOpen) => set({ drawerOpen, drawerSearchFocus: false }),
  openDrawerSearch: () => set({ drawerOpen: true, drawerSearchFocus: true }),
  setAccountOpen: (accountOpen) => set({ accountOpen }),
  setFramePath: (framePath) => set({ framePath }),
  clearEntryPath: () => set({ entryPath: null }),
  resetSession: () =>
    set({ active: { appId: DEFAULT_APP }, entryPath: null, framePath: null, launchSettled: false, drawerOpen: false, drawerSearchFocus: false, accountOpen: false }),
}))
