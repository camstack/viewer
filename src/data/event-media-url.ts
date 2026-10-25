/**
 * event-media-url — build absolute URLs for the pipeline-analytics event-media
 * HTTP data-plane (served by the hub reverse-proxy).
 *
 * The server stamps a RELATIVE `mediaUrl` (`/addon/pipeline-analytics/event-media/m/<mediaId>`)
 * on slim event rows. Native (iOS/Android) `expo-image` needs an ABSOLUTE URL,
 * so we prefix the connected hub base (`system.serverUrl`). The route serves the
 * full stored blob by default and a small center-cropped SQUARE thumbnail when
 * `?variant=thumb[&size=N]` is present — the reel / list surfaces request the
 * thumb (≈6 KB @160px vs ≈34 KB for the full 640×360 crop).
 *
 * ## Two addresses (D482)
 *
 * A media row used to be addressed by a composite key
 * (`<ownerType>:<ownerId>:<fileKind>[:<timestampMs>]`) that embedded a FOREIGN
 * id — after D474 gave every event table its own rowid numbering, `motion:5`
 * and `object:5` named two different rows. The plane now exposes two
 * DIFFERENT questions instead of one ambiguous id:
 *
 *   - {@link buildMediaIdUrl} — "this exact media row", by its OWN id
 *     (`/m/<mediaId>`). This is what every wire row's own `url` field already
 *     points at — prefer that field over calling this builder yourself.
 *   - {@link buildMediaOwnerUrl} — "the best media OF this owner"
 *     (`/o/<ownerType>/<ownerId>`), for a caller that holds a track/event id
 *     and no media row at all (the list/reel/timeline surfaces). `ownerType`
 *     is REQUIRED — an owner is `(table, id)` and half of it is not a
 *     question.
 *
 * The bare `<prefix>/<id>` form is GONE and 404s. The owner id IS
 * percent-encoded by {@link buildMediaOwnerUrl} (it is an arbitrary row key,
 * e.g. a summary mosaic's `summary-<ruleId>-<windowEndMs>`, and one slash in
 * it would silently re-cut the path); the hub's reverse-proxy percent-DECODES
 * the path before the addon's data-plane handler sees it, so this is correct
 * and safe. A `mediaId` needs no encoding — a decimal integer has nothing to
 * encode.
 *
 * Pure + side-effect-free (no React). Unit-tested in
 * `__tests__/event-media-url.spec.ts`.
 */

import type { MediaOwnerType } from '@camstack/types'

/** The hub-proxied path prefix for pipeline-analytics event media. Mirrors the
 *  server's `eventMediaBaseUrl` (`/addon/<addonId>/event-media`, addonId =
 *  `pipeline-analytics`). */
export const EVENT_MEDIA_PATH = '/addon/pipeline-analytics/event-media'

/** Path segment that introduces a media-row ADDRESS (`/m/<mediaId>`). Mirrors
 *  the server's `MEDIA_ID_SEGMENT` (`media-file-url.ts`). */
export const MEDIA_ID_SEGMENT = 'm'

/** Path segment that introduces an OWNER question ("best media of"). Mirrors
 *  the server's `MEDIA_OWNER_SEGMENT`. */
export const MEDIA_OWNER_SEGMENT = 'o'

export interface EventMediaUrlOptions {
  /** Request the small center-cropped SQUARE thumbnail. Omit for the full blob. */
  readonly variant?: 'thumb'
  /** Square edge in px (server clamps to [64, 320]); omit for the 160px default.
   *  Only meaningful with `variant: 'thumb'`. */
  readonly size?: number
  /** Force a specific stored media kind (e.g. `'crop'`). The server serves that
   *  kind and, when absent, a CLEAN fallback frame — never a boxed one. The reel
   *  requests it WITH the thumb variant (square tile); the timeline requests it
   *  WITHOUT (the full 640×360 crop, 16:9). */
  readonly kind?: string
}

/** @deprecated legacy alias — use {@link EventMediaUrlOptions}. */
export type ThumbVariant = EventMediaUrlOptions

function trimTrailingSlashes(s: string): string {
  return s.replace(/\/+$/, '')
}

function mediaQuery(opts: EventMediaUrlOptions): string {
  const parts: string[] = []
  if (opts.variant === 'thumb') {
    parts.push('variant=thumb')
    if (opts.size !== undefined) parts.push(`size=${Math.round(opts.size)}`)
  }
  if (opts.kind !== undefined && opts.kind.length > 0) parts.push(`kind=${encodeURIComponent(opts.kind)}`)
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

/**
 * Absolute URL for ONE media row, by its OWN id (`/m/<mediaId>`, D482).
 *
 * Prefer a row's own `url` field (`MediaFileInfo.url` / `MediaFile.url`,
 * always present) over calling this — build a path yourself only when you
 * have no row, just a numeric id.
 */
export function buildMediaIdUrl(serverUrl: string, mediaId: number, opts?: EventMediaUrlOptions): string {
  const base = trimTrailingSlashes(serverUrl)
  const query = opts ? mediaQuery(opts) : ''
  return `${base}${EVENT_MEDIA_PATH}/${MEDIA_ID_SEGMENT}/${mediaId}${query}`
}

/**
 * Absolute URL for "the best media of this owner" (`/o/<ownerType>/<ownerId>`,
 * D482) — a resolver ladder the server runs, for a caller that holds a
 * track/event id and no media row of its own. `ownerType` is REQUIRED: an
 * owner is `(table, id)`, never a bare id — see the module docblock.
 */
export function buildMediaOwnerUrl(
  serverUrl: string,
  ownerType: MediaOwnerType,
  ownerId: string,
  opts?: EventMediaUrlOptions,
): string {
  const base = trimTrailingSlashes(serverUrl)
  const query = opts ? mediaQuery(opts) : ''
  return `${base}${EVENT_MEDIA_PATH}/${MEDIA_OWNER_SEGMENT}/${ownerType}/${encodeURIComponent(ownerId)}${query}`
}

/**
 * Append the thumb variant query to an ALREADY-STAMPED `mediaUrl` (relative or
 * absolute) without touching its path. Used when the server already provided a
 * `mediaUrl` (or a row's own `url`) and we only want the small square
 * rendering of it.
 */
export function withThumbVariant(mediaUrl: string, size?: number): string {
  const sep = mediaUrl.includes('?') ? '&' : '?'
  const sizePart = size !== undefined ? `&size=${Math.round(size)}` : ''
  return `${mediaUrl}${sep}variant=thumb${sizePart}`
}

/**
 * Join a hub-relative crop/media path (or an already-absolute URL) to the
 * connected server origin. `data:` URIs pass through. Null when there is
 * nothing to render or no origin to join a relative path against.
 */
export function absoluteMediaPath(serverUrl: string | null, pathOrUrl: string | undefined): string | null {
  if (pathOrUrl === undefined || pathOrUrl.length === 0) return null
  if (pathOrUrl.startsWith('data:') || /^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  if (serverUrl === null || serverUrl.length === 0) return null
  const base = trimTrailingSlashes(serverUrl)
  return pathOrUrl.startsWith('/') ? `${base}${pathOrUrl}` : `${base}/${pathOrUrl}`
}
