/**
 * app-store — which app is on screen, the last one used and what to open at
 * launch.
 *
 * The last app and the launch preference are DEVICE settings (they describe
 * this install's habits, not the account), written under one key. What is on
 * screen right now — including a node's UI — lives in memory only: a node is
 * never remembered, never a launch target.
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

/** What fills the screen: an app, or one node's agent UI. */
export type ActiveApp =
  | { readonly kind: 'viewer' }
  | { readonly kind: 'admin' }
  | { readonly kind: 'node'; readonly nodeId: string; readonly nodeName: string }

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
  /** The app on screen. Viewer until the launch resolution is spent. */
  readonly active: ActiveApp
  /** True once the launch resolution decided what opens first. */
  readonly launchSettled: boolean
  readonly drawerOpen: boolean
  hydrate: () => Promise<void>
  /** Show an app; an app (not a node) becomes the one remembered. */
  open: (app: ActiveApp) => void
  /** Spend the launch resolution once (does not touch the remembered app). */
  settleLaunch: (app: AppId) => void
  setLaunchPreference: (preference: LaunchPreference) => void
  setDrawerOpen: (open: boolean) => void
  /**
   * Sign-out / server switch: leave Admin and node UIs, close the drawer and
   * let the next session resolve its own launch app. The remembered app and the
   * launch preference are this device's and stay.
   */
  resetSession: () => void
}

export const useAppStore = create<AppSwitcherState>((set, get) => ({
  ...APP_SWITCHER_DEFAULTS,
  hydrated: false,
  active: { kind: 'viewer' },
  launchSettled: false,
  drawerOpen: false,
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
  open: (app) => {
    if (app.kind === 'node') {
      set({ active: app, drawerOpen: false })
      return
    }
    set({ active: app, lastApp: app.kind, drawerOpen: false })
    persist({ lastApp: app.kind, launchPreference: get().launchPreference })
  },
  settleLaunch: (app) => {
    if (get().launchSettled) return
    set({ active: { kind: app }, launchSettled: true })
  },
  setLaunchPreference: (launchPreference) => {
    set({ launchPreference })
    persist({ lastApp: get().lastApp, launchPreference })
  },
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  resetSession: () => set({ active: { kind: 'viewer' }, launchSettled: false, drawerOpen: false }),
}))
