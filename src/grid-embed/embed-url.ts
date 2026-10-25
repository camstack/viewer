/**
 * Build the URL for the Viewer-hosted embed bundle. Pure.
 *
 * The token is NEVER in the URL — it goes in the injected body config + the session cookie
 * (see GridLiveEmbed). The `devices` csv is a convenience for the "Copy embed URL"
 * / web-iframe case; the native WebView relies on the injected config.
 */
/**
 * Which page of the shared embed bundle to load. One bundle, one `?mode=`.
 * `events` is the track/event surface (`embed/src/embed/EVENTS-EMBED.md`).
 */
import { VIEWER_EMBED_PATH } from '../../shared/embed-path.js'

export type EmbedMode = 'grid' | 'player' | 'recording' | 'events'

/**
 * The embed page's cache identity.
 *
 * ## What this was, and what it was actually costing
 *
 * It was `String(Date.now())` — a fresh nonce on every app launch. The stated
 * fear (see `buildGridEmbedUrl` below) is real and was observed: WKWebView kept
 * a stale embed SPA whose control channel reconnected to the new server but
 * whose JS lacked newer host commands like `goLive`.
 *
 * The cost was assumed to be "the embed re-downloads on every app open". It is
 * NOT, and the difference matters:
 *
 *  - The bundle is content-hashed and served `public, max-age=31536000,
 *    immutable`, and `index.html` references it RELATIVELY. The nonce sits on
 *    the page's query string, so the asset URLs never change and the expensive
 *    part of the embed is cached across launches either way.
 *  - `index.html` itself is served `cache-control: no-cache` and — this is the
 *    real gap — with NO `ETag` and NO `Last-Modified`. A client that cannot
 *    revalidate must re-fetch unconditionally, nonce or not.
 *
 * So removing the nonce buys close to nothing on the network, and would give
 * back the one protection it provides. The defect worth fixing is that the
 * identity moved for a reason unrelated to what it guards: a relaunch is not a
 * new bundle.
 *
 * ## What it is now
 *
 * The APP BUILD's identity. That is precisely the thing the observed failure
 * turns on — the host expecting a command the loaded embed does not implement
 * — and it is stable across relaunches, so every embed surface and the warm-up
 * agree on one cache entry for the life of a build.
 *
 * A hub-side embed redeploy without an app update no longer changes the URL.
 * That is a deliberate, bounded exposure: `index.html` is `no-cache` so a
 * compliant client refetches anyway, and the new bundle it names has new
 * content-hashed asset URLs. The residual risk is a WKWebView that ignores
 * `no-cache` on the shell — which is what the original nonce was papering
 * over. The durable fix is an `ETag` on the hub's file data-plane (it already
 * stats the file for `mtime`/`size`); that is a hub-repo change and is NOT
 * made here.
 *
 * Defaults to `'dev'` so the pure module has no expo dependency and stays
 * loadable in the node-env test suite; the app sets the real value once at
 * start via {@link setEmbedCacheBust}.
 */
let embedCacheBust = 'dev'

/**
 * Set the embed cache identity for this app build. Called once at app start.
 * Ignores an empty value rather than producing a URL with a blank `_cb`.
 */
export function setEmbedCacheBust(value: string): void {
  if (value.length > 0) embedCacheBust = value
}

/** The current embed cache identity. Read at URL-build time, never captured at
 *  module scope — the app sets it after this module is first imported. */
export function getEmbedCacheBust(): string {
  return embedCacheBust
}

/**
 * Derive the cache identity from the running bundle. Pure, so the rule is
 * testable without expo.
 *
 * `updateId` is preferred: two OTA updates share a declared version whenever a
 * publish forgets to bump it, and the update id is what actually distinguishes
 * the JS that is running. Falls back to the declared version, then `'dev'`.
 */
export function deriveEmbedCacheBust(inputs: {
  readonly updateId?: string | null
  readonly appVersion?: string | null
}): string {
  const id = inputs.updateId
  if (typeof id === 'string' && id.length > 0) return id.slice(0, 12)
  const v = inputs.appVersion
  if (typeof v === 'string' && v.length > 0) return v
  return 'dev'
}

export function buildGridEmbedUrl(
  serverUrl: string,
  mode: EmbedMode,
  params?: { readonly devices?: readonly number[]; readonly cacheBust?: string },
): string {
  const base = serverUrl.replace(/\/+$/, '')
  let url = `${base}${VIEWER_EMBED_PATH}?mode=${mode}`
  if (params?.devices && params.devices.length > 0) {
    url += `&devices=${params.devices.join(',')}`
  }
  // Cache-bust the embed page so a redeployed bundle is actually re-fetched by
  // the WebView (WKWebView can otherwise keep a stale SPA whose control channel
  // reconnects to the new server but whose JS lacks newer commands like goLive).
  if (params?.cacheBust) {
    url += `&_cb=${encodeURIComponent(params.cacheBust)}`
  }
  return url
}
