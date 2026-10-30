/**
 * useEventSnapshotGroup — the still an event's download saves.
 *
 * The same pick the track detail opens on: the group of the clean full frame,
 * else the first group the manifest lists (`cleanFrameId` / `groupForKey`).
 * Built off `listTrackMedia` (keys and sizes, no bytes). An event with no
 * `trackId` has no media owner to ask, so it resolves to `none`, not to a read
 * that never answers.
 */
import { useMemo } from 'react'

import type { ObjectEvent } from '../components/camera/theater/event-cluster.js'
import { cleanFrameId } from './track-events.js'
import { groupForKey, groupTrackMedia, type MediaGroup } from './track-media-groups.js'
import { useTrackDetailMedia } from './use-track-detail-media.js'

export type EventSnapshotGroup =
  | { readonly status: 'loading' }
  | { readonly status: 'none' }
  | { readonly status: 'ready'; readonly group: MediaGroup }

export function useEventSnapshotGroup(
  event: Pick<ObjectEvent, 'id' | 'deviceId' | 'trackId'>,
): EventSnapshotGroup {
  const trackId = event.trackId ?? null
  const media = useTrackDetailMedia(event.deviceId, event.id, trackId)
  return useMemo((): EventSnapshotGroup => {
    if (trackId === null) return { status: 'none' }
    if (media.loading) return { status: 'loading' }
    const groups = groupTrackMedia(media.gallery)
    const group = groupForKey(groups, cleanFrameId(media.gallery)) ?? groups[0] ?? null
    return group === null ? { status: 'none' } : { status: 'ready', group }
  }, [trackId, media.loading, media.gallery])
}
