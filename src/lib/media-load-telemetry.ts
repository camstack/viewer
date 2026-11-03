/**
 * Thumbnail load outcomes of the reel and the gallery, as ONE line per burst.
 *
 * ## Why this exists
 *
 * Every reel card showed the broken-image icon (camstack/server#14) and the
 * viewer said nothing: `TileHero`'s `onError` only swaps the icon in. With no
 * line, "the hub refused the request", "the host is unreachable from this
 * page" and "the bytes are not an image" were the same silence.
 *
 * ## Shape
 *
 * Same pattern as `clips/clip-telemetry.ts`: a screen of 60 cards settles in a
 * burst, so each surface keeps a burst tally and cumulative totals since launch
 * and flushes one `events:media` line after a quiet moment. All failures and no
 * success is `warn` (the surface is broken); anything else is `info`.
 *
 * ## What never leaves the device
 *
 * Not the URL: it can carry a query token, and the bearer is a header. The
 * line carries the host, the path SHAPE (ids replaced by `:id`), the `kind`
 * query value, and whether a bearer was passed. Error messages have any URL
 * scrubbed and are truncated.
 */
import { log } from './logger.js'

export const MEDIA_LOAD_QUIET_MS = 1_500
const MAX_ERRORS = 3
const MAX_ERROR_CHARS = 120

export type MediaSurface = 'reel' | 'gallery'

export interface MediaLoadSample {
  readonly surface: MediaSurface
  readonly ok: boolean
  /** The request URL. Only its host, path shape and `kind` are ever read out. */
  readonly uri: string | null
  readonly hasBearer: boolean
  /** The `expo-image` error message, on failure. */
  readonly error?: string
  readonly deviceId?: number
  /** `window.location.origin` on web; null/absent on native. */
  readonly pageOrigin?: string | null
}

interface Tally {
  ok: number
  failed: number
}

interface Burst extends Tally {
  host: string | null
  path: string | null
  kind: string | null
  sameOrigin: boolean | null
  bearer: boolean
  deviceId: number | null
  errors: string[]
}

interface Area {
  burst: Burst
  total: Tally
  timer: ReturnType<typeof setTimeout> | null
}

function emptyBurst(): Burst {
  return { ok: 0, failed: 0, host: null, path: null, kind: null, sameOrigin: null, bearer: false, deviceId: null, errors: [] }
}

const AREAS: Readonly<Record<MediaSurface, Area>> = {
  reel: { burst: emptyBurst(), total: { ok: 0, failed: 0 }, timer: null },
  gallery: { burst: emptyBurst(), total: { ok: 0, failed: 0 }, timer: null },
}

const URL_PARTS = /^(https?:)\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?/i

export interface MediaUrlShape {
  readonly host: string
  readonly origin: string
  readonly path: string
  readonly kind: string | null
}

/** Host, path shape and kind of a media URL — nothing that can authenticate. */
export function shapeMediaUrl(uri: string): MediaUrlShape | null {
  const m = URL_PARTS.exec(uri)
  if (m === null) return null
  const [, scheme = '', host = '', rawPath = '', query = ''] = m
  const path = rawPath
    .split('/')
    .map((seg) => (/\d/.test(seg) ? ':id' : seg))
    .join('/')
  const kindMatch = /(?:^|&)kind=([\w-]{1,24})(?:&|$)/.exec(query)
  return { host, origin: `${scheme.toLowerCase()}//${host}`, path, kind: kindMatch?.[1] ?? null }
}

function scrubError(message: string): string {
  return message.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>').slice(0, MAX_ERROR_CHARS)
}

function flush(surface: MediaSurface): void {
  const area = AREAS[surface]
  area.timer = null
  const b = area.burst
  area.burst = emptyBurst()
  const data = {
    surface,
    ok: b.ok,
    failed: b.failed,
    host: b.host,
    sameOrigin: b.sameOrigin,
    path: b.path,
    kind: b.kind,
    bearer: b.bearer,
    errors: b.errors,
    sinceLaunch: { ...area.total },
    ...(b.deviceId !== null ? { deviceId: b.deviceId } : {}),
  }
  const msg = `${surface} thumbnails`
  if (b.failed > 0 && b.ok === 0) log.warn('events:media', msg, data)
  else log.info('events:media', msg, data)
}

/** One thumbnail settled (`onLoad` or `onError`). */
export function noteMediaLoad(sample: MediaLoadSample): void {
  const area = AREAS[sample.surface]
  const b = area.burst
  const key = sample.ok ? 'ok' : 'failed'
  b[key] += 1
  area.total[key] += 1
  // The first FAILING sample describes the burst; before one arrives, the first success does.
  const describes = sample.ok ? b.host === null : b.failed === 1
  if (describes) {
    const shape = sample.uri === null ? null : shapeMediaUrl(sample.uri)
    if (shape !== null) {
      b.host = shape.host
      b.path = shape.path
      b.kind = shape.kind
      b.sameOrigin = sample.pageOrigin ? sample.pageOrigin === shape.origin : null
    }
    b.bearer = sample.hasBearer
    if (sample.deviceId !== undefined) b.deviceId = sample.deviceId
  }
  if (!sample.ok && sample.error) {
    const msg = scrubError(sample.error)
    if (b.errors.length < MAX_ERRORS && !b.errors.includes(msg)) b.errors.push(msg)
  }
  if (area.timer !== null) clearTimeout(area.timer)
  area.timer = setTimeout(() => flush(sample.surface), MEDIA_LOAD_QUIET_MS)
}

/** Test seam: drop every pending flush and every count. */
export function resetMediaLoadTelemetry(): void {
  for (const surface of ['reel', 'gallery'] as const) {
    const area = AREAS[surface]
    if (area.timer !== null) clearTimeout(area.timer)
    area.timer = null
    area.burst = emptyBurst()
    area.total = { ok: 0, failed: 0 }
  }
}
