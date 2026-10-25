/**
 * route-channel — name the route the app is ACTUALLY on, and why it is on it.
 *
 * ## What this fixes
 *
 * The connection layer races several candidate base URLs (`endpoint-discovery`)
 * and pivots the transport onto the winner. Until now nothing said which one
 * won: `traceRace('won', { winner })` fires only on the branch that finds a
 * winner, and the operator's 2026-08-21 session shipped ninety minutes of logs
 * containing `race failed` three times and `race won` never. So the question
 * "I am on WiFi — am I on the LAN or on the public tunnel?" could not be
 * answered from the logs at all, and the difference is measured: on this
 * deployment the same `listRecentTracks` costs 10-30 ms over the LAN and
 * 47-89 ms over the tunnel, and a thumbnail 16-33 ms against 135-189 ms.
 *
 * ## Why a channel and not a boolean
 *
 * "Is it local?" has at least four answers that behave differently — a LAN IP,
 * the public tunnel, loopback (hub-served web), and a URL that matches nothing
 * the hub advertised (a stale bookmark, a VPN, a manually typed host). A
 * boolean collapses the last two into whichever side is less alarming, which is
 * exactly the residue this module exists to make visible.
 *
 * ## Why the REASON travels with it
 *
 * A route is either a decision or a leftover, and the two look identical once
 * the app is running. `race-won` means the race elected this URL; `no-winner`
 * means every candidate failed its probe and the app fell back to the
 * configured URL — the same URL, arrived at by giving up. Without the reason
 * the next session cannot tell a working LAN preference from a failover that
 * never came back.
 */

/** The nature of a route, not its address. */
export type RouteChannel = 'lan' | 'public' | 'loopback' | 'unknown'

/**
 * Why the app is on the route it is on.
 *
 *  - `initial`     — the configured URL, before any race has settled.
 *  - `race-won`    — a race elected it (it may still be the configured URL).
 *  - `no-winner`   — every candidate failed its probe; this is the fallback.
 *  - `unchanged`   — the hub advertised the same candidate set, so no re-race
 *                    ran and the previous decision stands.
 *  - `pinned`      — the operator forced this URL in Settings; the race did
 *                    not choose it.
 */
export type RouteReason = 'initial' | 'race-won' | 'no-winner' | 'unchanged' | 'disposed' | 'pinned'

/** One endpoint as the hub advertises it — the fields this module reads. */
export interface ChannelEndpoint {
  readonly baseUrl: string
  readonly label: string
  readonly kind: 'lan-ipv4' | 'lan-ipv6' | 'public' | 'loopback'
}

/** A route, said out loud. */
export interface RouteDescription {
  /** The base URL in use, normalised (no trailing slash). */
  readonly url: string
  /** Host only — the part an operator reads at a glance. */
  readonly host: string
  readonly channel: RouteChannel
  /** The hub's own name for this endpoint when it advertised it, else null.
   *  A null here with a non-`unknown` channel means the URL was classified by
   *  shape alone — the hub does not currently advertise it. */
  readonly endpointLabel: string | null
  readonly reason: RouteReason
}

/** Strip trailing slashes so two spellings of one URL compare equal. */
export function normaliseBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

const PRIVATE_V4 = /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/

/**
 * Host without the port and without IPv6 brackets, lowercased.
 *
 * The port has to go before any equality test: `localhost:8081` is not equal to
 * `localhost`, and classifying the hub-served web build as `unknown` because it
 * runs on a non-default port is the kind of near-miss that makes a diagnostic
 * quietly useless. Bracketed IPv6 keeps its colons — only the `]:port` suffix
 * is a port there.
 */
export function bareHostname(host: string): string {
  const h = host.trim().toLowerCase()
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']') === -1 ? undefined : h.indexOf(']'))
  const cut = h.lastIndexOf(':')
  // A bare IPv6 literal has several colons and no port; `a:b:c` is not `a:b`.
  if (cut === -1 || h.indexOf(':') !== cut) return h
  return h.slice(0, cut)
}

/**
 * Classify a hostname by shape alone. Used only when the hub has not advertised
 * the URL — an advertised endpoint's own `kind` always wins, because the hub
 * knows which of its interfaces is which and a hostname cannot.
 */
export function classifyHost(host: string): RouteChannel {
  const h = bareHostname(host)
  if (h === 'localhost' || h === '::1' || h.startsWith('127.')) return 'loopback'
  if (PRIVATE_V4.test(h)) return 'lan'
  // Unique-local (fc00::/7) and link-local (fe80::/10) IPv6.
  if (/^f[cd][0-9a-f]{2}:/.test(h) || h.startsWith('fe80:')) return 'lan'
  if (h.endsWith('.local')) return 'lan'
  if (h.includes('.')) return 'public'
  return 'unknown'
}

const KIND_TO_CHANNEL: Readonly<Record<ChannelEndpoint['kind'], RouteChannel>> = {
  'lan-ipv4': 'lan',
  'lan-ipv6': 'lan',
  public: 'public',
  loopback: 'loopback',
}

/**
 * Describe the route a base URL represents against what the hub advertised.
 *
 * An unparseable URL yields `unknown` rather than throwing: this runs on the
 * logging path, and instrumentation that can crash the thing it observes is
 * worse than no instrumentation.
 */
export function describeRoute(
  url: string,
  endpoints: readonly ChannelEndpoint[],
  reason: RouteReason,
): RouteDescription {
  const normalised = normaliseBaseUrl(url)
  const match = endpoints.find((e) => normaliseBaseUrl(e.baseUrl) === normalised)
  let host: string
  try {
    host = new URL(normalised).host
  } catch {
    return { url: normalised, host: '(unparseable)', channel: 'unknown', endpointLabel: null, reason }
  }
  if (match) {
    return {
      url: normalised,
      host,
      channel: KIND_TO_CHANNEL[match.kind],
      endpointLabel: match.label,
      reason,
    }
  }
  return { url: normalised, host, channel: classifyHost(host), endpointLabel: null, reason }
}

/**
 * True when the app is on a route that can carry a high-bitrate stream.
 *
 * `lan` is the home network the race elects; `loopback` is the hub-served web
 * build (same machine as the hub). Everything else — the public tunnel, a
 * bookmark the hub never advertised, a hostname we cannot classify — is remote
 * for bandwidth purposes, and recorded playback must stay on the lowest tier.
 */
export function isLocalRouteChannel(channel: RouteChannel): boolean {
  return channel === 'lan' || channel === 'loopback'
}

/**
 * The one-line summary that goes on a log line and on the Settings row.
 * Deliberately not localised: it is read in Loki as often as on screen.
 */
export function routeSummary(route: RouteDescription): string {
  return `${route.channel}:${route.host} (${route.reason})`
}
