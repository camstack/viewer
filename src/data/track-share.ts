/**
 * track-share — pure helpers for the track-detail SHARE actions.
 *
 * A "private link" is an authenticated deep link into the viewer: it carries no
 * secret, it just names the event/track. Whoever opens it in an authenticated
 * CamStack app lands on the events tab with the detail open; an unauthenticated
 * app shows login first. The app scheme (`camstack://` / `camstack.dev://`) is
 * resolved at call-time by `expo-linking` `createURL(path, { queryParams })`, so
 * this module stays a PURE builder of the `(path, queryParams)` pair it is given.
 *
 * NOTE: there is deliberately NO public (unauthenticated tokenized) link here.
 * The hub's only share primitive is a share-view token (`auth.mintToken`
 * with a `grid-view` / `events-view` grant); it cannot scope to a
 * single event/track/media, and no unauthenticated route serves shared media by
 * token. A public single-event link needs a new server share-scope member — see
 * the task report. Until then the public affordance is a native OS share of the
 * image FILE itself ({@link ../lib/share-image.ts}).
 */

import type { TrackSummary } from './track-events.js'

/** The deep-link target for a track: the events route + the params the events
 *  screen reads to reopen the detail. */
export interface TrackShareTarget {
  readonly path: string
  readonly queryParams: Readonly<Record<string, string>>
}

/**
 * The `(path, queryParams)` an authenticated deep link to `track` should encode.
 * Consumed by the events screen via `useLocalSearchParams` to reopen the detail.
 * Pure — unit-tested; the actual URL is built by `Linking.createURL(target.path,
 * { queryParams: target.queryParams })`.
 */
export function trackShareTarget(track: TrackSummary): TrackShareTarget {
  return {
    path: '/events',
    queryParams: {
      trackId: track.trackId,
      deviceId: String(track.deviceId),
      ts: String(track.firstSeen),
    },
  }
}

/** A short, filesystem-safe basename for a shared media file. Pure. */
export function shareImageFilename(track: TrackSummary, kind: string): string {
  const safeKind = kind.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  const safeTrack = track.trackId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  return `camstack-${safeTrack}-${safeKind}`
}
