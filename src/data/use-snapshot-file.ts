/**
 * useSnapshotFile — the React face of the native snapshot file cache.
 *
 * `snapshot-file-cache.ts` explains why the cache exists; `snapshot-file-store.ts`
 * owns the effects. This hook does two things and no more: it subscribes to one
 * surface's cached-frame state, and it tells the store which identity that
 * surface currently wants.
 *
 * **No timer.** The identity in `remoteUrl` already moves exactly when the frame
 * does — the links poll decides that: the hub's `capturedAt` for a target it
 * was asked about, every ~20 s per tile (`snapshot-link-slices.ts`), with the
 * 5 min overview reconcile behind it — so the effect re-running on a new
 * `remoteUrl` IS the refresh mechanism. A cadence of its own would be a second
 * one competing with it. (This paragraph named "the 5 s overview poll" until
 * 2026-09-10; that poll has been a 5 min reconcile since the links call took
 * over the capture, and a docblock naming a mechanism that is gone reads as
 * verification of it.)
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import { snapshotCacheWidthKey } from './snapshot-file-cache.js'
import { getSnapshotFileStore } from './snapshot-file-system.js'
import {
  SNAPSHOT_FILE_UNSUPPORTED,
  type SnapshotFileState,
} from './snapshot-file-store.js'

export interface UseSnapshotFileParams {
  readonly deviceId: number
  /** The width this surface paints at — part of the cache key, see the store. */
  readonly width: number | undefined
  /** The identity-versioned hub URL from `resolveSnapshotUri`. */
  readonly remoteUrl: string | null
  /** Hub auth token; null before sign-in. */
  readonly token: string | null
  readonly enabled: boolean
}

/** No token yet (signed out): the request is made without one and 401s, which
 *  is the same answer every other hub media call gives. */
const NO_HEADERS: Readonly<Record<string, string>> = Object.freeze({})

/** A stable no-op subscription for the platforms with no cache (web). */
const NEVER_CHANGES = (): (() => void) => () => undefined

export function useSnapshotFile(params: UseSnapshotFileParams): SnapshotFileState {
  const { deviceId, width, remoteUrl, token, enabled } = params
  const store = getSnapshotFileStore()
  const widthKey = snapshotCacheWidthKey(width)

  const readState = useCallback(
    (): SnapshotFileState =>
      store === null ? SNAPSHOT_FILE_UNSUPPORTED : store.get(deviceId, widthKey),
    [store, deviceId, widthKey],
  )
  const state = useSyncExternalStore(store?.subscribe ?? NEVER_CHANGES, readState)

  // Memoised on the token alone: a fresh object every render would re-run the
  // effect on every 5 s poll tick and re-ask for an identity already settled.
  const headers = useMemo<Readonly<Record<string, string>>>(
    () => (token !== null && token.length > 0 ? { Authorization: `Bearer ${token}` } : NO_HEADERS),
    [token],
  )

  useEffect(() => {
    if (store === null) return
    void store.request({ deviceId, width, remoteUrl, headers, enabled })
  }, [store, deviceId, width, remoteUrl, headers, enabled])

  return state
}
