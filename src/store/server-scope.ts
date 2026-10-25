/**
 * server-scope — which hub the per-camera documents on this device belong to.
 *
 * A camera id is the hub's `DeviceInfo.id`: a small integer each hub mints on
 * its own. Two hubs both have a camera 101, so a document keyed by camera id
 * alone answers for whichever hub wrote it last — a local name, a hidden flag
 * or a stream tier set on hub A's 101 showed up on hub B's 101. The per-camera
 * documents (`camera-prefs`, `camera-local`) are therefore stored ONE PER HUB,
 * under `<key>@<serverId>`, and each store reads the copy of the hub that is
 * active. Grids carry their hub on the grid itself (`Grid.serverId`).
 *
 * The scope is bound by `ServerScopeBinder` once the active server is known
 * AND the one-time move of the old unscoped documents has run
 * (`server-scope-migration.ts`), so a store never reads an empty per-hub copy
 * while the old document is still waiting to be moved into it.
 */
import { create } from 'zustand'

interface ServerScopeState {
  /** The active hub's server id; `null` until bound (or while signed out). */
  readonly serverId: string | null
  bind: (serverId: string | null) => void
}

export const useServerScopeStore = create<ServerScopeState>((set, get) => ({
  serverId: null,
  bind: (serverId) => {
    if (get().serverId === serverId) return
    set({ serverId })
  },
}))

/**
 * The hub the per-hub state on screen belongs to — what a screen filters grids
 * by and stamps a new grid with. The BOUND scope rather than
 * `useServer().server.id`: it is bound only after the old grids were stamped
 * with their hub, so a screen never filters a list that is still unstamped.
 */
export function useActiveServerId(): string | null {
  return useServerScopeStore((s) => s.serverId)
}

/** The AsyncStorage key of one hub's copy of a per-camera document. */
export function scopedStorageKey(base: string, serverId: string): string {
  return `${base}@${serverId}`
}

/** Resolves with the bound server id — immediately when one is bound, else on
 *  the first bind. A store's `hydrate()` awaits this before it reads. */
export function whenServerScoped(): Promise<string> {
  const current = useServerScopeStore.getState().serverId
  if (current !== null) return Promise.resolve(current)
  return new Promise((resolve) => {
    const off = useServerScopeStore.subscribe((s) => {
      if (s.serverId === null) return
      off()
      resolve(s.serverId)
    })
  })
}

/**
 * Calls `listener` with every bound server id that differs from the LAST one
 * bound — a switch, including one through a signed-out gap (A → null → B).
 * The first bind is not a change: `hydrate()` handles it through
 * {@link whenServerScoped}.
 */
export function onServerScopeChange(listener: (serverId: string) => void): () => void {
  let last = useServerScopeStore.getState().serverId
  return useServerScopeStore.subscribe((s) => {
    if (s.serverId === null) return
    const previous = last
    last = s.serverId
    if (previous !== null && previous !== s.serverId) listener(s.serverId)
  })
}
