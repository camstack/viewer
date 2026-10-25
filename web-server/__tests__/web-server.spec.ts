import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import type { IncomingHttpHeaders, Server } from 'node:http'
import { brotliDecompressSync } from 'node:zlib'

import { AASA_LEGACY_PATH, AASA_PATH, ASSETLINKS_PATH, createApp } from '../server.ts'
import { AASA_COMPONENTS, buildAppLinkFiles, parseCertFingerprints } from '../app-links.ts'
import { acceptedEncodings, etagMatches, isContentHashed } from '../http-cache.ts'

const FP = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99'
const INDEX = '<!doctype html><title>CamStack</title><div id="root"></div>'
const BUNDLE = `console.log(${JSON.stringify('x'.repeat(4096))})`
const EMBED_BUNDLE = `export const a = ${JSON.stringify('y'.repeat(4096))}`
const EMBED_INDEX = '<!doctype html><title>CamStack Embed</title><script src="./assets/index-DD2L4J6W.js"></script>'
const EXPO_ASSET = 'arrow_down.017bc6ba3fc25503e5eb5e53826d48a8.png'
const WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])

interface RawResponse {
  readonly status: number
  readonly headers: IncomingHttpHeaders
  readonly body: Buffer
}

/** fetch() transparently decodes and hides content-encoding details we
 *  assert on, so the encoding tests read the raw bytes. */
function rawGet(path: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

let dist = ''
let server: Server | null = null
let base = ''

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), 'viewer-dist-'))
  writeFileSync(join(dist, 'index.html'), INDEX)
  writeFileSync(join(dist, 'manifest.json'), '{"name":"CamStack"}')
  mkdirSync(join(dist, '_expo', 'static', 'js', 'web'), { recursive: true })
  writeFileSync(join(dist, '_expo', 'static', 'js', 'web', 'entry-abc123.js'), BUNDLE)
  mkdirSync(join(dist, 'embed', 'assets'), { recursive: true })
  writeFileSync(join(dist, 'embed', 'index.html'), EMBED_INDEX)
  writeFileSync(join(dist, 'embed', 'assets', 'index-DD2L4J6W.js'), EMBED_BUNDLE)
  mkdirSync(join(dist, 'assets', 'node_modules', 'expo-router', 'assets'), { recursive: true })
  writeFileSync(join(dist, 'assets', 'node_modules', 'expo-router', 'assets', EXPO_ASSET), 'png')
  writeFileSync(join(dist, 'icon-192.png'), 'png')
  writeFileSync(join(dist, 'decoder.wasm'), WASM)
  writeFileSync(join(dist, 'site.webmanifest'), '{"name":"CamStack"}')
  server = await createApp({ distDir: dist, certFingerprints: [FP], awaitPrecompression: true })
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server has no TCP address')
  base = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  rmSync(dist, { recursive: true, force: true })
})

describe('the well-known pair', () => {
  it.each([AASA_PATH, AASA_LEGACY_PATH])('%s is bare application/json and claims /connect', async (path) => {
    const res = await fetch(`${base}${path}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    const body: unknown = await res.json()
    expect(body).toEqual(buildAppLinkFiles([FP]).appleAppSiteAssociation)
    const paths = AASA_COMPONENTS.map((c) => c['/'])
    expect(paths).toContain('/connect')
    expect(paths).toContain('/camera/*')
    expect(JSON.stringify(body)).toContain('C3F24V5NS5.com.apocaliss92.camstack')
    // Only the production app may claim the link domain: with a second app id
    // listed, iOS picked an old dev install for a notification tap.
    expect(JSON.stringify(body)).not.toContain('camstack.dev')
  })

  it('assetlinks.json carries the configured fingerprints for the production package only', async () => {
    const res = await fetch(`${base}${ASSETLINKS_PATH}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    const body: unknown = await res.json()
    expect(body).toEqual(buildAppLinkFiles([FP]).assetLinks)
    expect(body).toEqual([
      expect.objectContaining({
        target: expect.objectContaining({ package_name: 'com.apocaliss92.camstack', sha256_cert_fingerprints: [FP] }),
      }),
    ])
  })

  it('no fingerprints is still a valid file', () => {
    expect(parseCertFingerprints(undefined)).toEqual([])
    expect(parseCertFingerprints(` ${FP.toLowerCase()}, junk ,`)).toEqual([FP])
    expect(buildAppLinkFiles([]).assetLinks[0]?.target.sha256_cert_fingerprints).toEqual([])
  })

  it('never claims the root or the well-known paths', () => {
    const paths = AASA_COMPONENTS.map((c) => c['/'])
    expect(paths).not.toContain('/')
    expect(paths.some((p) => p.startsWith('/.well-known'))).toBe(false)
  })

  it('every claimed family is a route the app really has', () => {
    const route: Record<string, string> = {
      '/camera/*': 'app/(app)/camera/[id].tsx',
      '/events*': 'app/(app)/(tabs)/events.tsx',
      '/grid/*': 'app/(app)/grid/[id]/index.tsx',
      '/notifications*': 'app/(app)/(tabs)/notifications.tsx',
      '/connect': 'app/connect.tsx',
    }
    for (const component of AASA_COMPONENTS) {
      const file = route[component['/']]
      expect(file, `no route mapped for ${component['/']}`).toBeDefined()
      expect(existsSync(join(process.cwd(), file ?? '')), `${file} is missing`).toBe(true)
    }
  })
})

describe('the SPA', () => {
  it.each(['/', '/cameras', '/camera/101', '/connect'])('%s serves the shell, revalidated on every load', async (path) => {
    const res = await fetch(`${base}${path}?hub=https%3A%2F%2Fhub.example.com`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(res.headers.get('etag')).toMatch(/^"[A-Za-z0-9_-]+"$/)
    expect(await res.text()).toBe(INDEX)
  })

  it('serves hashed bundles immutable and gzipped', async () => {
    const res = await fetch(`${base}/_expo/static/js/web/entry-abc123.js`, {
      headers: { 'accept-encoding': 'gzip' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('immutable')
    expect(res.headers.get('content-encoding')).toBe('gzip')
    expect(await res.text()).toBe(BUNDLE)
  })

  it('a missing FILE is a 404, never the shell', async () => {
    const res = await fetch(`${base}/_expo/static/js/web/missing.js`)
    expect(res.status).toBe(404)
  })

  it('cannot traverse out of dist: only files loaded at boot are ever served', async () => {
    const file = await fetch(`${base}/..%2F..%2Fpackage.json`)
    expect(file.status).toBe(404)
    const route = await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`)
    expect(await route.text()).toBe(INDEX)
  })

  it('health answers and other methods are refused', async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200)
    expect((await fetch(`${base}/cameras`, { method: 'POST' })).status).toBe(405)
  })
})

describe('caching', () => {
  it.each([
    '/_expo/static/js/web/entry-abc123.js',
    '/embed/assets/index-DD2L4J6W.js',
    `/assets/node_modules/expo-router/assets/${EXPO_ASSET}`,
  ])('content-hashed %s is cached for a year, immutable', async (path) => {
    const res = await rawGet(path)
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it.each([
    '/',
    '/index.html',
    '/embed/index.html',
    '/manifest.json',
    '/icon-192.png',
    AASA_PATH,
    ASSETLINKS_PATH,
  ])('%s is no-cache with a strong ETag, and a matching If-None-Match is a 304', async (path) => {
    const first = await rawGet(path)
    expect(first.status).toBe(200)
    expect(first.headers['cache-control']).toBe('no-cache')
    const etag = first.headers.etag
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/)
    const again = await rawGet(path, { 'if-none-match': etag ?? '' })
    expect(again.status).toBe(304)
    expect(again.body.byteLength).toBe(0)
    expect(again.headers.etag).toBe(etag)
    expect(again.headers['cache-control']).toBe('no-cache')
    const stale = await rawGet(path, { 'if-none-match': '"something-else"' })
    expect(stale.status).toBe(200)
  })

  it('the shell and embed/index.html are different resources with different ETags', async () => {
    const shell = await rawGet('/index.html')
    const embed = await rawGet('/embed/index.html')
    expect(embed.body.toString()).toBe(EMBED_INDEX)
    expect(embed.headers.etag).not.toBe(shell.headers.etag)
  })

  it('a hashed bundle revalidated by ETag is also a 304', async () => {
    const first = await rawGet('/embed/assets/index-DD2L4J6W.js')
    const again = await rawGet('/embed/assets/index-DD2L4J6W.js', { 'if-none-match': first.headers.etag ?? '' })
    expect(again.status).toBe(304)
  })

  it('a missing file never gets an immutable header', async () => {
    const res = await rawGet('/embed/assets/index-missing.js')
    expect(res.status).toBe(404)
    expect(res.headers['cache-control']).toBe('no-store')
  })
})

describe('compression', () => {
  it('prefers brotli, with an encoding-specific ETag and Vary', async () => {
    const res = await rawGet('/embed/assets/index-DD2L4J6W.js', { 'accept-encoding': 'gzip, deflate, br' })
    expect(res.headers['content-encoding']).toBe('br')
    expect(res.headers.vary).toBe('Accept-Encoding')
    expect(res.headers.etag).toMatch(/-br"$/)
    expect(brotliDecompressSync(res.body).toString()).toBe(EMBED_BUNDLE)
  })

  it('falls back to gzip, then identity', async () => {
    const gz = await rawGet('/embed/assets/index-DD2L4J6W.js', { 'accept-encoding': 'gzip' })
    expect(gz.headers['content-encoding']).toBe('gzip')
    expect(gz.headers.etag).toMatch(/-gz"$/)
    const plain = await rawGet('/embed/assets/index-DD2L4J6W.js', { 'accept-encoding': 'br;q=0, identity' })
    expect(plain.headers['content-encoding']).toBeUndefined()
    expect(plain.headers.vary).toBe('Accept-Encoding')
    expect(plain.body.toString()).toBe(EMBED_BUNDLE)
  })

  it('a cached gzip ETag still revalidates when the client now asks for br', async () => {
    const gz = await rawGet('/embed/assets/index-DD2L4J6W.js', { 'accept-encoding': 'gzip' })
    const again = await rawGet('/embed/assets/index-DD2L4J6W.js', {
      'accept-encoding': 'br',
      'if-none-match': gz.headers.etag ?? '',
    })
    expect(again.status).toBe(304)
  })

  it('a tiny file is never compressed', async () => {
    const res = await rawGet('/manifest.json', { 'accept-encoding': 'br, gzip' })
    expect(res.headers['content-encoding']).toBeUndefined()
  })
})

describe('content types', () => {
  it.each([
    ['/decoder.wasm', 'application/wasm'],
    ['/manifest.json', 'application/json; charset=utf-8'],
    ['/site.webmanifest', 'application/manifest+json'],
    ['/embed/assets/index-DD2L4J6W.js', 'text/javascript; charset=utf-8'],
  ])('%s is %s', async (path, type) => {
    const res = await rawGet(path)
    expect(res.headers['content-type']).toBe(type)
  })
})

describe('http-cache helpers', () => {
  it('recognises content-hashed paths only', () => {
    expect(isContentHashed('/_expo/static/js/web/index-9c6a5145f08b5ccaca79f5f651687859.js')).toBe(true)
    expect(isContentHashed('/embed/assets/MaskShapeCanvas-DI4BY7W2-CLjSXyu1.js')).toBe(true)
    expect(isContentHashed('/assets/x/close-icon.808e1b1b9b53114ec2838071a7e6daa7@4x.png')).toBe(true)
    expect(isContentHashed('/index.html')).toBe(false)
    expect(isContentHashed('/embed/index.html')).toBe(false)
    expect(isContentHashed('/manifest.json')).toBe(false)
    expect(isContentHashed('/icon-192.png')).toBe(false)
    expect(isContentHashed('/.well-known/assetlinks.json')).toBe(false)
  })

  it('parses Accept-Encoding with q=0 refusals', () => {
    expect([...acceptedEncodings('gzip, deflate, br')].sort()).toEqual(['br', 'gzip'])
    expect([...acceptedEncodings('br;q=0, gzip;q=0.5')]).toEqual(['gzip'])
    expect(acceptedEncodings(undefined).size).toBe(0)
  })

  it('matches If-None-Match lists, weak prefixes and *', () => {
    expect(etagMatches('"a", W/"abc"', '"abc"')).toBe(true)
    expect(etagMatches('"abc-gz"', '"abc"')).toBe(true)
    expect(etagMatches('*', '"abc"')).toBe(true)
    expect(etagMatches('"abd"', '"abc"')).toBe(false)
    expect(etagMatches(undefined, '"abc"')).toBe(false)
  })
})

describe('the production image', () => {
  it('copies every web-server module the server imports', () => {
    const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8')
    const modules = readdirSync(join(process.cwd(), 'web-server')).filter((name) => name.endsWith('.ts'))
    expect(modules).toContain('server.ts')
    for (const name of modules) expect(dockerfile, `Dockerfile does not COPY web-server/${name}`).toContain(`web-server/${name}`)
  })
})
