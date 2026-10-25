/**
 * Headless: binds the per-hub documents to the ACTIVE server
 * (`store/server-scope.ts`), after the one-time move of the hub-blind
 * documents onto their hub (`store/server-scope-migration.ts`) and the
 * one-time move into the device and account levels
 * (`store/two-levels-migration.ts`).
 *
 * It waits only for what is local — the active server and the saved-server
 * list, which `ServerProvider` reads from storage and sets together — never
 * for a connection:
 * the camera prefs carry the stream tier, and a tier that lands after the
 * player mounted renegotiates the stream (`prefs-warmup.ts`).
 *
 * The move decides which hub a grid or a camera entry belongs to from each
 * signed-in server's CACHED camera list (`camera-list-cache.ts`) — a disk
 * read per server, no network — and falls back to the active server.
 *
 * Signing out leaves the last hub bound: nothing reads the per-hub documents
 * without a hub, and the next sign-in binds the hub it signed into.
 */
import { useEffect } from 'react'
import { useServer } from './ServerProvider.js'
import { readCameraListCache } from '../data/camera-list-cache.js'
import { useServerScopeStore } from '../store/server-scope.js'
import { migrateServerScopeOnce, type ServerCameraCandidate } from '../store/server-scope-migration.js'
import { useGridStore } from '../store/grid-store.js'
import { useGridLocalStore } from '../store/grid-local-store.js'
import { migrateTwoLevelsOnce } from '../store/two-levels-migration.js'
import type { SavedServer } from '../connection/server-switch.js'

async function cachedCandidates(servers: readonly SavedServer[]): Promise<readonly ServerCameraCandidate[]> {
  const signedIn = servers.filter((s) => s.signedIn)
  return await Promise.all(
    signedIn.map(async (s): Promise<ServerCameraCandidate> => {
      const cameras = await readCameraListCache(s.serverUrl)
      return { serverId: s.id, cameraIds: new Set((cameras ?? []).map((c) => c.id)) }
    }),
  )
}

export function ServerScopeBinder(): null {
  const { loading, server, servers } = useServer()
  const serverId = server?.id ?? null

  useEffect(() => {
    if (loading || serverId === null) return
    let cancelled = false
    void (async () => {
      const candidates = await cachedCandidates(servers)
      await migrateServerScopeOnce(candidates, serverId)
      // Then the move into the device and account levels, which trims the
      // per-hub copies the first move just wrote.
      await migrateTwoLevelsOnce([serverId, ...candidates.map((c) => c.serverId)])
      if (cancelled) return
      // The moves may have rewritten the grids list (hub stamp, layouts out)
      // and the grid-local document (layouts in) after the stores read them.
      await useGridStore.getState().reload()
      await useGridLocalStore.getState().reload()
      useServerScopeStore.getState().bind(serverId)
    })()
    return () => {
      cancelled = true
    }
    // `servers` is read once per bind, not watched: a token refresh rewrites
    // the list and must not re-run the bind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, serverId])

  return null
}
