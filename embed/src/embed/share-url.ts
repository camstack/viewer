/**
 * share-url — the CANONICAL grid share-URL schema (v1): zod schema + pure
 * encode/decode for the STANDALONE share link of the grid embed.
 *
 * A share link is:
 *   <serverUrl>/viewer/camstack/embed/index.html?mode=grid&v=1&devices=1,5,9
 *     &layout=auto&q=auto&names=0[&audio=1,5][&activeOnly=1][&boxes=1]
 *     [&hl=<base64url JSON>]
 *   #t=<share token — a minted token whose only scope is a share-view grant>
 *
 * The auth token travels in the FRAGMENT (`#t=…`), never the query string, so
 * it is never sent to the server → no token in hub access logs, reverse-proxy
 * logs, or referrers. `serverUrl` is NOT encoded at all: standalone mode
 * derives it from `location.origin` (the embed is always served by the hub).
 *
 * `hl` is base64url-encoded JSON (not exploded params) because the highlight
 * object is nested (appearance colors, class arrays) and already has a zod
 * schema to validate the decoded value; everything flat stays human-readable.
 * `v` gates parsing: an unknown version is an explicit error, never a guess.
 *
 * Pure: no window/history access — callers pass `location.search` /
 * `location.hash` strings. The base64url codec is hand-rolled (no
 * btoa/Buffer/TextEncoder) so the SAME file runs in browsers, jsdom and
 * React-Native Hermes.
 */
import { z } from 'zod'
import { VIEWER_EMBED_PATH } from '../../../shared/embed-path'

/** Version stamped into (`v=`) and required from every standalone share URL. */
export const SHARE_URL_VERSION = 1

/** Server-hosted Viewer path of the embed bundle. */
export const GRID_EMBED_PATH = VIEWER_EMBED_PATH

/**
 * Stream-quality presets a share link can freeze (`q=`).
 *
 * The system enum plus `auto` — see `embed-grid-config.ts`. `medium` was
 * retired on 2026-09-02, and a link already in someone's hands may still carry
 * it: the decoder normalises an unrecognised `q` to `auto` rather than failing
 * the whole link, because the operator ruled out migrating persisted values and
 * a shared link is the one place a stale value cannot be rewritten.
 */
export const shareQualitySchema = z.enum(['auto', 'high', 'mid', 'low'])
export type ShareQuality = z.infer<typeof shareQualitySchema>

/** Wall layout (`layout=`): 'auto' (area-maximizing) or a fixed column count. */
export const shareLayoutSchema = z.union([z.literal('auto'), z.number().int().min(1)])
export type ShareLayout = z.infer<typeof shareLayoutSchema>

/** Highlight config carried in `hl=` (base64url JSON). Mirrors the embed's
 *  `gridHighlightSchema` — `enabled` is the master toggle, the rest are the
 *  per-grid triggers + optional global border appearance. */
export const shareHighlightSchema = z.object({
  enabled: z.boolean(),
  motion: z.boolean(),
  audio: z.enum(['off', 'sensor', 'level']),
  audioDb: z.number(),
  audioHoldSec: z.number(),
  detection: z.boolean(),
  detectionHoldSec: z.number(),
  /** Macro classes that trigger the detection highlight; empty/absent = any. */
  detectionClasses: z.array(z.string()).optional(),
  /** Border appearance (global) — color per type + thickness. Absent = defaults. */
  appearance: z
    .object({
      motionColor: z.string(),
      audioColor: z.string(),
      detectionColor: z.string(),
      thickness: z.number(),
    })
    .optional(),
})
export type ShareHighlight = z.infer<typeof shareHighlightSchema>

/** Everything a share link freezes besides the token: the v1 param set. */
export const gridShareParamsSchema = z.object({
  /** Ordered device ids shown by the shared grid (`devices=` csv). */
  devices: z.array(z.number().int().nonnegative()).min(1),
  layout: shareLayoutSchema,
  quality: shareQualitySchema,
  /** Overlay the camera name on each tile (`names=0|1`). */
  showName: z.boolean(),
  /** Device ids whose audio starts ON (`audio=` csv; optional). */
  audioOnIds: z.array(z.number().int().nonnegative()).optional(),
  /** Show only currently-active cameras (`activeOnly=1`; optional). */
  activeOnly: z.boolean().optional(),
  /** Live detection bounding-box overlay on every tile (`boxes=1`; optional). */
  boxes: z.boolean().optional(),
  /** Frozen highlight config (`hl=`; optional). */
  highlight: shareHighlightSchema.optional(),
})
export type GridShareParams = z.infer<typeof gridShareParamsSchema>

export type GridShareDecodeResult =
  | { readonly ok: true; readonly params: GridShareParams; readonly token: string | null }
  | { readonly ok: false; readonly error: string }

// ── base64url codec (portable: browser + jsdom + Hermes, no globals) ─────────

const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function utf8Encode(text: string): number[] {
  const bytes: number[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    if (cp === undefined) continue
    if (cp <= 0x7f) bytes.push(cp)
    else if (cp <= 0x7ff) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    else if (cp <= 0xffff)
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    else
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      )
  }
  return bytes
}

function utf8Decode(bytes: readonly number[]): string | null {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b0 = bytes[i]
    if (b0 === undefined) return null
    let cp: number
    let extra: number
    if (b0 < 0x80) {
      cp = b0
      extra = 0
    } else if ((b0 & 0xe0) === 0xc0) {
      cp = b0 & 0x1f
      extra = 1
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = b0 & 0x0f
      extra = 2
    } else if ((b0 & 0xf8) === 0xf0) {
      cp = b0 & 0x07
      extra = 3
    } else {
      return null
    }
    for (let k = 1; k <= extra; k++) {
      const b = bytes[i + k]
      if (b === undefined || (b & 0xc0) !== 0x80) return null
      cp = (cp << 6) | (b & 0x3f)
    }
    i += extra + 1
    out += String.fromCodePoint(cp)
  }
  return out
}

/** JSON-stringify + base64url-encode (no padding). Deterministic for a given
 *  key order, so encode/decode round-trips byte-identically across repos. */
export function encodeBase64UrlJson(value: unknown): string {
  const bytes = utf8Encode(JSON.stringify(value))
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += B64URL_ALPHABET.charAt(b0 >> 2)
    out += B64URL_ALPHABET.charAt(((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4))
    if (b1 !== undefined) out += B64URL_ALPHABET.charAt(((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6))
    if (b2 !== undefined) out += B64URL_ALPHABET.charAt(b2 & 0x3f)
  }
  return out
}

/** Reverse of {@link encodeBase64UrlJson}. Returns `null` for any malformed
 *  input (bad chars, bad length, bad UTF-8, bad JSON) — never throws. */
export function decodeBase64UrlJson(text: string): unknown | null {
  if (text.length % 4 === 1) return null
  const values: number[] = []
  for (const ch of text) {
    const v = B64URL_ALPHABET.indexOf(ch)
    if (v < 0) return null
    values.push(v)
  }
  const bytes: number[] = []
  for (let i = 0; i < values.length; i += 4) {
    const v0 = values[i]
    const v1 = values[i + 1]
    if (v0 === undefined || v1 === undefined) return null
    const v2 = values[i + 2]
    const v3 = values[i + 3]
    bytes.push((v0 << 2) | (v1 >> 4))
    if (v2 !== undefined) bytes.push(((v1 & 0x0f) << 4) | (v2 >> 2))
    if (v3 !== undefined && v2 !== undefined) bytes.push(((v2 & 0x03) << 6) | v3)
  }
  const json = utf8Decode(bytes)
  if (json === null) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

// ── encode ────────────────────────────────────────────────────────────────────

/** Serialize the v1 params into the query string (no leading `?`, no token).
 *  Hand-assembled (not URLSearchParams) so csv commas stay literal — every
 *  value is schema-constrained to URL-safe characters. */
export function encodeGridShareQuery(params: GridShareParams): string {
  const parts: string[] = [
    'mode=grid',
    `v=${SHARE_URL_VERSION}`,
    `devices=${params.devices.join(',')}`,
    `layout=${params.layout}`,
    `q=${params.quality}`,
    `names=${params.showName ? '1' : '0'}`,
  ]
  if (params.audioOnIds !== undefined && params.audioOnIds.length > 0) {
    parts.push(`audio=${params.audioOnIds.join(',')}`)
  }
  if (params.activeOnly === true) parts.push('activeOnly=1')
  if (params.boxes === true) parts.push('boxes=1')
  if (params.highlight !== undefined) parts.push(`hl=${encodeBase64UrlJson(params.highlight)}`)
  return parts.join('&')
}

/** Build the full standalone share URL: embed path + query + `#t=` fragment. */
export function buildGridShareUrl(
  serverUrl: string,
  params: GridShareParams,
  token: string,
): string {
  const base = serverUrl.replace(/\/+$/, '')
  return `${base}${GRID_EMBED_PATH}?${encodeGridShareQuery(params)}#t=${encodeURIComponent(token)}`
}

// ── decode ────────────────────────────────────────────────────────────────────

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

/** Read the share token from the URL fragment (`#t=…`). Null when absent/empty. */
export function readShareToken(hash: string): string | null {
  const params = new URLSearchParams(stripPrefix(hash, '#'))
  const token = params.get('t')
  return token !== null && token.length > 0 ? token : null
}

/** True when the URL LOOKS like a share link (has `v=` or a `#t=` token) —
 *  i.e. decoding should be attempted and its errors surfaced, instead of
 *  falling back to the host-config error. */
export function isShareUrl(search: string, hash: string): boolean {
  return new URLSearchParams(stripPrefix(search, '?')).has('v') || readShareToken(hash) !== null
}

function parseIdCsv(raw: string): readonly number[] | null {
  if (raw.length === 0) return null
  const out: number[] = []
  for (const part of raw.split(',')) {
    if (!/^\d+$/.test(part)) return null
    out.push(Number(part))
  }
  return out
}

function decodeError(error: string): GridShareDecodeResult {
  return { ok: false, error }
}

/** Parse a standalone share URL's `search` + `hash` into validated params +
 *  token. Distinct errors for: wrong mode, missing/unsupported version, bad
 *  devices, bad flat params, bad `hl`. A missing token is NOT an error here —
 *  it decodes to `token: null` (the consumer decides how to surface it). */
export function decodeGridShareUrl(search: string, hash: string): GridShareDecodeResult {
  const q = new URLSearchParams(stripPrefix(search, '?'))

  const mode = q.get('mode')
  if (mode !== null && mode !== 'grid') return decodeError(`unsupported mode "${mode}"`)

  const v = q.get('v')
  if (v === null) return decodeError('missing share-link version (v)')
  if (v !== String(SHARE_URL_VERSION)) return decodeError(`unsupported share-link version "${v}"`)

  const devicesRaw = q.get('devices')
  const devices = devicesRaw === null ? null : parseIdCsv(devicesRaw)
  if (devices === null || devices.length === 0) {
    return decodeError('invalid or missing devices list')
  }

  const layoutRaw = q.get('layout')
  let layout: ShareLayout
  if (layoutRaw === null || layoutRaw === 'auto') {
    layout = 'auto'
  } else if (/^\d+$/.test(layoutRaw) && Number(layoutRaw) >= 1) {
    layout = Number(layoutRaw)
  } else {
    return decodeError(`invalid layout "${layoutRaw}"`)
  }

  // A `q=` this build no longer knows (`medium`, retired 2026-09-02) is NOT a
  // broken link: the tier is one frozen preference out of a dozen, and refusing
  // the link over it would take the whole shared wall down with it. Normalised
  // to the default, exactly as the embed config does.
  const qualityRaw = q.get('q') ?? 'auto'
  const qualityParsed = shareQualitySchema.safeParse(qualityRaw)
  const quality: ShareQuality = qualityParsed.success ? qualityParsed.data : 'auto'

  const namesRaw = q.get('names') ?? '0'
  if (namesRaw !== '0' && namesRaw !== '1') return decodeError(`invalid names flag "${namesRaw}"`)

  const audioRaw = q.get('audio')
  let audioOnIds: readonly number[] | undefined
  if (audioRaw !== null) {
    const parsed = parseIdCsv(audioRaw)
    if (parsed === null) return decodeError(`invalid audio list "${audioRaw}"`)
    audioOnIds = parsed
  }

  const activeOnlyRaw = q.get('activeOnly')
  if (activeOnlyRaw !== null && activeOnlyRaw !== '0' && activeOnlyRaw !== '1') {
    return decodeError(`invalid activeOnly flag "${activeOnlyRaw}"`)
  }
  const activeOnly = activeOnlyRaw === '1'

  const boxesRaw = q.get('boxes')
  if (boxesRaw !== null && boxesRaw !== '0' && boxesRaw !== '1') {
    return decodeError(`invalid boxes flag "${boxesRaw}"`)
  }
  const boxes = boxesRaw === '1'

  const hlRaw = q.get('hl')
  let highlight: ShareHighlight | undefined
  if (hlRaw !== null) {
    const decoded = decodeBase64UrlJson(hlRaw)
    const parsed = shareHighlightSchema.safeParse(decoded)
    if (decoded === null || !parsed.success) return decodeError('invalid highlight config (hl)')
    highlight = parsed.data
  }

  const candidate = {
    devices: [...devices],
    layout,
    quality,
    showName: namesRaw === '1',
    ...(audioOnIds !== undefined && audioOnIds.length > 0 ? { audioOnIds: [...audioOnIds] } : {}),
    ...(activeOnly ? { activeOnly: true } : {}),
    ...(boxes ? { boxes: true } : {}),
    ...(highlight !== undefined ? { highlight } : {}),
  }
  const params = gridShareParamsSchema.safeParse(candidate)
  if (!params.success) {
    return decodeError(
      params.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    )
  }
  return { ok: true, params: params.data, token: readShareToken(hash) }
}
