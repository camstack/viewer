import AsyncStorage from '@react-native-async-storage/async-storage'
import { onServerScopeChange, scopedStorageKey, whenServerScoped } from './server-scope.js'
import { create } from 'zustand'

/**
 * Which cameras this operator keeps at hand.
 *
 * LOCAL TO THIS INSTALL, deliberately. A favourite is "the camera I look at
 * from this phone", not a fact about the camera: the same hub is read from a
 * wall tablet in the hall and a phone in a pocket, and those two want different
 * shortlists. Putting it on the device record would make one of them wrong, and
 * would need an admin write for what is a personal shortcut.
 *
 * For the same reason it is a DEVICE setting, never an account one (operator,
 * 2026-10-07 and 2026-10-21: favourites are device-local, like a camera's
 * audio and tier).
 *
 * Mirrors `events-filter-store`: hydrate once at boot, persist on every change,
 * and degrade to "no favourites" on unreadable storage — an empty shortlist is
 * a usable app, a crashed one is not.
 */
/** The base key; each hub's copy lives at `<key>@<serverId>` (`server-scope.ts`):
 *  camera ids are per hub, so hub A's 101 is not hub B's 101. */
export const CAMERA_FAVOURITES_STORAGE_KEY = 'camstack.camera-favourites.v1'

export interface CameraFavouritesState {
  /** Camera ids, in no particular order — membership is the whole question. */
  readonly ids: ReadonlySet<number>
  readonly hydrated: boolean
  /** The hub `ids` belong to; `null` before the first load. */
  readonly serverId: string | null
  hydrate: () => Promise<void>
  toggle: (cameraId: number) => void
}

function persist(serverId: string | null, ids: ReadonlySet<number>): void {
  if (serverId === null) return
  void AsyncStorage.setItem(scopedStorageKey(CAMERA_FAVOURITES_STORAGE_KEY, serverId), JSON.stringify([...ids])).catch(
    () => {},
  )
}

/** Ids from stored JSON. Anything unreadable is NO favourites, never a throw. */
export function parseFavourites(raw: string | null): ReadonlySet<number> {
  if (raw === null) return new Set()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)))
  } catch {
    return new Set()
  }
}

export const useCameraFavouritesStore = create<CameraFavouritesState>((set, get) => ({
  ids: new Set<number>(),
  hydrated: false,
  serverId: null,
  hydrate: async () => {
    if (get().hydrated) return
    const serverId = await whenServerScoped()
    if (get().hydrated) return
    const raw = await AsyncStorage.getItem(scopedStorageKey(CAMERA_FAVOURITES_STORAGE_KEY, serverId)).catch(() => null)
    set({ ids: parseFavourites(raw), serverId, hydrated: true })
  },
  toggle: (cameraId) => {
    const next = new Set(get().ids)
    if (next.has(cameraId)) next.delete(cameraId)
    else next.add(cameraId)
    set({ ids: next })
    persist(get().serverId, next)
  },
}))

// A hub switch swaps the shortlist in one set, once it is read.
onServerScopeChange((serverId) => {
  void AsyncStorage.getItem(scopedStorageKey(CAMERA_FAVOURITES_STORAGE_KEY, serverId))
    .catch(() => null)
    .then((raw) => useCameraFavouritesStore.setState({ ids: parseFavourites(raw), serverId, hydrated: true }))
})
