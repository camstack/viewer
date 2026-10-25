/**
 * device-settings-store — app switches that describe THIS DEVICE and are never
 * part of the operator's account settings.
 *
 * Debug mode raises this install's log verbosity and ships its `debug` lines to
 * the hub — a diagnostic for the phone in hand. The overlay size is a share of
 * this screen's video width. Both are DEVICE settings. The Settings segment
 * last shown is EPHEMERAL (operator decision 2026-10-21): kept in memory for
 * the session, never written ({@link DEVICE_SETTINGS_LEVELS}).
 *
 * The value on disk before the split (`settings.advanced.debugMode`) is moved
 * here ONCE by `device-local-migration.ts`, which `hydrate()` awaits first.
 */
import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from '../lib/logger.js'
import { migrateDeviceLocalOnce } from './device-local-migration.js'
import {
  DEFAULT_OVERLAY_SIZE,
  parseOverlaySize,
  type OverlaySize,
} from '../components/camera/overlay/overlay-size.js'
import { DEFAULT_SETTINGS_SEGMENT, type SettingsSegmentKey } from '../screens/settings/settings-segments.js'

export interface DeviceSettings {
  /** Debug mode: raise log verbosity (capture `debug`-level logs across live /
   *  playback / scrub) and ship them to the connected server. Off by default. */
  readonly debugMode: boolean
  /** The Settings tab's segment last shown in this session (memory only). */
  readonly settingsSegment: SettingsSegmentKey
  /** How big the read-outs over a picture are (stream stats, device info,
   *  audio meter, occupancy, live viewers, …): a share of the stream's
   *  rendered video width, so it is a property of THIS screen. */
  readonly overlaySize: OverlaySize
}

export const DEVICE_SETTINGS_DEFAULTS: DeviceSettings = Object.freeze({
  debugMode: false,
  settingsSegment: DEFAULT_SETTINGS_SEGMENT,
  overlaySize: DEFAULT_OVERLAY_SIZE,
})

/** Which fields are written (device) and which live in memory only. */
export const DEVICE_SETTINGS_LEVELS: Readonly<Record<keyof DeviceSettings, 'device' | 'ephemeral'>> = {
  debugMode: 'device',
  overlaySize: 'device',
  settingsSegment: 'ephemeral',
}

/** AsyncStorage key for the persisted document. */
export const DEVICE_SETTINGS_STORAGE_KEY = '@camstack/v2/device-settings'

/** Parse persisted JSON field by field. Never throws. */
export function parseDeviceSettings(raw: string | null): DeviceSettings {
  if (!raw) return DEVICE_SETTINGS_DEFAULTS
  try {
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null) return DEVICE_SETTINGS_DEFAULTS
    const debugMode = 'debugMode' in data ? data.debugMode : undefined
    return {
      debugMode: typeof debugMode === 'boolean' ? debugMode : DEVICE_SETTINGS_DEFAULTS.debugMode,
      // Ephemeral: a segment an older build stored is not read back.
      settingsSegment: DEVICE_SETTINGS_DEFAULTS.settingsSegment,
      overlaySize: parseOverlaySize('overlaySize' in data ? data.overlaySize : undefined),
    }
  } catch {
    return DEVICE_SETTINGS_DEFAULTS
  }
}

interface DeviceSettingsState {
  readonly settings: DeviceSettings
  readonly hydrated: boolean
  hydrate: () => Promise<void>
  setDebugMode: (on: boolean) => void
  setSettingsSegment: (segment: SettingsSegmentKey) => void
  setOverlaySize: (size: OverlaySize) => void
}

/** Only the device fields are written; the ephemeral ones stay in memory. */
function persist(settings: DeviceSettings): void {
  const doc = { debugMode: settings.debugMode, overlaySize: settings.overlaySize }
  void AsyncStorage.setItem(DEVICE_SETTINGS_STORAGE_KEY, JSON.stringify(doc)).catch((e: unknown) => {
    log.error('settings', 'device-settings persist failed', { error: e instanceof Error ? e.message : String(e) })
  })
}

export const useDeviceSettingsStore = create<DeviceSettingsState>((set, get) => ({
  settings: DEVICE_SETTINGS_DEFAULTS,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return
    try {
      await migrateDeviceLocalOnce()
      const raw = await AsyncStorage.getItem(DEVICE_SETTINGS_STORAGE_KEY)
      // The segment is this session's: one picked before the read landed stays.
      set({ settings: { ...parseDeviceSettings(raw), settingsSegment: get().settings.settingsSegment }, hydrated: true })
    } catch (e) {
      log.error('settings', 'device-settings hydrate failed', { error: e instanceof Error ? e.message : String(e) })
      set({ hydrated: true })
    }
  },

  setDebugMode: (on) => {
    const settings: DeviceSettings = { ...get().settings, debugMode: on }
    set({ settings })
    persist(settings)
  },

  setSettingsSegment: (segment) => {
    if (get().settings.settingsSegment === segment) return
    set({ settings: { ...get().settings, settingsSegment: segment } })
  },

  setOverlaySize: (size) => {
    if (get().settings.overlaySize === size) return
    const settings: DeviceSettings = { ...get().settings, overlaySize: size }
    set({ settings })
    persist(settings)
  },
}))
