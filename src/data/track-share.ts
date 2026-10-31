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
 * The PUBLIC link (`buildPublicLink`) is the hub's public web viewer URL for the
 * same target; its origin is the hub's `roles.publicEndpoint`, read from the hub.
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

/** Where the hub mounts the web viewer, under its public address. */
export const WEB_VIEWER_BASE_PATH = '/viewer/camstack'

/**
 * The browser-openable URL for `target`: the hub's public address, the web
 * viewer base, the same path and query the app link carries. `null` when the
 * hub has no public address (the caller shows the entry disabled, never a
 * guessed origin). Pure.
 */
export function buildPublicLink(
  publicEndpoint: string | null,
  target: TrackShareTarget,
): string | null {
  if (publicEndpoint === null) return null
  const origin = publicEndpoint.trim().replace(/\/+$/, '')
  if (origin.length === 0) return null
  const path = target.path.startsWith('/') ? target.path : `/${target.path}`
  const query = new URLSearchParams(target.queryParams).toString()
  return `${origin}${WEB_VIEWER_BASE_PATH}${path}${query.length > 0 ? `?${query}` : ''}`
}
