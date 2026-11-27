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
  type LastAppByServer,
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
  /** The last app used on each server, by server id (a switch reopens it). */
  readonly lastAppByServer: LastAppByServer
}

export const APP_SWITCHER_DEFAULTS: PersistedAppSwitcher = Object.freeze({
  lastApp: DEFAULT_APP,
  launchPreference: DEFAULT_LAUNCH_PREFERENCE,
  lastAppByServer: Object.freeze({}),
})

function parseLastAppByServer(raw: unknown): LastAppByServer {
  if (typeof raw !== 'object' || raw === null) return APP_SWITCHER_DEFAULTS.lastAppByServer
  const out: Record<string, AppId> = {}
  for (const [serverId, value] of Object.entries(raw)) out[serverId] = parseAppId(value)
  return out
}

/** Parse the persisted JSON field by field. Never throws. */
export function parseAppSwitcher(raw: string | null): PersistedAppSwitcher {
  if (!raw) return APP_SWITCHER_DEFAULTS
  try {
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null) return APP_SWITCHER_DEFAULTS
    return {
      lastApp: parseAppId('lastApp' in data ? data.lastApp : undefined),
      launchPreference: parseLaunchPreference('launchPreference' in data ? data.launchPreference : undefined),
      lastAppByServer: parseLastAppByServer('lastAppByServer' in data ? data.lastAppByServer : undefined),
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
  /** The saved server this session talks to; `open` files the app under it. */
  readonly serverId: string | null
  /** Set by a server switch: the app that was on screen, which the new server keeps when it offers it. */
  readonly carried: { readonly appId: AppId } | null
  readonly drawerOpen: boolean
  /** The server being switched to, while `switchServer` runs: a full-page loader names it. */
  readonly serverSwitch: { readonly name: string } | null
  /** The drawer was opened from the top bar's search field: its search takes focus. */
  readonly drawerSearchFocus: boolean
  /** The path the embedded app last reported, to tick its nav item. */
  readonly framePath: string | null
  hydrate: () => Promise<void>
  /** Show an app; it becomes the one remembered. */
  open: (app: ActiveApp, entryPath?: string) => void
  /** Spend the launch resolution once (does not touch the remembered app). */
  settleLaunch: (app: AppId) => void
  setLaunchPreference: (preference: LaunchPreference) => void
  /** The session's server became known (first connect). Not a switch. */
  setServerId: (serverId: string | null) => void
  /**
   * The session moved to another server: remember the app that was on screen under
   * the old one, carry it to the new one, and let the launch resolution pick.
   */
  switchServer: (toServerId: string) => void
  setDrawerOpen: (open: boolean) => void
  setServerSwitch: (target: { readonly name: string } | null) => void
  /** Open the drawer with its search focused (the wide top bar's search field). */
  openDrawerSearch: () => void
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
  serverId: null,
  carried: null,
  drawerOpen: false,
  serverSwitch: null,
  drawerSearchFocus: false,
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
    const { serverId, lastAppByServer, launchPreference } = get()
    const byServer = serverId === null ? lastAppByServer : { ...lastAppByServer, [serverId]: app.appId }
    set({ active: app, lastApp: app.appId, lastAppByServer: byServer, drawerOpen: false, entryPath: entryPath ?? null, framePath: null })
    persist({ lastApp: app.appId, launchPreference, lastAppByServer: byServer })
  },
  settleLaunch: (app) => {
    if (get().launchSettled) return
    set({ active: { appId: app }, launchSettled: true, carried: null })
  },
  setLaunchPreference: (launchPreference) => {
    set({ launchPreference })
    persist({ lastApp: get().lastApp, launchPreference, lastAppByServer: get().lastAppByServer })
  },
  setServerId: (serverId) => set({ serverId }),
  switchServer: (toServerId) => {
    const { serverId, active, lastApp, launchPreference, lastAppByServer } = get()
    const byServer = serverId === null ? lastAppByServer : { ...lastAppByServer, [serverId]: active.appId }
    set({
      serverId: toServerId,
      lastAppByServer: byServer,
      carried: { appId: active.appId },
      active: { appId: DEFAULT_APP },
      entryPath: null,
      framePath: null,
      launchSettled: false,
      drawerOpen: false,
      drawerSearchFocus: false,
    })
    persist({ lastApp, launchPreference, lastAppByServer: byServer })
  },
  setDrawerOpen: (drawerOpen) => set({ drawerOpen, drawerSearchFocus: false }),
  setServerSwitch: (serverSwitch) => set({ serverSwitch }),
  openDrawerSearch: () => set({ drawerOpen: true, drawerSearchFocus: true }),
  setFramePath: (framePath) => set({ framePath }),
  clearEntryPath: () => set({ entryPath: null }),
  resetSession: () =>
    set({ active: { appId: DEFAULT_APP }, entryPath: null, framePath: null, launchSettled: false, carried: null, drawerOpen: false, drawerSearchFocus: false }),
}))
