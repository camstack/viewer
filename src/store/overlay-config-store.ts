/**
 * overlay-config-store — the ONE overlay document, for every stream.
 *
 * What the operator pins over a live picture (camera name, control groups,
 * badges, readouts, box layers) is a single global configuration, not a copy
 * per camera. It is an ACCOUNT setting: a viewing preference of the person that
 * follows them to their other devices, one cached copy per hub
 * (`server-scope.ts`; its readouts name that hub's devices), synced as the
 * `viewer.app` / `overlays` section by `account/account-settings-sync.ts`. The
 * overlay SIZE is the opposite — a share of this screen's video width — and
 * stays in `device-settings-store.ts`.
 *
 * Absence is the defaults, and a document equal to the defaults is not stored.
 * The per-camera `overlay` this replaced is no longer read, except once: a hub
 * with no document yet adopts the most common non-default one
 * (`seedFromLegacyCameraOverlays`).
 */
import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  isDefaultOverlay,
  OVERLAY_DEFAULTS,
  parseOverlayConfig,
  type OverlayConfig,
} from '../components/camera/overlay/overlay-config.js'
import { onServerScopeChange, scopedStorageKey, whenServerScoped } from './server-scope.js'
import { CAMERA_PREFS_STORAGE_KEY } from './camera-prefs-store.js'

/** Base key; one cached copy per hub (`scopedStorageKey`). */
export const OVERLAY_CONFIG_STORAGE_KEY = 'camstack.v2.overlay-config'

interface OverlayConfigState {
  readonly overlay: OverlayConfig
  readonly hydrated: boolean
  /** The hub `overlay` belongs to; `null` before the first load. */
  readonly serverId: string | null
  hydrate: () => Promise<void>
  /** Replace the document (the panels send the whole next value). */
  setOverlay: (next: OverlayConfig) => void
  /** Adopt a value from the account (validated here). */
  applyAccount: (raw: unknown) => void
}

function persist(serverId: string | null, overlay: OverlayConfig): void {
  if (serverId === null) return
  const key = scopedStorageKey(OVERLAY_CONFIG_STORAGE_KEY, serverId)
  const write = isDefaultOverlay(overlay)
    ? AsyncStorage.removeItem(key)
    : AsyncStorage.setItem(key, JSON.stringify(overlay))
  void write.catch(() => {})
}

/**
 * TEMPORARY, remove once every install has opened this version: before the
 * global document, each camera stored its own `overlay` in the camera-prefs
 * document. When no global document exists yet, adopt the most common
 * non-default one so a configured install does not silently lose its layout.
 */
async function seedFromLegacyCameraOverlays(serverId: string): Promise<OverlayConfig> {
  try {
    const raw = await AsyncStorage.getItem(scopedStorageKey(CAMERA_PREFS_STORAGE_KEY, serverId))
    if (!raw) return OVERLAY_DEFAULTS
    const byId: unknown = (JSON.parse(raw) as { byId?: unknown }).byId
    if (typeof byId !== 'object' || byId === null) return OVERLAY_DEFAULTS
    const counts = new Map<string, { config: OverlayConfig; n: number }>()
    for (const pref of Object.values(byId)) {
      const legacy: unknown = (pref as { overlay?: unknown } | null)?.overlay
      if (legacy === undefined || legacy === null) continue
      const config = parseOverlayConfig(legacy)
      if (isDefaultOverlay(config)) continue
      const key = JSON.stringify(config)
      const seen = counts.get(key)
      counts.set(key, { config, n: (seen?.n ?? 0) + 1 })
    }
    let best: { config: OverlayConfig; n: number } | null = null
    for (const entry of counts.values()) if (best === null || entry.n > best.n) best = entry
    return best === null ? OVERLAY_DEFAULTS : best.config
  } catch {
    return OVERLAY_DEFAULTS
  }
}

async function readScoped(serverId: string): Promise<OverlayConfig> {
  try {
    const raw = await AsyncStorage.getItem(scopedStorageKey(OVERLAY_CONFIG_STORAGE_KEY, serverId))
    if (raw) return parseOverlayConfig(JSON.parse(raw))
    const seeded = await seedFromLegacyCameraOverlays(serverId)
    persist(serverId, seeded)
    return seeded
  } catch {
    return OVERLAY_DEFAULTS
  }
}

export const useOverlayConfigStore = create<OverlayConfigState>((set, get) => ({
  overlay: OVERLAY_DEFAULTS,
  hydrated: false,
  serverId: null,
  hydrate: async () => {
    if (get().hydrated) return
    const serverId = await whenServerScoped()
    const overlay = await readScoped(serverId)
    if (get().hydrated) return
    set({ overlay, serverId, hydrated: true })
  },
  setOverlay: (next) => {
    const overlay = parseOverlayConfig(next)
    set({ overlay })
    persist(get().serverId, overlay)
  },
  applyAccount: (raw) => {
    // An account value can land before `hydrate` ran: mark the store hydrated
    // (so the disk read cannot overwrite it later) and persist once the hub
    // scope is known.
    const overlay = parseOverlayConfig(raw)
    set({ overlay, hydrated: true })
    void whenServerScoped().then((serverId) => {
      set({ serverId })
      persist(serverId, get().overlay)
    })
  },
}))

onServerScopeChange((serverId) => {
  void readScoped(serverId).then((overlay) =>
    useOverlayConfigStore.setState({ overlay, serverId, hydrated: true }),
  )
})
