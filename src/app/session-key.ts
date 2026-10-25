/**
 * Which SESSION the app is in, as a non-secret value.
 *
 * Two consumers: the `me` query key (final review I2) and the reset of the
 * per-user caches on a session change (re-review N2). Both derive it from the
 * token `ServerProvider` holds, because every sign-in — another account,
 * another hub, the same account again, the hub-served web bootstrap — goes
 * through `ServerProvider.save`, which always installs a new token; a value
 * derived from it cannot miss a sign-in path added later, the way a flag
 * bumped in each handler could. Derived from the SESSION token, which a silent
 * renewal (D812) leaves alone: same session.
 */

/** FNV-1a offset bases for the two halves of {@link sessionDiscriminator}. */
const FNV_OFFSET_A = 0x811c9dc5
const FNV_OFFSET_B = 0x01000193
const FNV_PRIME = 0x01000193

function fnv1a32(text: string, offset: number): string {
  let hash = offset
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * A short, NON-SECRET name for a session token: 64 bits of two FNV-1a hashes.
 * Lossy, so the token cannot be recovered from it, and anything keyed on it can
 * surface in devtools, logs and error reports without leaking the credential.
 * Not a security primitive — only a discriminator between the handful of
 * sessions one device sees.
 */
export function sessionDiscriminator(token: string | null): string | null {
  if (token === null) return null
  return `${fnv1a32(token, FNV_OFFSET_A)}${fnv1a32(token, FNV_OFFSET_B)}`
}

/** The whole session identity: the hub and the (hashed) token. */
export function sessionIdentity(serverUrl: string | null, token: string | null): string {
  return `${serverUrl ?? ''}|${sessionDiscriminator(token) ?? ''}`
}

/**
 * Caches that hold what ONE user may see and that no key scopes to the
 * session. Reset when the session changes, or the next user is served the
 * previous user's answer as if the hub had given it to him: `['v2','nc']`
 * feeds the notification editors' save gate and ownership filter (his own
 * targets), `['v2','users']` is the admin-only user list.
 */
export const PER_SESSION_QUERY_PREFIXES: readonly (readonly string[])[] = [
  ['v2', 'nc'],
  ['v2', 'users'],
]
