/**
 * feed-channel — names the route a feed request rides, for the request log.
 * Embed-only: it reads the transport-auth relay convention.
 */
import { isTransportAuthenticated } from './transport-auth'

const PRIVATE_V4 = /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/

/**
 * Name the channel a base URL represents: `lan:host`, `public:host`,
 * `loopback:host`, `unknown:…`.
 *
 * A deliberate duplicate of the host app's `route-channel.ts` classifier — the
 * embed is a separate bundle that cannot import from `src/`, and a shared
 * package for eleven lines of regex would cost more than it saves. The two are
 * kept to the same vocabulary so a log reader never has to translate.
 */

export function describeFeedChannel(serverUrl: string): string {
  let host: string
  try {
    // A base is needed for the RELATIVE `serverUrl` a relayed embed carries
    // (`/api/camstack/p/<grant>` — see `transport-auth.ts`); without it the
    // channel of every Home Assistant card would read `unknown`. It is applied
    // ONLY to a same-origin path: a mangled or empty string must keep saying
    // "unparseable" rather than silently naming the page's own host.
    const base =
      isTransportAuthenticated(serverUrl) && typeof location !== 'undefined'
        ? location.href
        : undefined
    host = new URL(serverUrl, base).host
  } catch {
    return 'unknown:(unparseable)'
  }
  // The port has to come off before any equality test: `localhost:8081` is not
  // equal to `localhost`, and calling the hub-served web build `unknown`
  // because it runs on a non-default port is exactly the near-miss that makes a
  // diagnostic quietly useless.
  const withoutBrackets = host.trim().toLowerCase().replace(/^\[([^\]]*)\].*$/, '$1')
  const lastColon = withoutBrackets.lastIndexOf(':')
  const h =
    lastColon !== -1 && withoutBrackets.indexOf(':') === lastColon
      ? withoutBrackets.slice(0, lastColon)
      : withoutBrackets
  if (h === 'localhost' || h === '::1' || h.startsWith('127.')) return `loopback:${host}`
  if (PRIVATE_V4.test(h) || /^f[cd][0-9a-f]{2}:/.test(h) || h.startsWith('fe80:') || h.endsWith('.local'))
    return `lan:${host}`
  return h.includes('.') ? `public:${host}` : `unknown:${host}`
}

