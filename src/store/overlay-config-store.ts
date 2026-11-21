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
 * The per-camera `overlay` this replaced is no longer read: a camera that
 * carried one draws the defaults until the operator sets this one.
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

async function readScoped(serverId: string): Promise<OverlayConfig> {
  try {
    const raw = await AsyncStorage.getItem(scopedStorageKey(OVERLAY_CONFIG_STORAGE_KEY, serverId))
    return raw ? parseOverlayConfig(JSON.parse(raw)) : OVERLAY_DEFAULTS
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
    const overlay = parseOverlayConfig(raw)
    set({ overlay })
    persist(get().serverId, overlay)
  },
}))

onServerScopeChange((serverId) => {
  void readScoped(serverId).then((overlay) =>
    useOverlayConfigStore.setState({ overlay, serverId, hydrated: true }),
  )
})
