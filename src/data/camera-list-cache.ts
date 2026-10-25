/**
 * A warm camera list across app launches.
 *
 * `['v2','cameras']` is the head of the cameras-tab waterfall: nothing else on
 * that screen can start until it lands, and on a cold launch it is a full
 * network round-trip after a connection handshake. Everything the tab renders
 * — cards, badges, tracks, event kinds — waits behind it.
 *
 * Deliberately NOT `persistQueryClient`. That means two new dependencies, a
 * regenerated lockfile and an EAS install phase that is npm-version-sensitive,
 * to persist a whole cache we do not want persisted. This is one key, ~40
 * lines, and no dependency.
 *
 * **What makes it safe is the key, not the writing.** A cached camera list is
 * scoped to the hub that produced it and to the app build that understands its
 * shape:
 *
 *  - the hub URL, so switching hubs cannot show the previous hub's cameras;
 *  - `CACHE_FORMAT`, bumped by hand when the stored shape changes;
 *  - and every row is re-validated on READ, which is the guard that actually
 *    holds — a version string only protects against changes somebody
 *    remembered to version.
 *
 * It is a HINT, never authority: the real query runs regardless and overwrites
 * it. The worst case is a few hundred milliseconds of a stale name.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import type { QueryClient } from '@tanstack/react-query'
import type { CameraInfo } from './use-cameras.js'

export const CAMERA_LIST_QUERY_KEY = ['v2', 'cameras'] as const

/** Bump to invalidate every persisted list at once when what we STORE changes.
 *  The read-side shape check below is the guard that catches everything else. */
const CACHE_FORMAT = 1

/**
 * `hubUrl` + format, flattened into one AsyncStorage key.
 *
 * The hub URL is not hashed: AsyncStorage keys are opaque strings and a
 * readable one is worth more during an investigation than the few bytes.
 */
export function cameraListCacheKey(hubUrl: string): string {
  return `v2.cache.cameras.${String(CACHE_FORMAT)}.${hubUrl.replace(/\/+$/, '')}`
}

interface StoredList {
  readonly savedAt: number
  readonly cameras: readonly CameraInfo[]
}

/** A row is only usable if it still looks like a `CameraInfo`. A shape that
 *  drifted must be DISCARDED, not rendered — a card with `undefined` for a
 *  name is worse than a spinner. */
function isCameraInfo(v: unknown): v is CameraInfo {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return (
    typeof c['id'] === 'number' &&
    typeof c['name'] === 'string' &&
    typeof c['online'] === 'boolean' &&
    Array.isArray(c['features'])
  )
}

export async function readCameraListCache(hubUrl: string): Promise<readonly CameraInfo[] | null> {
  try {
    const raw = await AsyncStorage.getItem(cameraListCacheKey(hubUrl))
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const list = (parsed as StoredList).cameras
    if (!Array.isArray(list) || list.length === 0) return null
    return list.every(isCameraInfo) ? list : null
  } catch {
    // Unreadable, corrupt, or a storage failure: fall through to the network.
    return null
  }
}

export async function writeCameraListCache(
  hubUrl: string,
  cameras: readonly CameraInfo[],
  now: number = Date.now(),
): Promise<void> {
  try {
    // An empty list is not written: a hub answering `[]` during a restart
    // would otherwise persist "you have no cameras" over a good list.
    if (cameras.length === 0) return
    const payload: StoredList = { savedAt: now, cameras }
    await AsyncStorage.setItem(cameraListCacheKey(hubUrl), JSON.stringify(payload))
  } catch {
    /* best-effort — a cache that cannot be written costs nothing */
  }
}

/**
 * Seed the query cache from disk, if the query has not already answered.
 *
 * The guard is the point: by the time AsyncStorage resolves, the live query may
 * already have landed, and overwriting fresh data with a stored copy would be a
 * visible regression rather than a speed-up.
 */
export async function hydrateCameraList(client: QueryClient, hubUrl: string): Promise<boolean> {
  if (client.getQueryData(CAMERA_LIST_QUERY_KEY) !== undefined) return false
  const cached = await readCameraListCache(hubUrl)
  if (cached === null) return false
  if (client.getQueryData(CAMERA_LIST_QUERY_KEY) !== undefined) return false
  // `updatedAt: 0` is the whole point of this line. A bare `setQueryData`
  // stamps the row as fetched NOW, and the query's `staleTime` is
  // `RECONCILE_MS` (5 min) — so the cached list counted as FRESH and the
  // cameras query did not refetch on mount. The operator opened the app to a
  // camera still marked disabled minutes after re-enabling it, and only a
  // pull-to-refresh fixed it.
  //
  // Backdating makes this stale-WHILE-revalidate instead of stale-INSTEAD-of:
  // the cached rows still paint instantly (which is why this cache exists),
  // and React Query refetches immediately because the data is already old.
  client.setQueryData(CAMERA_LIST_QUERY_KEY, cached, { updatedAt: 0 })
  return true
}
