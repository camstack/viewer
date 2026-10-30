/**
 * useEventStills — the stills an event's download can save.
 *
 * Built off `listTrackMedia` (keys and sizes, no bytes) through the same
 * grouping the track detail uses. A target with no `trackId` has no media owner
 * to ask, so it resolves to `none`, not to a read that never answers.
 */
import { useMemo } from 'react'

import { pickEventStills, type EventDownloadTarget, type EventStills } from '../recording/event-download.js'
import { groupTrackMedia } from './track-media-groups.js'
import { useTrackDetailMedia } from './use-track-detail-media.js'

export type EventStillsState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly stills: EventStills }

const NO_STILLS: EventStills = { snapshot: null, keyframe: null }

export function useEventStills(target: Pick<EventDownloadTarget, 'deviceId' | 'trackId' | 'bestEventId'>): EventStillsState {
  const media = useTrackDetailMedia(target.deviceId, target.bestEventId, target.trackId)
  return useMemo((): EventStillsState => {
    if (target.trackId === null) return { status: 'ready', stills: NO_STILLS }
    if (media.loading) return { status: 'loading' }
    return { status: 'ready', stills: pickEventStills(groupTrackMedia(media.gallery)) }
  }, [target.trackId, media.loading, media.gallery])
}
