/**
 * Native login handoff (Phase 2 of viewer auth forwarding — "Sign in
 * with CamStack").
 *
 * The app opens the hub's admin-ui login page in an auth session
 * (`expo-web-browser` openAuthSessionAsync) with
 * `?redirect=<app-scheme>://auth-callback`. After ANY successful login
 * the admin-ui mints a one-time 60s handoff code and bounces to
 * `…auth-callback?code=chc_…`; the app redeems it over the PUBLIC
 * `auth.redeemHandoffCode` mutation for a real session token. The
 * session itself never travels through the browser redirect.
 */
import { postHubAuthMutation, type FetchLike, type HubAuthOutcome } from './hub-auth-wire.js'

/** Path component of the app's custom-scheme callback — the admin-ui
 *  allowlists exactly `camstack://auth-callback` (and the `.dev` scheme
 *  variant), so this must stay in lockstep with that allowlist. */
export const HANDOFF_CALLBACK_PATH = 'auth-callback'

/**
 * Canonicalize the callback expo-linking builds: standalone apps get the
 * empty-host `scheme:///auth-callback` (THREE slashes), but the hub login
 * page allowlists the 2-slash form exactly — this mismatch silently broke
 * the whole handoff (login succeeded, bounce never happened). Send the
 * canonical shape so older admin-ui builds (pre-normalizer) match too.
 */
export function canonicalizeCallbackUrl(callbackUrl: string): string {
  return callbackUrl.replace(/^([a-z][a-z0-9.+-]*):\/{2,3}/i, '$1://').replace(/\/$/, '')
}

/** The admin-ui login URL that starts a handoff to `callbackUrl`. */
export function buildHandoffLoginUrl(serverUrl: string, callbackUrl: string): string {
  const canonical = canonicalizeCallbackUrl(callbackUrl)
  return `${serverUrl.replace(/\/+$/, '')}/login?redirect=${encodeURIComponent(canonical)}`
}

/** True when the typed server URL is a plausible http(s) base URL — the
 *  sign-in button must surface a clear error instead of silently opening
 *  a sheet on garbage (or doing nothing on an empty field). */
export function isValidServerUrl(raw: string): boolean {
  const input = raw.trim()
  if (input.length === 0 || /^https?:\/\/$/i.test(input)) return false
  try {
    const parsed = new URL(input)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname.length > 0
  } catch {
    return false
  }
}

/**
 * Pull the one-time code off the callback deep link. Tolerates both
 * `scheme://auth-callback?code=…` and `scheme:///auth-callback?code=…`
 * shapes; returns null when no code is present.
 */
export function extractHandoffCode(callbackUrl: string): string | null {
  const queryStart = callbackUrl.indexOf('?')
  if (queryStart === -1) return null
  const query = callbackUrl.slice(queryStart + 1).split('#')[0] ?? ''
  const code = new URLSearchParams(query).get('code')
  return code && code.length > 0 ? code : null
}

/**
 * Redeem a handoff code for a session token (PUBLIC procedure). Asks for a
 * refreshing session (D812); an older hub ignores the flag and answers a
 * session-long token with no refresh token.
 */
export async function redeemHandoffCode(
  serverUrl: string,
  code: string,
  fetchFn?: FetchLike,
): Promise<HubAuthOutcome> {
  return postHubAuthMutation({
    baseUrl: serverUrl,
    procedure: 'auth.redeemHandoffCode',
    input: { code, refreshable: true },
    ...(fetchFn ? { fetchFn } : {}),
  })
}
