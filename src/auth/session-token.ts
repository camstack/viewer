/**
 * Session-token (JWT) introspection — decode the `exp` claim so the client
 * can (a) drop an already-expired token on boot instead of pretending to be
 * logged in, and (b) schedule a SILENT refresh well before expiry so the
 * viewer session lasts indefinitely while the app is in use.
 *
 * Pure + dependency-free (uses the global `Buffer` polyfill installed in
 * `index.js`) so the node-env vitest suite can cover it.
 */

/** Decode a JWT's `exp` claim (seconds) into epoch milliseconds, or null when
 *  the token is malformed / carries no numeric `exp`. Never throws. */
export function decodeJwtExpMs(token: string): number | null {
  const parts = token.split('.')
  if (parts.length < 2 || !parts[1]) return null
  try {
    const json = Buffer.from(parts[1], 'base64').toString('utf8')
    const payload: unknown = JSON.parse(json)
    if (typeof payload !== 'object' || payload === null) return null
    const exp: unknown = Reflect.get(payload, 'exp')
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null
  } catch {
    return null
  }
}

/** True when the token has a decodable `exp` that is at or before `now`
 *  (minus `skewMs`, a small clock-skew guard). A token with no `exp` is
 *  treated as NOT expired — the server is the ultimate authority. */
export function isJwtExpired(token: string, now: number = Date.now(), skewMs: number = 0): boolean {
  const expMs = decodeJwtExpMs(token)
  if (expMs === null) return false
  return expMs <= now + skewMs
}

/** Refresh once a token has burned this fraction of its remaining life. */
const REFRESH_AT_REMAINING_FRACTION = 0.5
/** Never wait longer than this before a refresh attempt (caps very long-lived
 *  tokens so a foregrounded app keeps its session demonstrably fresh). */
const MAX_REFRESH_DELAY_MS = 24 * 60 * 60_000
/** Floor so a token minted seconds ago isn't refreshed in a tight loop. */
const MIN_REFRESH_DELAY_MS = 30_000

/**
 * Delay (ms from `now`) until the next silent refresh should fire, or null
 * when the token has no `exp` (nothing to pre-empt) or is already expired
 * (the caller should sign out / re-auth, not schedule a refresh).
 *
 * The delay targets the moment `REFRESH_AT_REMAINING_FRACTION` of the token's
 * ORIGINAL lifetime remains — but since we don't know the issue time reliably,
 * we approximate from "remaining life" and clamp to [MIN, MAX].
 */
export function refreshDelayMs(token: string, now: number = Date.now()): number | null {
  const expMs = decodeJwtExpMs(token)
  if (expMs === null) return null
  const remaining = expMs - now
  if (remaining <= 0) return null
  const target = remaining * REFRESH_AT_REMAINING_FRACTION
  return Math.max(MIN_REFRESH_DELAY_MS, Math.min(MAX_REFRESH_DELAY_MS, target))
}

/** Does the token belong to a session opened by a device certificate (D855: the `cid` claim)? */
export function hasCredentialClaim(token: string): boolean {
  const parts = token.split('.')
  if (parts.length < 2 || !parts[1]) return false
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'))
    if (typeof payload !== 'object' || payload === null) return false
    const cid: unknown = Reflect.get(payload, 'cid')
    return typeof cid === 'string' && cid.length > 0
  } catch {
    return false
  }
}
