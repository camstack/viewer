/**
 * The production server for the hosted viewer PWA (https://camstack.zentik.app).
 *
 * Serves the static web export (`dist/`, built with base path `/`), the SPA
 * fallback, the Universal/App Link pair and `/health`. It talks to no hub:
 * the PWA calls the operator's hub DIRECTLY from the browser (bearer token,
 * CORS on the hub side), so this process holds no state and no secret.
 *
 * Runs on Node 24's native type stripping (`node web-server/server.ts`): erasable
 * syntax only — `import type`, no enums, no parameter properties.
 *
 * `dist/` is read ONCE at boot into a Map keyed by URL path, so a request never
 * reaches the filesystem and no path can traverse out of it. Query strings are
 * never logged: they carry the hub URL (`?hub=`).
 */
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { buildAppLinkFiles, parseCertFingerprints } from './app-links.ts'
import {
  IMMUTABLE_CACHE,
  REVALIDATE_CACHE,
  acceptedEncodings,
  compressBoth,
  computeEtag,
  etagFor,
  etagMatches,
  isCompressible,
  isContentHashed,
} from './http-cache.ts'
import type { Encoding } from './http-cache.ts'

export const AASA_PATH = '/.well-known/apple-app-site-association'
/** Pre-iOS-9.3 clients fetched the AASA from the root. */
export const AASA_LEGACY_PATH = '/apple-app-site-association'
export const ASSETLINKS_PATH = '/.well-known/assetlinks.json'
const INDEX_PATH = '/index.html'

/** Apple wants a bare application/json on the AASA — no charset parameter. */
const WELL_KNOWN_TYPE = 'application/json'
const JSON_TYPE = 'application/json; charset=utf-8'

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': JSON_TYPE,
  '.map': JSON_TYPE,
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
}

interface Asset {
  readonly body: Buffer
  readonly contentType: string
  /** Strong validator of the identity body. */
  readonly etag: string
  /** Compressed bodies, filled in the background after boot (a cache). */
  readonly encoded: Map<Encoding, Buffer>
}

function makeAsset(body: Buffer, contentType: string): Asset {
  return { body, contentType, etag: computeEtag(body), encoded: new Map() }
}

/** Every compressible asset's br + gzip, off the event loop. Until an asset's
 *  pair lands, a gzip request is answered by a one-off synchronous gzip. */
async function precompress(assets: Iterable<Asset>): Promise<void> {
  const pending = [...assets].filter((asset) => isCompressible(asset.contentType, asset.body.byteLength))
  await Promise.all(
    pending.map(async (asset) => {
      const both = await compressBoth(asset.body)
      for (const [encoding, buffer] of both) asset.encoded.set(encoding, buffer)
    }),
  )
}

export interface WebServerOptions {
  /** The static export to serve. Defaults to `<repo>/dist`. */
  readonly distDir?: string
  /** Defaults to `CAMSTACK_ANDROID_CERT_SHA256`. */
  readonly certFingerprints?: readonly string[]
  /** Resolve only once every br/gzip body is ready (tests). Production boots
   *  at once and compresses in the background. */
  readonly awaitPrecompression?: boolean
}

function log(level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), level, message, ...fields })}\n`)
}

async function walk(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return walk(full)
      return entry.isFile() ? [full] : []
    }),
  )
  return nested.flat()
}

/** Every file under `distDir`, keyed by the URL path that serves it. */
export async function loadAssets(distDir: string): Promise<ReadonlyMap<string, Asset>> {
  const files = await walk(distDir)
  const assets = new Map<string, Asset>()
  for (const file of files) {
    const urlPath = `/${relative(distDir, file).split(sep).join('/')}`
    const contentType = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
    assets.set(urlPath, makeAsset(await readFile(file), contentType))
  }
  if (!assets.has(INDEX_PATH)) throw new Error(`index.html is missing from ${distDir} — run npm run build:web`)
  return assets
}

interface SendInput {
  readonly status: number
  readonly contentType: string
  readonly body: Buffer
  readonly cacheControl: string
  readonly headOnly: boolean
  readonly encoding?: Encoding | null
  readonly etag?: string
  /** The representation depends on Accept-Encoding. */
  readonly varies?: boolean
}

function send(res: ServerResponse, input: SendInput): void {
  const notModified = input.status === 304
  res.writeHead(input.status, {
    ...(notModified ? {} : { 'content-type': input.contentType, 'content-length': input.body.byteLength }),
    'cache-control': input.cacheControl,
    ...(input.etag !== undefined ? { etag: input.etag } : {}),
    ...(input.encoding ? { 'content-encoding': input.encoding } : {}),
    ...(input.varies ? { vary: 'Accept-Encoding' } : {}),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'SAMEORIGIN',
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
  })
  res.end(input.headOnly || notModified ? undefined : input.body)
}

interface Representation {
  readonly body: Buffer
  readonly encoding: Encoding | null
}

/** br if accepted and ready, else gzip (made now if the background pass has
 *  not reached this asset yet), else the identity body. */
function negotiate(req: IncomingMessage, asset: Asset): Representation {
  if (!isCompressible(asset.contentType, asset.body.byteLength)) return { body: asset.body, encoding: null }
  const accepted = acceptedEncodings(req.headers['accept-encoding'])
  const br = asset.encoded.get('br')
  if (accepted.has('br') && br !== undefined) return { body: br, encoding: 'br' }
  if (!accepted.has('gzip')) return { body: asset.body, encoding: null }
  const gzip = asset.encoded.get('gzip') ?? gzipSync(asset.body, { level: 9 })
  asset.encoded.set('gzip', gzip)
  return { body: gzip, encoding: 'gzip' }
}

/** A hashed path is immutable; anything else revalidates, and a matching
 *  `If-None-Match` is a body-less 304. */
function sendAsset(req: IncomingMessage, res: ServerResponse, asset: Asset, path: string, headOnly: boolean): void {
  const cacheControl = isContentHashed(path) ? IMMUTABLE_CACHE : REVALIDATE_CACHE
  const varies = isCompressible(asset.contentType, asset.body.byteLength)
  const { body, encoding } = negotiate(req, asset)
  const etag = etagFor(asset.etag, encoding)
  const ifNoneMatch = req.headers['if-none-match']
  const status = etagMatches(ifNoneMatch, asset.etag) ? 304 : 200
  send(res, { status, contentType: asset.contentType, body, cacheControl, headOnly, encoding, etag, varies })
}

/** A path whose last segment has an extension names a FILE: when it is
 *  missing it is a 404, never the HTML shell (which a browser would then try
 *  to run as a script chunk). Everything else is an app route. */
function looksLikeFile(path: string): boolean {
  const last = path.slice(path.lastIndexOf('/') + 1)
  return last.includes('.')
}

export async function createApp(options: WebServerOptions = {}): Promise<Server> {
  const distDir = options.distDir ?? fileURLToPath(new URL('../dist/', import.meta.url))
  const assets = await loadAssets(distDir)
  const fingerprints = options.certFingerprints ?? parseCertFingerprints(process.env.CAMSTACK_ANDROID_CERT_SHA256)
  const { appleAppSiteAssociation, assetLinks } = buildAppLinkFiles(fingerprints)
  const aasa = makeAsset(Buffer.from(JSON.stringify(appleAppSiteAssociation, null, 2)), WELL_KNOWN_TYPE)
  const assetLinksAsset = makeAsset(Buffer.from(JSON.stringify(assetLinks, null, 2)), WELL_KNOWN_TYPE)
  const index = assets.get(INDEX_PATH)
  if (index === undefined) throw new Error('unreachable: index.html verified at load')

  const compressing = precompress([...assets.values(), aasa, assetLinksAsset]).catch((error: unknown) => {
    log('error', 'precompression failed — serving gzip on demand', {
      error: error instanceof Error ? error.message : String(error),
    })
  })
  if (options.awaitPrecompression === true) await compressing

  if (fingerprints.length === 0) {
    log('warn', 'no android cert fingerprints — assetlinks.json will not auto-verify', {
      env: 'CAMSTACK_ANDROID_CERT_SHA256',
    })
  }

  return createServer((req, res) => {
    const method = req.method ?? 'GET'
    const headOnly = method === 'HEAD'
    let path: string
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    } catch {
      send(res, { status: 400, contentType: JSON_TYPE, body: Buffer.from('{"error":"bad_request"}'), cacheControl: 'no-store', headOnly })
      return
    }

    if (method !== 'GET' && !headOnly) {
      send(res, { status: 405, contentType: JSON_TYPE, body: Buffer.from('{"error":"method_not_allowed"}'), cacheControl: 'no-store', headOnly: false })
      return
    }

    if (path === '/health') {
      const body = Buffer.from(JSON.stringify({ status: 'ok', uptime: process.uptime() }))
      send(res, { status: 200, contentType: JSON_TYPE, body, cacheControl: 'no-store', headOnly })
      return
    }

    // The extensionless AASA MUST be application/json or iOS ignores it.
    if (path === AASA_PATH || path === AASA_LEGACY_PATH) {
      sendAsset(req, res, aasa, path, headOnly)
      return
    }
    if (path === ASSETLINKS_PATH) {
      sendAsset(req, res, assetLinksAsset, path, headOnly)
      return
    }

    const asset = assets.get(path)
    if (asset !== undefined) {
      sendAsset(req, res, asset, path, headOnly)
      return
    }

    if (looksLikeFile(path) || path.startsWith('/.well-known/')) {
      send(res, { status: 404, contentType: JSON_TYPE, body: Buffer.from('{"error":"not_found"}'), cacheControl: 'no-store', headOnly })
      return
    }

    // An app route (`/cameras`, `/camera/101`, `/connect`): the SPA shell.
    // Revalidated on every load (`no-cache` + ETag), so a deploy is picked up
    // on the next load and an unchanged shell costs a 304.
    sendAsset(req, res, index, INDEX_PATH, headOnly)
  })
}

export async function startServer(): Promise<Server> {
  const port = Number(process.env.PORT ?? 8080)
  const host = process.env.HOST ?? '0.0.0.0'
  const server = await createApp()
  await new Promise<void>((resolve) => server.listen(port, host, () => resolve()))
  log('info', 'camstack viewer web listening', { port, host })
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log('info', 'shutting down', { signal })
      server.close(() => process.exit(0))
    })
  }
  return server
}

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().catch((error: unknown) => {
    log('error', 'failed to start', { error: error instanceof Error ? error.message : String(error) })
    process.exit(1)
  })
}
