/**
 * SnapshotImage — the one way a camera snapshot is put on screen.
 *
 * Seven surfaces render snapshots (cards, the paused grid wall, the grids
 * preview strip, the detail poster, the live-view poster, the zone-drawing
 * overlay, the web grid builder) and every one of them had hand-written
 * `<Image>` props. They had drifted: six passed `cachePolicy="memory-disk"` and
 * one inherited `expo-image`'s `'disk'` default, transitions ranged 0–150 ms,
 * and not one passed a `placeholder` — so every frame change flashed empty
 * before the new bytes arrived.
 *
 * The caching contract lives here so it cannot drift again:
 *
 *  - **The cache policy follows the source.** A remote URL keeps
 *    `memory-disk` (web, and older hubs). A `file://` path from the native
 *    snapshot file cache takes `memory` alone: those bytes are ALREADY a file
 *    this app wrote and swept, and letting `expo-image` copy them into its own
 *    opaque disk cache would double every snapshot write and re-create the
 *    unnameable, never-revalidated store the file cache exists to replace.
 *  - **A URL that is stable per frame** (`useSnapshot` builds it from the
 *    capture identity). `expo-image` is URL-keyed and does not revalidate — its
 *    own docs define the disk policy as "queried from the disk cache if exists,
 *    otherwise downloaded" — so a stable URL means a repaint, a remount, a tab
 *    switch and a relaunch all cost zero network.
 *  - **Continuity without regression.** The last PAINTED frame stays underneath
 *    while a newer generation downloads. It is never promoted back over a
 *    newer frame and disappears as soon as the replacement paints.
 *  - **`recyclingKey`** is device-scoped. List reuse cannot cross cameras, but
 *    a URL refresh for the same camera does not clear the backing frame.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Image, type ImageContentFit, type ImageLoadEventData, type ImageStyle } from 'expo-image'
import { StyleSheet, View, type StyleProp } from 'react-native'

import type { SnapshotSource } from '../../data/use-snapshot.js'
import { log } from '../../lib/logger.js'
import { isLoadOfCandidate } from './snapshot-load-match.js'
import { shouldLogPaint } from './snapshot-paint-log.js'

/**
 * `memory-disk` for anything fetched over the network; `memory` for a local
 * file, whose persistence we already own. See the docblock above.
 */
function cachePolicyFor(uri: string): 'memory' | 'memory-disk' {
  return uri.startsWith('file:') ? 'memory' : 'memory-disk'
}

export interface SnapshotImageProps {
  /** The whole source from `useSnapshot` — uri, headers, placeholder, handlers. */
  readonly source: SnapshotSource
  /** Device id, used as the recycling key so list reuse cannot cross frames. */
  readonly deviceId: number
  readonly style?: StyleProp<ImageStyle>
  readonly contentFit?: ImageContentFit
  /**
   * Retained for call-site compatibility. Snapshot generations now switch only
   * after the replacement has displayed, without expo-image's internal fade.
   */
  readonly transition?: number
  /** Extra `onLoad` work (e.g. reading the frame's intrinsic size). The
   *  source's own `onLoad` always runs — the caller cannot forget it. */
  readonly onLoad?: (event: ImageLoadEventData) => void
}

export function SnapshotImage({
  source,
  deviceId,
  style,
  contentFit = 'cover',
  onLoad,
}: SnapshotImageProps): React.JSX.Element | null {
  type ImageSource = { readonly uri: string; readonly headers?: Record<string, string> }
  const candidate = useMemo<ImageSource | null>(
    () =>
      source.uri === null
        ? null
        : source.headers
          ? { uri: source.uri, headers: source.headers }
          : { uri: source.uri },
    [source.uri, source.headers],
  )
  const [paintedState, setPainted] = useState<{
    readonly deviceId: number
    readonly source: ImageSource
  } | null>(null)
  const painted = paintedState?.deviceId === deviceId ? paintedState.source : null
  const candidateStartedAtRef = useRef(0)
  const candidateLoadedRef = useRef(false)

  useEffect(() => {
    candidateStartedAtRef.current = Date.now()
    candidateLoadedRef.current = false
  }, [candidate?.uri])

  // STRICT: no candidate, no image. The painted frame is kept ONLY as the
  // transition layer underneath a new candidate that is still downloading —
  // it can never be the visible content on its own, so a lost/stale source
  // blanks the tile instead of falling back to an old photograph.
  if (candidate === null) return null
  const replacing = painted !== null && candidate.uri !== painted.uri

  return (
    <View style={style}>
      {painted !== null && replacing ? (
        <Image
          source={painted}
          recyclingKey={`${String(deviceId)}:painted`}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          cachePolicy={cachePolicyFor(painted.uri)}
        />
      ) : null}
      <Image
        key={candidate.uri}
        source={candidate}
        recyclingKey={String(deviceId)}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        cachePolicy={cachePolicyFor(candidate.uri)}
        // The old frame is already the transition layer. expo-image's own
        // transition begins after onLoad and used to let us remove that layer
        // before replacement pixels were actually displayed, causing a flash.
        transition={0}
        onLoad={(event: ImageLoadEventData) => {
          if (candidate === null) return
          // A slow generation can finish after React has already selected a
          // newer URL. Never let that late completion become the painted
          // backing frame (the visible "two days ago after several reloads"
          // regression). A header-carrying candidate is painted from an object
          // URL on web, so its load reports `blob:` — see `snapshot-load-match`.
          if (!isLoadOfCandidate(event.source.url, candidate)) return
          candidateLoadedRef.current = true
          onLoad?.(event)
        }}
        onDisplay={() => {
          if (candidate === null || !candidateLoadedRef.current) return
          const ms = Date.now() - candidateStartedAtRef.current
          const frameAgeMs =
            source.capturedAt === null ? null : Math.max(0, Date.now() - source.capturedAt)
          setPainted({ deviceId, source: candidate })
          source.onLoad()
          if (shouldLogPaint(ms, frameAgeMs)) {
            // `debug`, not `info`: this is PER TILE. Measured on the hub,
            // 2026-09-10, it was 24 shipped lines in thirty minutes beside
            // 41 `tile transition` and 25 `tile mount` — and the logger's own
            // allowlist says the scopes that always ship must be "low-rate
            // and bounded... anything noisier belongs at debug" (D437).
            log.debug('media:snapshot', 'image displayed', {
              deviceId,
              ms,
              capturedAt: source.capturedAt,
              frameAgeMs,
              stale: source.stale,
              initial: painted === null,
            })
          }
        }}
        onError={() => {
          if (candidate !== null) source.onError()
        }}
      />
    </View>
  )
}
