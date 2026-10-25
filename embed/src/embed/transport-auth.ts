/**
 * transport-auth — "the transport already carries the credential".
 *
 * ## Why this exists
 *
 * Every other config source hands the embed a bearer token: a share link puts
 * it in `#t=`, a native host injects it into `window.__CAMSTACK_*__`, a web
 * host posts it over the `embed-config` handshake. That token is a real hub
 * credential — device-scoped and short-lived, but usable by anyone who reads
 * it, from anywhere, for the rest of its hour.
 *
 * The Home Assistant integration reaches the hub through a RELAY on Home
 * Assistant's own origin (`/api/camstack/p/<grant>/…`). That relay strips the
 * incoming `Authorization` header and injects the share token itself, on the
 * server side, for every forwarded request — HTTP and the WebSocket upgrade
 * alike. On that path the copy of the token in the page buys nothing: the hub
 * authenticates the request from the header the relay wrote, not from anything
 * the browser sent. It only costs — the events card put it in the iframe's URL,
 * where it lands in browser history and in every screenshot of the dashboard,
 * and anyone who could read it could use it against the hub from OUTSIDE Home
 * Assistant for an hour. The grant behind the relay path, by contrast, is
 * revocable and only works from a Home Assistant session.
 *
 * So the embed learns a second mode: a `serverUrl` that is a same-origin PATH
 * means "you are behind a relay that authenticates for you" — no token is
 * required, and none is sent. An ABSOLUTE `serverUrl` is a direct hub address
 * and still requires the token; the validation is not weakened in general, this
 * is one explicit, named case.
 */

import { z } from 'zod'

/**
 * True when `serverUrl` names a same-origin path rather than an absolute
 * address — i.e. the page talks to the hub through a relay on its own origin,
 * and that relay supplies the credential.
 *
 * `/api/camstack/p/abc` → true. `//host/x` (protocol-relative) and
 * `https://hub:4443` → false: both leave this origin, so nothing on the way
 * injects anything.
 */
export function isTransportAuthenticated(serverUrl: string): boolean {
  return serverUrl.startsWith('/') && !serverUrl.startsWith('//')
}

/**
 * The `Authorization` header for an authenticated data-plane fetch, or nothing
 * when the transport authenticates on the page's behalf.
 *
 * One place, so a media fetch and a tRPC call can never disagree about whether
 * this embed holds a credential.
 */
export function authorizationHeaders(token: string | undefined): Record<string, string> {
  return token !== undefined && token.length > 0 ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * The base URL the embed should talk to, given where the document itself was
 * served from.
 *
 * `location.origin` alone is wrong behind the relay: the bundle is served at
 * `<ha-origin>/api/camstack/p/<grant>/viewer/camstack/embed/index.html`, and an
 * origin-only base sends `/trpc` to Home Assistant, which knows nothing about
 * it. The prefix the document was served under IS the relay path, so strip the
 * known embed path off the end of `pathname` and keep what is left.
 *
 * A pathname that does not end with `embedPath` (a dev server, a directory
 * index) falls back to `origin` — the behaviour every non-relayed deployment
 * has always had.
 */
export function embedServerUrl(origin: string, pathname: string, embedPath: string): string {
  if (!pathname.endsWith(embedPath)) return origin
  const prefix = pathname.slice(0, pathname.length - embedPath.length)
  return prefix.length > 0 ? prefix : origin
}

/**
 * Zod object refinement shared by every config schema that carries a token:
 * absent is allowed only when {@link isTransportAuthenticated} says the relay
 * supplies one.
 *
 * One implementation, so the grid and the events reel can never drift into
 * disagreeing about when a config is credential-less.
 */
export function requireTokenUnlessTransportAuthenticated(
  value: { readonly serverUrl: string; readonly token?: string },
  ctx: z.RefinementCtx,
): void {
  if (value.token !== undefined) return
  if (isTransportAuthenticated(value.serverUrl)) return
  ctx.addIssue({
    code: 'custom',
    path: ['token'],
    message:
      'token is required unless serverUrl is a same-origin path served through an authenticating relay',
  })
}
