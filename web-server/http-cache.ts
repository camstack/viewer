/**
 * HTTP caching and content negotiation for the hosted viewer PWA.
 *
 * Two cache classes, nothing in between:
 * - a CONTENT-HASHED file (its name changes when its bytes do) is cached for a
 *   year, `immutable` — the browser never asks again;
 * - everything else (the HTML shells, manifest.json, the well-known pair,
 *   icons) is `no-cache`: the browser keeps it but revalidates on every use
 *   with `If-None-Match`, and an unchanged file costs a body-less 304. A
 *   deploy is therefore picked up on the very next load.
 *
 * Erasable TypeScript only (Node 24 native type stripping).
 */
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { brotliCompress, constants as zlibConstants, gzip } from 'node:zlib'

export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'
export const REVALIDATE_CACHE = 'no-cache'

/** Directories whose every file is named by its content hash. */
const HASHED_PREFIXES: readonly string[] = [
  '/_expo/static/', // Expo/Metro bundles: `entry-<32 hex>.js`
  '/embed/assets/', // Vite (embed build): `index-<8 base64url>.js`
]

/** Expo's asset files: `name.<32 hex>[@2x].ext` (anywhere under /assets/). */
const HEX_HASHED_NAME = /\.[0-9a-f]{20,}(@[0-9.]+x)?\.[a-z0-9]+$/i

export function isContentHashed(path: string): boolean {
  if (HASHED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true
  const name = path.slice(path.lastIndexOf('/') + 1)
  return HEX_HASHED_NAME.test(name)
}

/** Text types worth compressing on the way out. */
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|manifest\+json|wasm)|image\/svg\+xml)/
/** Below this a compressed body saves less than the headers it costs. */
const MIN_COMPRESS_BYTES = 1024

export function isCompressible(contentType: string, byteLength: number): boolean {
  return byteLength > MIN_COMPRESS_BYTES && COMPRESSIBLE.test(contentType)
}

export type Encoding = 'br' | 'gzip'

const ETAG_SUFFIX: Readonly<Record<Encoding, string>> = { br: '-br', gzip: '-gz' }

/** A strong validator for the identity body: a quoted, truncated sha256. */
export function computeEtag(body: Buffer): string {
  return `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`
}

/** A strong ETag names exact bytes, so each encoding gets its own. */
export function etagFor(identityEtag: string, encoding: Encoding | null): string {
  return encoding === null ? identityEtag : `${identityEtag.slice(0, -1)}${ETAG_SUFFIX[encoding]}"`
}

/**
 * Does `If-None-Match` name this resource in ANY of its encodings? Weak
 * comparison (RFC 9110 §13.1.2): a `W/` prefix is ignored, and a client that
 * cached the gzip body may revalidate while asking for br — the resource did
 * not change, so it is still a 304.
 */
export function etagMatches(header: string | undefined, identityEtag: string): boolean {
  if (header === undefined) return false
  const candidates = new Set<string>([identityEtag, etagFor(identityEtag, 'br'), etagFor(identityEtag, 'gzip')])
  return header.split(',').some((raw) => {
    const tag = raw.trim()
    if (tag === '*') return true
    return candidates.has(tag.startsWith('W/') ? tag.slice(2) : tag)
  })
}

/** The compressed encodings the client accepts (`q=0` refuses one). */
export function acceptedEncodings(header: string | undefined): ReadonlySet<Encoding> {
  const accepted = new Set<Encoding>()
  if (header === undefined) return accepted
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';')
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
    if (q !== undefined && Number(q.slice(2)) === 0) continue
    if (name === 'br' || name === 'gzip') accepted.add(name)
  }
  return accepted
}

const brotliAsync = promisify(brotliCompress)
const gzipAsync = promisify(gzip)

/**
 * Both encodings of one body, computed off the event loop (libuv threadpool).
 * Brotli runs at maximum quality: the 7 MB entry bundle takes ~20 s there,
 * once per boot, and saves ~25 % over gzip for every visitor after.
 */
export async function compressBoth(body: Buffer): Promise<ReadonlyMap<Encoding, Buffer>> {
  const [br, gz] = await Promise.all([
    brotliAsync(body, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: body.byteLength,
      },
    }),
    gzipAsync(body, { level: 9 }),
  ])
  return new Map<Encoding, Buffer>([
    ['br', br],
    ['gzip', gz],
  ])
}
