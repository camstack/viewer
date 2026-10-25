/**
 * web-reachability — the two ways a browser refuses a hub address SILENTLY.
 *
 * The hosted PWA is served over https. From there:
 *  - an `http://` hub (a LAN address) is MIXED CONTENT: the browser blocks the
 *    request before it leaves, and the app only ever sees a bare network error;
 *  - an `https://` hub with a self-signed certificate fails the TLS handshake,
 *    and fetch reports exactly the same bare network error.
 *
 * Neither is the operator's password or the hub being down, so a generic
 * "login failed" sends him looking in the wrong place. The first is decided
 * before anything is sent; the second is recognised from the error browsers
 * raise for a request that never got a response. Native apps are unaffected:
 * they reach http LAN hubs and trust what the OS trusts.
 */

/** True when an https page cannot call `serverUrl` at all (mixed content). */
export function isMixedContentHub(pageProtocol: string | null, serverUrl: string): boolean {
  if (pageProtocol !== 'https:') return false
  try {
    return new URL(serverUrl.trim()).protocol === 'http:'
  } catch {
    return false
  }
}

/** Chrome "Failed to fetch", Safari "Load failed", Firefox "NetworkError when
 *  attempting to fetch resource." — a request that got NO response. */
const BROWSER_NETWORK_FAILURE = /failed to fetch|load failed|networkerror/i

export function isBrowserNetworkFailure(error: unknown): boolean {
  return error instanceof Error && BROWSER_NETWORK_FAILURE.test(error.message)
}

/** A login leg that got no answer from the hub within its bound. */
export class HubUnreachableError extends Error {
  readonly serverUrl: string
  constructor(serverUrl: string) {
    super(`Can't reach ${hubHostOf(serverUrl)}`)
    this.name = 'HubUnreachableError'
    this.serverUrl = serverUrl
  }
}

/** The request never got a response: refused, timed out, TLS, DNS, CORS. */
export function isHubUnreachable(error: unknown): boolean {
  return error instanceof HubUnreachableError || isBrowserNetworkFailure(error)
}

/** `host[:port]` of a hub URL for a message; the input itself when unparsable. */
export function hubHostOf(serverUrl: string): string {
  try {
    return new URL(serverUrl.trim()).host || serverUrl.trim()
  } catch {
    return serverUrl.trim()
  }
}

/** The page protocol on web, null elsewhere. */
export function currentPageProtocol(): string | null {
  return typeof window !== 'undefined' && typeof window.location !== 'undefined' ? window.location.protocol : null
}

/**
 * How the tRPC client words a response it could not read as tRPC: a body that
 * is not JSON at all (an HTML page, an empty 404), or JSON that carries neither
 * a `result` nor a numbered `error` envelope. Matched on the error AND every
 * `cause` below it, because the client wraps the parser's own error.
 */
const NOT_TRPC_RESPONSE =
  /unable to transform response from server|is not valid json|unexpected token|unexpected end of json|json parse error|json\.parse/i

/**
 * True when the address ANSWERED, but not as a CamStack hub would: a web page,
 * a reverse proxy's 404, some other service's JSON.
 *
 * A real hub refusing the login (wrong password, rate limit) answers with a
 * tRPC error envelope, which the client exposes as `shape` — that is the hub
 * speaking, and its message is shown as it said it. Only an error WITHOUT that
 * envelope, whose chain names an unreadable body, is classified here; a request
 * that got no answer at all is {@link isHubUnreachable}'s, never this.
 */
export function isNotCamstackHub(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (hasHubErrorShape(error) || isHubUnreachable(error)) return false
  let current: unknown = error
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (current instanceof SyntaxError || NOT_TRPC_RESPONSE.test(current.message)) return true
    current = current.cause
  }
  return false
}

/** The hub's own tRPC error envelope (`TRPCClientError.shape`) is present. */
function hasHubErrorShape(error: Error): boolean {
  const shape: unknown = Reflect.get(error, 'shape')
  return typeof shape === 'object' && shape !== null
}
