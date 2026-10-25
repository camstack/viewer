/**
 * snapshot-file-system — the ONE binding between the snapshot file cache and the
 * device, and the process-wide store instance every surface shares.
 *
 * Split from `snapshot-file-store.ts` so the store's rules can be tested against
 * an in-memory port (see `__tests__/snapshot-file-store.spec.ts`) instead of a
 * simulator. Everything platform-specific is here:
 *
 *  - **Web has no cache.** `expo-file-system` has no document directory in a
 *    browser, and it does not need one: the browser revalidates with `ETag`, so
 *    the identity-versioned URL path already behaves correctly there. The
 *    factory answers null and every surface keeps its pre-existing behaviour.
 *  - **The document directory, not the cache directory.** The whole point is a
 *    frame that survives an app kill and is there at a cold start with the hub
 *    unreachable, and iOS may purge `cacheDirectory` under disk pressure —
 *    which would be exactly the moment the fallback is needed. The price is
 *    that these bytes are included in an iCloud backup; the footprint is one
 *    file per (device, width), so ~0.3-2.5 MB for a 16-camera install, and
 *    `cacheDirectory` is a one-line swap if that ever stops being acceptable.
 *  - **The store is a singleton.** Seven surfaces render snapshots and several
 *    can render the SAME camera at the same width in one frame; a store per
 *    hook would download the same bytes once per surface.
 */
import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'

import { readEtagHeader, SNAPSHOT_CACHE_DIR_NAME } from './snapshot-file-cache.js'
import { SnapshotFileStore, type SnapshotFileSystemPort } from './snapshot-file-store.js'
import { runtimeQuiesce } from '../lib/runtime-quiesce.js'

/**
 * Bind the store's port to `expo-file-system`, or null where there is no file
 * system to bind to (web).
 *
 * Every method takes a plain FILE NAME; the directory is composed here and
 * nowhere else, so no caller can address a path outside the cache directory.
 */
export function createSnapshotFileSystemPort(): SnapshotFileSystemPort | null {
  if (Platform.OS === 'web') return null
  const root = FileSystem.documentDirectory
  if (root === null || root.length === 0) return null
  const directory = `${root}${SNAPSHOT_CACHE_DIR_NAME}/`
  return {
    directory,
    ensureDirectory: async (): Promise<void> => {
      // `intermediates` also makes an existing directory a no-op rather than a
      // throw, so this is safe to call on every hydrate.
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true })
    },
    list: (): Promise<readonly string[]> => FileSystem.readDirectoryAsync(directory),
    download: async (url, targetFileName, headers) => {
      // A restart is about to tear the runtime down: a download that lands
      // afterwards frees its promise against a dead runtime (`runtime-quiesce.ts`).
      // Declined reads as a miss; the cache refills on the next runtime.
      if (!runtimeQuiesce.admit()) return { status: 0, etag: null }
      const end = runtimeQuiesce.begin()
      try {
        const result = await FileSystem.downloadAsync(url, `${directory}${targetFileName}`, {
          headers: { ...headers },
        })
        return { status: result.status, etag: readEtagHeader(result.headers) }
      } finally {
        end()
      }
    },
    move: (fromFileName, toFileName): Promise<void> =>
      FileSystem.moveAsync({
        from: `${directory}${fromFileName}`,
        to: `${directory}${toFileName}`,
      }),
    remove: (fileName): Promise<void> =>
      FileSystem.deleteAsync(`${directory}${fileName}`, { idempotent: true }),
  }
}

/** `undefined` = not built yet; `null` = this platform has no file cache. */
let instance: SnapshotFileStore | null | undefined

/** The process-wide snapshot file cache, or null on web. */
export function getSnapshotFileStore(): SnapshotFileStore | null {
  if (instance === undefined) {
    const port = createSnapshotFileSystemPort()
    instance = port === null ? null : new SnapshotFileStore(port)
  }
  return instance
}
