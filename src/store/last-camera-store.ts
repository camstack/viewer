/**
 * last-camera-store — the camera the operator was watching, across launches.
 *
 * Thin glue, like `settings-store` and `camera-prefs-store`: the rules are pure
 * in `navigation/last-camera.ts`, this holds the value and persists it.
 *
 * ## Two fields because there are two different facts
 *
 * `startupDeviceId` is the camera the app STARTED with. It is read once at
 * hydrate and never written again for the life of the process — the launch
 * decision reads it, and only it.
 *
 * `current` is what the navigation is writing right now. It is the value on
 * disk, and it is not what the launch reads.
 *
 * Keeping them apart is not tidiness, it is the whole reason this works: at
 * launch the app lands on `/cameras`, `note()` correctly treats that as "changed
 * page" and clears the stored camera — so a single field would be wiped
 * milliseconds before the reopen bridge could read it. The frozen field is
 * immune to the app's own first navigation, which is exactly the property
 * needed.
 *
 * Writes are deduped against `current`: an operator sitting on one camera
 * re-renders the route plenty, and rewriting the same id to AsyncStorage on
 * every one of those is I/O nobody asked for.
 */
import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { log } from '../lib/logger.js'
import { onServerScopeChange, scopedStorageKey, whenServerScoped } from './server-scope.js'
import { LAST_CAMERA_STORAGE_KEY, lastCameraEffectFor } from '../navigation/last-camera.js'

/** Parse a persisted value. Anything that is not a positive integer is nothing. */
function parseStored(raw: string | null): number | null {
  if (raw === null) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

interface LastCameraState {
  /**
   * The camera the app started with — frozen for the life of the process. The
   * launch decision reads THIS. `null` when nothing was remembered.
   */
  readonly startupDeviceId: number | null
  /** True once storage has been read. Before that, `startupDeviceId` means
   *  nothing and the launch decision must wait rather than conclude. */
  readonly hydrated: boolean
  /** What is on disk right now. Internal — the dedupe for `note()`. */
  readonly current: number | null
  /** The hub `current` belongs to (`server-scope.ts`): a camera id is per hub. */
  readonly serverId: string | null
  hydrate: () => Promise<void>
  /** Apply a navigation: remember a single stream; leave the value alone for
   *  anything else. */
  note: (pathname: string) => void
  /**
   * The operator is DONE with the camera — backing out, or pressing Cameras
   * while already on one. The only thing that clears the value now: leaving a
   * camera for another tab used to, which is why coming back could never
   * return you to it.
   */
  forget: () => void
}

function persist(serverId: string | null, deviceId: number | null): void {
  if (serverId === null) return
  const key = scopedStorageKey(LAST_CAMERA_STORAGE_KEY, serverId)
  const write = deviceId === null ? AsyncStorage.removeItem(key) : AsyncStorage.setItem(key, String(deviceId))
  void write.catch((e: unknown) => {
    log.error('nav', 'last-camera persist failed', {
      error: e instanceof Error ? e.message : String(e),
    })
  })
}

export const useLastCameraStore = create<LastCameraState>((set, get) => ({
  startupDeviceId: null,
  hydrated: false,
  current: null,
  serverId: null,

  hydrate: async () => {
    if (get().hydrated) return
    try {
      const serverId = await whenServerScoped()
      if (get().hydrated) return
      const stored = parseStored(await AsyncStorage.getItem(scopedStorageKey(LAST_CAMERA_STORAGE_KEY, serverId)))
      set({ startupDeviceId: stored, current: stored, serverId, hydrated: true })
    } catch (e) {
      // A storage failure is "nothing remembered", which is the normal launch —
      // never a launch that hangs waiting for a read that already failed.
      log.error('nav', 'last-camera hydrate failed', {
        error: e instanceof Error ? e.message : String(e),
      })
      set({ hydrated: true })
    }
  },

  note: (pathname) => {
    const effect = lastCameraEffectFor(pathname)
    // `keep` writes nothing at all — going to Grids is not the operator
    // finishing with the camera. Only `remember` and an explicit `forget()`
    // move the value.
    if (effect.kind === 'keep') return
    const next = effect.kind === 'remember' ? effect.deviceId : null
    if (get().current === next) return
    set({ current: next })
    persist(get().serverId, next)
  },
  forget: () => {
    if (get().current === null) return
    set({ current: null })
    persist(get().serverId, null)
  },
}))

// A hub switch reads that hub's remembered camera. `startupDeviceId` stays
// frozen: the launch decision is made once per process.
onServerScopeChange((serverId) => {
  void AsyncStorage.getItem(scopedStorageKey(LAST_CAMERA_STORAGE_KEY, serverId))
    .catch(() => null)
    .then((raw) => useLastCameraStore.setState({ current: parseStored(raw), serverId, hydrated: true }))
})
