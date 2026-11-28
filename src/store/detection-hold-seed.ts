/**
 * detection-hold-seed — the detection hold became ONE global setting
 * (`settings.grid.detectionHoldSec`, Settings → Viewing) after each camera and
 * grid stored its own. So the global does not silently reset what operators
 * had chosen, it is seeded ONCE per hub from the most common stored value —
 * but only while the global still holds its factory default, and never again
 * (a stamp per hub, so a later account pull or edit is never overwritten).
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { CAMERA_PREFS_STORAGE_KEY } from './camera-prefs-store.js'
import { GRIDS_STORAGE_KEY } from './grid-store.js'
import { scopedStorageKey } from './server-scope.js'
import { DEFAULTS, useSettingsStore } from './settings-store.js'

/** Per hub: the seeding has been decided (done, or deliberately skipped). */
export const DETECTION_HOLD_SEEDED_KEY = '@dominevo/v2/detection-hold-seeded'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function holdOf(highlight: unknown): number[] {
  return isRecord(highlight) && typeof highlight.detectionHoldSec === 'number' && highlight.detectionHoldSec >= 0
    ? [highlight.detectionHoldSec]
    : []
}

/** Every stored per-camera / per-grid detection hold of one hub, camera ids first. */
export function storedDetectionHolds(rawPrefs: unknown, rawGrids: unknown, serverId: string): readonly number[] {
  const cameras =
    isRecord(rawPrefs) && isRecord(rawPrefs.byId)
      ? Object.keys(rawPrefs.byId)
          .sort((a, b) => Number(a) - Number(b))
          .flatMap((id) => {
            const pref = (rawPrefs.byId as Record<string, unknown>)[id]
            return isRecord(pref) ? holdOf(pref.highlight) : []
          })
      : []
  const grids = Array.isArray(rawGrids)
    ? rawGrids.flatMap((g) =>
        isRecord(g) && (g.serverId === undefined || g.serverId === serverId) ? holdOf(g.highlight) : [],
      )
    : []
  return [...cameras, ...grids]
}

/** The most common value (the first seen wins a tie), or null for none. */
export function mostCommonHold(holds: readonly number[]): number | null {
  let best: { value: number; n: number } | null = null
  for (const value of new Set(holds)) {
    const n = holds.filter((h) => h === value).length
    if (best === null || n > best.n) best = { value, n }
  }
  return best?.value ?? null
}

async function readJson(key: string): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

const decided = new Set<string>()

/** Seed the global detection hold once for the bound hub. Safe to call often. */
export async function seedDetectionHoldOnce(): Promise<void> {
  const state = useSettingsStore.getState()
  const serverId = state.accountServerId
  if (!state.hydrated || serverId === null || decided.has(serverId)) return
  decided.add(serverId)
  const stampKey = scopedStorageKey(DETECTION_HOLD_SEEDED_KEY, serverId)
  if ((await AsyncStorage.getItem(stampKey)) !== null) return
  const current = useSettingsStore.getState()
  // An explicit global (already changed from the default) is never touched.
  if (current.accountServerId === serverId && current.settings.grid.detectionHoldSec === DEFAULTS.grid.detectionHoldSec) {
    const seed = mostCommonHold(
      storedDetectionHolds(
        await readJson(scopedStorageKey(CAMERA_PREFS_STORAGE_KEY, serverId)),
        await readJson(GRIDS_STORAGE_KEY),
        serverId,
      ),
    )
    if (seed !== null && seed !== DEFAULTS.grid.detectionHoldSec) {
      useSettingsStore.getState().setGridDefault('detectionHoldSec', seed)
    }
  }
  await AsyncStorage.setItem(stampKey, '1')
}

/** Run the seeding for every hub the app binds to (first bind and switches). */
export function watchDetectionHoldSeed(): () => void {
  const check = (): void => {
    void seedDetectionHoldOnce().catch(() => undefined)
  }
  check()
  return useSettingsStore.subscribe(check)
}

/** Test seam: forget which hubs were decided in this process. */
export function resetDetectionHoldSeedForTests(): void {
  decided.clear()
}
