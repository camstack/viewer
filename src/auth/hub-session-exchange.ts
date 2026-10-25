/**
 * Web same-origin hub session reuse (Phase 1 of viewer auth forwarding).
 *
 * When the viewer WEB build is served BY the hub (mounted under
 * `/viewer/camstack/`, same origin as the admin-ui) and no server is
 * configured yet, the boot gate calls the hub's PUBLIC
 * `auth.exchangeSession` mutation with the browser's httpOnly session
 * cookie (`credentials: 'include'` + the CSRF header). A logged-in
 * admin-ui session thus provisions the viewer transparently; a
 * logged-out browser is bounced to the admin-ui login with
 * `?redirect=<current viewer path>` and comes back authenticated.
 *
 * Everything here is pure/injected so the node-env vitest suite can
 * cover it; the React side lives in `HubSessionBootstrap.tsx`.
 */
import { postHubAuthMutation, type FetchLike, type HubAuthOutcome } from './hub-auth-wire.js'

/** Must match the server's EXCHANGE_SESSION_HEADER (auth.router.ts). */
export const EXCHANGE_SESSION_HEADER = 'x-camstack-exchange'

/** Fallback prefix when the build-time base path is unavailable — the hub
 *  mounts the viewer under `/viewer/camstack/` (EXPO_PUBLIC_WEB_BASE_PATH=/viewer). */
const HUB_VIEWER_PATH_PREFIX = '/viewer/'

export interface HubWebBootEnv {
  /** `Platform.OS` — the exchange is a web-only mechanism. */
  readonly platform: string
  /** `window.location.pathname`, or null outside a browser. */
  readonly pathname: string | null
  /** Build-time `EXPO_PUBLIC_WEB_BASE_PATH` (e.g. `/viewer`), if any. */
  readonly webBasePath: string | null | undefined
  /** True when a server + token are already configured — an already-
   *  provisioned viewer keeps its config (never forced through the
   *  exchange). */
  readonly hasServerConfigured: boolean
  /** True when the page runs as an INSTALLED web app (`display-mode:
   *  standalone` / iOS `navigator.standalone`), whose cookie jar is its own. */
  readonly standalone: boolean
}

/** The one field the bounce decision reads. */
export type HubBounceEnv = Pick<HubWebBootEnv, 'standalone'>

/**
 * Heuristic for "served by a hub, not yet configured": web platform,
 * browser present, and the current path lives under the built base path
 * (or the well-known `/viewer/` mount when no base path was baked in).
 */
export function shouldAttemptHubSessionExchange(env: HubWebBootEnv): boolean {
  if (env.hasServerConfigured) return false
  if (env.platform !== 'web') return false
  if (!env.pathname) return false
  const basePath = env.webBasePath && env.webBasePath !== '' ? env.webBasePath : null
  if (basePath) {
    return env.pathname === basePath || env.pathname.startsWith(`${basePath}/`)
  }
  return env.pathname.startsWith(HUB_VIEWER_PATH_PREFIX)
}

/**
 * Whether an `unauthorized` exchange may bounce the page to the admin-ui
 * login. A browser tab shares its cookie jar with the admin-ui, so the bounce
 * returns authenticated. An installed iOS web app has its OWN jar: its first
 * launch is always unauthenticated, and `/login` lies outside the manifest
 * scope (`/viewer/camstack/`), so iOS opened it in the in-app browser sheet —
 * whose cookies are Safari's, not the app's. The login could not provision
 * the PWA, the redirect back loaded a second viewer inside the sheet, and the
 * app itself came back flagged `bounced` and showed the manual login it should
 * have shown at once. Standalone therefore never bounces.
 */
export function shouldBounceToHubLogin(env: HubBounceEnv): boolean {
  return !env.standalone
}

/**
 * Call `auth.exchangeSession` against the serving origin. The browser
 * attaches the httpOnly `camstack_session` cookie; the custom header is
 * the CSRF gate the server requires alongside it. Asks for a refreshing
 * session (D812); an older hub strips the flag.
 */
export async function exchangeHubSession(
  origin: string,
  fetchFn?: FetchLike,
): Promise<HubAuthOutcome> {
  return postHubAuthMutation({
    baseUrl: origin,
    procedure: 'auth.exchangeSession',
    input: { refreshable: true },
    headers: { [EXCHANGE_SESSION_HEADER]: '1' },
    credentials: 'include',
    ...(fetchFn ? { fetchFn } : {}),
  })
}

/**
 * Single-logout for a hub-served web viewer: clear the SHARED hub session
 * cookie (`DELETE /api/auth/session`) so the boot bootstrap cannot silently
 * re-provision from it — without this, signing out of the viewer was a
 * no-op (instant auto re-login) and the admin-ui stayed logged in too.
 * Best-effort: a network failure must never block the local sign-out.
 */
export async function clearHubSession(origin: string, fetchFn?: FetchLike): Promise<boolean> {
  const doFetch = fetchFn ?? fetch
  try {
    const res = await doFetch(`${origin.replace(/\/+$/, '')}/api/auth/session`, {
      method: 'DELETE',
      credentials: 'include',
    })
    return res.ok
  } catch {
    return false
  }
}

/** The admin-ui login URL that returns to `redirectPath` after login. */
export function buildHubLoginUrl(origin: string, redirectPath: string): string {
  return `${origin.replace(/\/+$/, '')}/login?redirect=${encodeURIComponent(redirectPath)}`
}
