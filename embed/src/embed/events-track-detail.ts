/**
 * events-track-detail — the pure half of the `?mode=track` page.
 *
 * `?mode=track&v=1&id=<trackId>&device=<deviceId>[&best=<bestEventId>]` opens
 * ONE track in isolation. The three identifiers are exactly what the events
 * embed posts on `trackClick`, so a host builds this URL from that message
 * without a lookup. Configuration (server, token or relay, theme, labels) is
 * the SAME three-source model as the events page — there is no second auth
 * path; this file only reads which track to show.
 */
import { absoluteMediaPath, withThumbVariant } from '../../../src/data/event-media-url'
import { parseMediaManifest, type MediaFileLite } from '../../../src/data/track-events'

export interface TrackDetailQuery {
  readonly trackId: string
  /** Null when the host did not name the device; the page then cannot ask the hub. */
  readonly deviceId: number | null
  readonly bestEventId: string | null
}

/** `null` when the URL does not ask for a track (no `id`). */
export function parseTrackDetailQuery(search: string): TrackDetailQuery | null {
  const params = new URLSearchParams(search)
  const trackId = params.get('id')?.trim() ?? ''
  if (trackId.length === 0) return null
  const rawDevice = params.get('device') ?? params.get('deviceId')
  const device = rawDevice !== null && /^\d+$/.test(rawDevice) ? Number(rawDevice) : null
  const best = params.get('best') ?? params.get('bestEventId')
  return {
    trackId,
    deviceId: device,
    bestEventId: best !== null && best.length > 0 ? best : null,
  }
}

/** Stored kinds that are moving pictures, never an `<img>`. */
function isClipKind(kind: string): boolean {
  return /clip|video/i.test(kind)
}

export interface TrackDetailMedia {
  readonly key: string
  readonly kind: string
  /** Absolute URL, bearer-fetched (or relay-authenticated). */
  readonly url: string
}

export interface TrackDetailMediaSet {
  /** Every stored still, one tile each, in manifest order. */
  readonly stills: readonly TrackDetailMedia[]
  /** The first stored clip, when the hub has one. */
  readonly clip: TrackDetailMedia | null
}

/** Strip tile edge requested from the plane (it clamps to 64-320). */
export const DETAIL_STRIP_THUMB_PX = 240

/**
 * Split a `listTrackMedia` answer into stills and a clip, with absolute URLs.
 * A row without its own `url` is dropped: this surface never reconstructs a
 * media address from an id (see `track-media-uri.ts`).
 */
export function selectTrackDetailMedia(raw: unknown, serverUrl: string): TrackDetailMediaSet {
  const files: readonly MediaFileLite[] = parseMediaManifest(raw)
  const stills: TrackDetailMedia[] = []
  let clip: TrackDetailMedia | null = null
  for (const f of files) {
    const abs = absoluteMediaPath(serverUrl, f.url)
    if (abs === null) continue
    const key = `${f.kind}:${f.mediaId ?? stills.length}`
    if (isClipKind(f.kind)) {
      if (clip === null) clip = { key, kind: f.kind, url: abs }
      continue
    }
    stills.push({ key, kind: f.kind, url: withThumbVariant(abs, DETAIL_STRIP_THUMB_PX) })
  }
  return { stills, clip }
}

/** `h:mm:ss`-free duration: `12 s`, `3 min 4 s`. */
export function formatTrackSpan(firstSeen: number, lastSeen: number): string {
  const secs = Math.max(0, Math.round((lastSeen - firstSeen) / 1000))
  if (secs < 60) return `${secs} s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return s === 0 ? `${m} min` : `${m} min ${s} s`
}
