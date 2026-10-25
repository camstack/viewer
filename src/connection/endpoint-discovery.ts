/**
 * endpoint-discovery — fetch the hub's advertised connection endpoints (LAN
 * IPs, public tunnel, loopback) via the `localNetwork` cap and fold them into
 * the candidate base-URL list the SystemController races on connect.
 *
 * Why: the client may be reaching the hub over a slow DNS/relay route while a
 * fast LAN path exists. The hub knows all the URLs it's reachable on; we pull
 * them on every successful connection, persist them locally (so next launch
 * starts the race with them), and re-race so the fastest (usually LAN at home)
 * wins. Fully defensive: an older hub without the cap simply yields [], leaving
 * the single configured `serverUrl` as the only candidate (current behaviour).
 *
 * The pure helpers (`parsePortScheme`, `endpointsToCandidates`) are unit-tested;
 * `discoverEndpoints` is the thin I/O seam over the tRPC escape hatch.
 */

import { log } from '../lib/logger.js'

/** One hub-advertised base URL, mirroring `localNetwork.getConnectionEndpoints`. */
export interface DiscoveredEndpoint {
  readonly label: string
  readonly baseUrl: string
  readonly kind: 'lan-ipv4' | 'lan-ipv6' | 'public' | 'loopback'
  readonly interfaceKind: 'lan' | 'wifi' | 'docker' | 'vpn' | 'other' | 'loopback' | 'public'
  readonly plausible: boolean
  readonly plausibleReason: string
  readonly priority: number
}

/** The port + scheme read off a base URL, and whether the PORT was actually
 *  there or had to be assumed from the scheme. */
export interface PortScheme {
  readonly port: number
  readonly scheme: 'http' | 'https'
  /**
   * Was the port written in the URL?
   *
   * Load-bearing whenever the hub does NOT declare its own port. A hub old
   * enough to only echo takes a port and stamps it onto every address it
   * advertises, including the LAN ones. So a client configured with
   * `https://camstack.example.top` (no port) infers 443 from the scheme, asks
   * with 443, and is handed `https://192.0.2.10:443` for a hub that listens on
   * 4443. That candidate is born dead, and it is the reason an operator sitting
   * on his own WiFi was on the public tunnel all along.
   *
   * The scheme default is a fine guess for the PUBLIC URL it came from, where a
   * proxy really is on 443. It is not a fact about the hub's LAN socket, and
   * `dropUnverifiedPortEndpoints` refuses to keep LAN candidates built out of it
   * unless the hub vouched for the port itself.
   */
  readonly explicitPort: boolean
}

/**
 * Where the hub says the port in its LAN/loopback URLs came from (D226).
 * Anything but `caller-hint` is the hub's own socket; `caller-hint` means it
 * could not read its own configuration and replayed what we sent.
 */
export type AdvertisedPortSource = 'server-config' | 'server-env' | 'caller-hint' | 'default'

/** The hub's own statement about the port it built local URLs with. */
export interface AdvertisedLocalPort {
  readonly port: number
  readonly source: AdvertisedPortSource
}

/** What one `getConnectionEndpoints` round-trip yielded. */
export interface DiscoveredEndpointSet {
  readonly endpoints: readonly DiscoveredEndpoint[]
  /** `null` on a hub predating D226 — indistinguishable from `caller-hint`,
   *  and treated identically. */
  readonly localPort: AdvertisedLocalPort | null
}

/** Who vouches for the port the advertised local URLs were built with. */
export interface PortTrust {
  /** The configured `serverUrl` carried a port, so we asked with a real one. */
  readonly explicitPort: boolean
  /** What the hub declared, or `null` when it declared nothing. */
  readonly declared: AdvertisedLocalPort | null
}

/** Parse the hub HTTP port + scheme from a base URL. The cap needs the port to
 *  build LAN URLs and the scheme to avoid mixed-content. Falls back to the dev
 *  default (4443/https) when the URL is unparseable. */
export function parsePortScheme(serverUrl: string): PortScheme {
  try {
    const u = new URL(serverUrl)
    const scheme = u.protocol === 'http:' ? 'http' : 'https'
    if (u.port) return { port: Number(u.port), scheme, explicitPort: true }
    return { port: scheme === 'http' ? 80 : 443, scheme, explicitPort: false }
  } catch {
    return { port: 4443, scheme: 'https', explicitPort: false }
  }
}

/** True when this advertised URL is loopback (`127.0.0.1` / `::1` / kind).
 *  Those are not client-reachable routes — the phone would pin a socket
 *  that only exists on the hub. */
export function isLoopbackUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase()
    return host === 'localhost' || host === '::1' || host.startsWith('127.')
  } catch {
    return false
  }
}

export function isLoopbackEndpoint(endpoint: DiscoveredEndpoint): boolean {
  return endpoint.kind === 'loopback' || isLoopbackUrl(endpoint.baseUrl)
}

/** Drop loopback from a hub-advertised list. Used both at discovery time
 *  (so the race never tries `127.0.0.1`) and in Settings so the picker
 *  cannot pin it. */
export function dropLoopbackEndpoints(
  endpoints: readonly DiscoveredEndpoint[],
): DiscoveredEndpoint[] {
  return endpoints.filter((e) => !isLoopbackEndpoint(e))
}

/** True when the advertised URL is IPv6 (kind or literal in brackets / colons). */
export function isIpv6Url(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '')
    return host.includes(':')
  } catch {
    return false
  }
}

export function isIpv6Endpoint(endpoint: DiscoveredEndpoint): boolean {
  return endpoint.kind === 'lan-ipv6' || isIpv6Url(endpoint.baseUrl)
}

/** Drop IPv6 from a list. AUTO still uses this via `isDefaultViewerEndpoint`;
 *  an explicit hub `resolved` set may keep IPv6 if the operator ticked it. */
export function dropIpv6Endpoints(
  endpoints: readonly DiscoveredEndpoint[],
): DiscoveredEndpoint[] {
  return endpoints.filter((e) => !isIpv6Endpoint(e))
}

/** AUTO race: LAN IPv4 + the public tunnel. Never mesh, never loopback, never IPv6. */
export function isDefaultViewerEndpoint(endpoint: DiscoveredEndpoint): boolean {
  if (endpoint.kind === 'lan-ipv4') return true
  return endpoint.kind === 'public' && endpoint.interfaceKind === 'public'
}

/**
 * Keep the URLs the hub said the viewer should race. `null` resolved (old hub
 * or missing cap) falls back to AUTO on the client.
 */
export function filterViewerRaceEndpoints(
  endpoints: readonly DiscoveredEndpoint[],
  resolved: readonly string[] | null,
): DiscoveredEndpoint[] {
  if (resolved === null) return endpoints.filter(isDefaultViewerEndpoint)
  const wanted = new Set(resolved)
  const explicit = endpoints.filter((e) => wanted.has(e.baseUrl))
  return explicit.length > 0 ? explicit : endpoints.filter(isDefaultViewerEndpoint)
}

/** Endpoint kinds whose base URL is only as good as the port it was built with. */
const PORT_DEPENDENT: ReadonlySet<DiscoveredEndpoint['kind']> = new Set([
  'lan-ipv4',
  'lan-ipv6',
  'loopback',
])

/** Kept vs discarded, so the caller can LOG what it threw away. */
export interface PortTrustSplit {
  readonly kept: readonly DiscoveredEndpoint[]
  readonly dropped: readonly DiscoveredEndpoint[]
}

/**
 * Drop the endpoints whose port nobody can vouch for.
 *
 * Two things can vouch, and the hub is the better one (D226). A hub that
 * declares `localPort` with any source but `caller-hint` built those URLs from
 * the socket it actually bound — keep them whatever our own configured URL
 * looked like. Otherwise we are back to the echoing contract: the hub stamped
 * the port WE sent, so a port we inferred from a scheme addresses a socket
 * nobody proved is there. Racing those costs a timeout each and, worse, makes
 * the log read as "the LAN was tried and lost" when the LAN was never asked.
 *
 * Inventing a better guess is not on the table: it would make the client a
 * second authority on the hub's listen port (D62), and a second authority that
 * disagrees with the first is worse than none.
 *
 * The public endpoint is unaffected either way: the hub builds that one from
 * the tunnel hostname it actually configured, not from the caller's port.
 */
export function dropUnverifiedPortEndpoints(
  endpoints: readonly DiscoveredEndpoint[],
  trust: PortTrust,
): PortTrustSplit {
  if (isPortVouchedFor(trust)) return { kept: endpoints, dropped: [] }
  return {
    kept: endpoints.filter((e) => !PORT_DEPENDENT.has(e.kind)),
    dropped: endpoints.filter((e) => PORT_DEPENDENT.has(e.kind)),
  }
}

/** True when the port in the advertised local URLs came from someone entitled
 *  to know it — the hub itself, or the operator's own explicit configuration. */
export function isPortVouchedFor(trust: PortTrust): boolean {
  const declared = trust.declared
  if (declared !== null && declared.source !== 'caller-hint') return true
  return trust.explicitPort
}

/**
 * Build the ordered, deduped candidate base-URL list to race. Plausible
 * endpoints first (by the hub's priority — LAN IPv4 lowest), then the configured
 * `serverUrl` as a guaranteed fallback, then the non-plausible ones (docker /
 * VPN / link-local — still occasionally reachable, but never preferred over the
 * known-good configured URL). Empty/duplicate URLs are dropped.
 */
export function endpointsToCandidates(
  endpoints: readonly DiscoveredEndpoint[],
  serverUrl: string,
): string[] {
  const byPriority = (a: DiscoveredEndpoint, b: DiscoveredEndpoint): number => a.priority - b.priority
  const plausible = endpoints.filter((e) => e.plausible).slice().sort(byPriority)
  const rest = endpoints.filter((e) => !e.plausible).slice().sort(byPriority)
  const ordered = [...plausible.map((e) => e.baseUrl), serverUrl, ...rest.map((e) => e.baseUrl)]
  const out: string[] = []
  for (const u of ordered) {
    if (u && !out.includes(u)) out.push(u)
  }
  return out
}

/** Minimal structural view of the SDK System we need (the tRPC escape hatch). */
interface SystemLike {
  readonly trpcClient: unknown
}

const NOTHING_DISCOVERED: DiscoveredEndpointSet = { endpoints: [], localPort: null }

async function readViewerResolved(router: Record<string, unknown> | undefined): Promise<readonly string[] | null> {
  const proc = router?.['getViewerEndpoints'] as { query?: unknown } | undefined
  const query = proc?.query
  if (typeof query !== 'function') return null
  try {
    const res = (await (query as (i?: unknown) => Promise<unknown>)()) as
      | { resolved?: unknown }
      | undefined
    if (!Array.isArray(res?.resolved)) return null
    const urls = res.resolved.filter((u): u is string => typeof u === 'string' && u.length > 0)
    return urls
  } catch {
    return null
  }
}

const PORT_SOURCES: readonly AdvertisedPortSource[] = [
  'server-config',
  'server-env',
  'caller-hint',
  'default',
]

/**
 * Read the hub's port declaration off a raw response, or `null` when it is
 * absent (pre-D226 hub) or does not look like one. Nothing is inferred here:
 * an unrecognised shape is treated as "the hub said nothing", never as a
 * trusted port.
 */
export function parseAdvertisedLocalPort(value: unknown): AdvertisedLocalPort | null {
  if (typeof value !== 'object' || value === null) return null
  const record: Record<string, unknown> = { ...value }
  const port = record['port']
  const source = record['source']
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null
  if (typeof source !== 'string') return null
  const known = PORT_SOURCES.find((s) => s === source)
  if (!known) return null
  return { port, source: known }
}

/**
 * Fetch the hub's advertised connection endpoints via the `localNetwork` cap.
 * Defensive: yields nothing on any error, a missing cap (older hub), or a
 * malformed payload — the caller treats that as "nothing to add".
 *
 * `port` is still SENT even though a D226 hub ignores it: a hub older than that
 * contract requires the field, and dropping it would turn a working old hub
 * into a validation error. It is a hint, and the hub says so in `localPort`.
 */
export async function discoverEndpoints(
  system: SystemLike,
  port: number,
  scheme: 'http' | 'https',
): Promise<DiscoveredEndpointSet> {
  try {
    const client = system.trpcClient as Record<string, unknown> | undefined
    const router = client?.['localNetwork'] as Record<string, unknown> | undefined
    const proc = router?.['getConnectionEndpoints'] as { query?: unknown } | undefined
    const query = proc?.query
    if (typeof query !== 'function') return NOTHING_DISCOVERED
    const res = (await (query as (i: unknown) => Promise<unknown>)({
      port,
      scheme,
      includeLoopback: false,
    })) as { endpoints?: readonly DiscoveredEndpoint[]; localPort?: unknown } | undefined
    const palette = dropLoopbackEndpoints(res?.endpoints ? [...res.endpoints] : [])
    const resolved = await readViewerResolved(router)
    return {
      endpoints: filterViewerRaceEndpoints(palette, resolved),
      localPort: parseAdvertisedLocalPort(res?.localPort),
    }
  } catch (e) {
    log.warn('conn', 'discoverEndpoints failed', { error: e instanceof Error ? e.message : String(e) })
    return NOTHING_DISCOVERED
  }
}

/**
 * Is `url` mixed content for a page served over `pageProtocol`?
 *
 * The hub advertises its LAN listener as plain `http://` (port 4480) because the
 * native app reaches it fastest that way at home. From an `https:` page — the
 * hosted PWA — the same URL is mixed content: some Chrome builds let the fetch
 * through, others and every Safari block it, and the WebSocket, snapshots and
 * the embed then live on an origin the page cannot keep using (operator report
 * 2026-10-06: the stored list put `http://192.0.2.10:4480`, priority 0, ahead
 * of the tunnel). `pageProtocol` is `null` off-browser, where nothing is mixed.
 */
export function isMixedContentUrl(url: string, pageProtocol: string | null): boolean {
  return pageProtocol === 'https:' && url.trim().toLowerCase().startsWith('http:')
}

/** `urls` without the ones {@link isMixedContentUrl} refuses, order kept. */
export function dropMixedContentUrls(
  urls: readonly string[],
  pageProtocol: string | null,
): string[] {
  return urls.filter((url) => !isMixedContentUrl(url, pageProtocol))
}

/**
 * The serving page's protocol (`https:`), or `null` off-browser. The ONE impure
 * read here — a native bundle has no `location` — so every caller asks it the
 * same way.
 */
export function currentPageProtocol(): string | null {
  const loc: unknown = (globalThis as { location?: unknown }).location
  if (typeof loc !== 'object' || loc === null) return null
  const protocol: unknown = (loc as { protocol?: unknown }).protocol
  return typeof protocol === 'string' && protocol.length > 0 ? protocol : null
}

/** Port sources that are the hub's own socket, never an echo or a fallback. */
const HUB_OWN_PORT_SOURCES: ReadonlySet<AdvertisedPortSource> = new Set(['server-config', 'server-env'])

/** LAN kinds that have an HTTPS twin on the hub's TLS listener. */
const LAN_KINDS: ReadonlySet<DiscoveredEndpoint['kind']> = new Set(['lan-ipv4', 'lan-ipv6'])

/**
 * The HTTPS address of a LAN endpoint the hub advertised as plain `http://`,
 * for a page that cannot use `http:` at all.
 *
 * With its LAN HTTP listener on, the hub advertises every LAN address ONLY as
 * `http://<ip>:4480`, whatever scheme the caller asked for. From the hosted PWA
 * (an `https:` page) that is mixed content and is dropped, which left the
 * tunnel as the only candidate: Settings showed one route and the race had
 * nothing to race (operator report 2026-10-07, probe "1/1"). The same address
 * is ALSO served by the hub's TLS listener — the URL the hub itself advertises
 * when LAN HTTP is off — and that listener's port is the `localPort` the hub
 * declares. So the twin is built from two facts the hub stated (the address and
 * its own HTTPS port), not from a guess: only a port from `server-config` /
 * `server-env` counts, never an echo of ours or the compiled-in default.
 *
 * Whether the browser trusts the certificate is not knowable here and does not
 * need to be: an untrusted one fails the `/health` probe, and the race simply
 * elects another candidate.
 */
export function secureLanTwin(
  endpoint: DiscoveredEndpoint,
  localPort: AdvertisedLocalPort | null,
): DiscoveredEndpoint | null {
  if (localPort === null || !HUB_OWN_PORT_SOURCES.has(localPort.source)) return null
  if (!LAN_KINDS.has(endpoint.kind)) return null
  try {
    const url = new URL(endpoint.baseUrl)
    if (url.protocol !== 'http:') return null
    url.protocol = 'https:'
    url.port = String(localPort.port)
    return { ...endpoint, baseUrl: url.origin }
  } catch {
    return null
  }
}

/**
 * The endpoint list as an `https:` page can use it: every plain-http LAN
 * endpoint replaced IN PLACE by its {@link secureLanTwin} (same label, kind and
 * priority, so the LAN still ranks first), duplicates dropped. Anything without
 * a twin is left as it is for {@link dropMixedContentUrls} to refuse, and a
 * native client or an `http:` page gets the list unchanged.
 */
export function withSecureLanTwins(
  endpoints: readonly DiscoveredEndpoint[],
  localPort: AdvertisedLocalPort | null,
  pageProtocol: string | null,
): DiscoveredEndpoint[] {
  if (pageProtocol !== 'https:') return [...endpoints]
  const out: DiscoveredEndpoint[] = []
  for (const endpoint of endpoints) {
    const next = isMixedContentUrl(endpoint.baseUrl, pageProtocol)
      ? (secureLanTwin(endpoint, localPort) ?? endpoint)
      : endpoint
    if (!out.some((e) => e.baseUrl === next.baseUrl)) out.push(next)
  }
  return out
}

/**
 * The endpoints Settings may offer as a preferred route: never loopback, and
 * never an address this page would refuse to pin (plain http on an https
 * page). Offering one the controller then refuses is what made the choice
 * "revert to automatic" on its own.
 */
export function pinnableRouteEndpoints(
  endpoints: readonly DiscoveredEndpoint[],
  pageProtocol: string | null,
): DiscoveredEndpoint[] {
  return dropLoopbackEndpoints(endpoints).filter((e) => !isMixedContentUrl(e.baseUrl, pageProtocol))
}
