import { useEffect } from 'react'
import {
  useSettingsStore,
  type AppSettings,
  type GridDefaults,
  type StreamDefaults,
  type HighlightAppearance,
  type ClusterPreferences,
  type EventsPreferences,
  type ReviewPagePreferences,
  type CameraListOverlaySettings,
} from '../store/settings-store.js'
import type { HapticsConfig } from '../lib/event-haptics.js'

/** Stable, feature-facing API over the settings store. Grid/camera features
 *  consume `settings.grid` / `settings.stream`; the Settings screen drives the
 *  setters. Hydration is triggered lazily on first mount and is idempotent. */
export interface UseSettings {
  /** The current, fully-populated settings document. */
  readonly settings: AppSettings
  /** True once persisted settings have loaded (UI may show a spinner before). */
  readonly hydrated: boolean
  /** Update one grid default (numeric fields are clamped in the store). */
  readonly setGridDefault: <K extends keyof GridDefaults>(key: K, value: GridDefaults[K]) => void
  /** Update one stream/camera default (numeric fields are clamped). */
  readonly setStreamDefault: <K extends keyof StreamDefaults>(
    key: K,
    value: StreamDefaults[K],
  ) => void
  /** Update one highlight-appearance field (thickness is clamped). */
  readonly setHighlightAppearance: <K extends keyof HighlightAppearance>(
    key: K,
    value: HighlightAppearance[K],
  ) => void
  /** Update one cluster-preferences field. */
  readonly setCluster: <K extends keyof ClusterPreferences>(
    key: K,
    value: ClusterPreferences[K],
  ) => void
  /** Update one events-surface preference (e.g. the reel thumbnail size). */
  readonly setEvents: <K extends keyof EventsPreferences>(
    key: K,
    value: EventsPreferences[K],
  ) => void
  /** Update one review-page tile preference (People / Plates: time, camera). */
  readonly setReview: <K extends keyof ReviewPagePreferences>(
    key: K,
    value: ReviewPagePreferences[K],
  ) => void
  /** Update one haptic-feedback flag (master toggle or a per-event-kind toggle). */
  readonly setHaptics: <K extends keyof HapticsConfig>(key: K, value: HapticsConfig[K]) => void
  /** Update one camera-list overlay field (what the cards draw, and where). */
  readonly setCameraList: <K extends keyof CameraListOverlaySettings>(
    key: K,
    value: CameraListOverlaySettings[K],
  ) => void
  /** Reset all settings back to the built-in defaults. */
  readonly resetSettings: () => void
}

/** Read + mutate persisted app settings. Triggers a one-time hydrate on mount. */
export function useSettings(): UseSettings {
  const settings = useSettingsStore((s) => s.settings)
  const hydrated = useSettingsStore((s) => s.hydrated)
  const hydrate = useSettingsStore((s) => s.hydrate)
  const setGridDefault = useSettingsStore((s) => s.setGridDefault)
  const setStreamDefault = useSettingsStore((s) => s.setStreamDefault)
  const setHighlightAppearance = useSettingsStore((s) => s.setHighlightAppearance)
  const setCluster = useSettingsStore((s) => s.setCluster)
  const setEvents = useSettingsStore((s) => s.setEvents)
  const setReview = useSettingsStore((s) => s.setReview)
  const setHaptics = useSettingsStore((s) => s.setHaptics)
  const setCameraList = useSettingsStore((s) => s.setCameraList)
  const resetSettings = useSettingsStore((s) => s.resetSettings)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  return {
    settings,
    hydrated,
    setGridDefault,
    setStreamDefault,
    setHighlightAppearance,
    setCluster,
    setEvents,
    setReview,
    setHaptics,
    setCameraList,
    resetSettings,
  }
}
