/**
 * events-media-url — URLs for the pipeline-analytics event-media data plane.
 *
 * `/addon/pipeline-analytics/event-media/o/track/<trackId>` asks the server's
 * "best media of this owner" resolver ladder for a track (D482). The bare
 * `/addon/pipeline-analytics/event-media/<id>` form this used to build is
 * GONE and 404s: after D474 every event table numbers its rows from 1
 * independently, so a bare id can no longer say which table (or a media row)
 * it names — an owner is `(table, id)`, and `EventsTrackRow.trackId` is
 * always present (never the polymorphic `bestEventId`), so this never has to
 * guess. Events ask for the pre-generated rectangular `thumbnailSmall`;
 * `variant=thumb&size=N` remains in the URL so older tracks without that kind
 * get a bounded square fallback rather than their native-resolution source.
 *
 * `kind=thumbnailSmall` selects the track's rectangular square-safe crop. The
 * complete image works in cluster cards; square Events cards use its central
 * square via CSS `object-fit: cover`, without another stored copy or encoding.
 *
 * Pure — no window, no fetch. The bytes are fetched by `use-authed-image.ts`,
 * which has to carry the bearer token the plane requires.
 */

/** Hub-proxied path prefix. Mirrors the addon's `eventMediaBaseUrl`
 *  (`/addon/<addonId>/event-media`, addonId = `pipeline-analytics`). */
export const EVENT_MEDIA_PATH = '/addon/pipeline-analytics/event-media'

/** Path segment that introduces an OWNER question ("best media of"), D482. */
const MEDIA_OWNER_SEGMENT = 'o'

/** The plane's own clamp on the square edge. Mirrored so the URL never asks for
 *  a size it will not get — two different asks for the same rendering would be
 *  two cache entries for identical bytes. */
const THUMB_MIN_SIZE = 64
const THUMB_MAX_SIZE = 320

function trimTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, '')
}

/** Clamp a requested square edge into the plane's accepted range. */
export function clampThumbSize(size: number): number {
  const n = Math.round(size)
  if (!Number.isFinite(n)) return THUMB_MIN_SIZE
  return Math.max(THUMB_MIN_SIZE, Math.min(THUMB_MAX_SIZE, n))
}

/**
 * Absolute square-thumbnail URL for a track, resolved by the server against
 * its OWN owner form (`/o/track/<trackId>`, D482) — never the track's
 * `bestEventId`, which is a polymorphic pointer and not an address.
 */
export function buildTrackThumbUrl(serverUrl: string, trackId: string, sizePx: number): string {
  const base = trimTrailingSlashes(serverUrl)
  const ownerId = encodeURIComponent(trackId)
  return `${base}${EVENT_MEDIA_PATH}/${MEDIA_OWNER_SEGMENT}/track/${ownerId}?kind=thumbnailSmall&variant=thumb&size=${clampThumbSize(sizePx)}`
}
