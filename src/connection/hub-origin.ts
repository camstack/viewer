/**
 * hub-origin — the ONE gate a hub URL arriving from a LINK must pass.
 *
 * Same rule as the link domain's `parseHubUrl`
 * (camstack-server `apps/link/public/link-logic.mjs`): `https:` only, an origin
 * and nothing else — no credentials, no path, no query, no fragment. A link is
 * attacker-writable; a hub it names is at most a SUGGESTION the operator
 * confirms, and this is what keeps that suggestion to a bare origin.
 *
 * Pure, no React, no react-native — the node test suite imports it directly.
 */

/** The canonical origin of a link-supplied hub URL, or `null` when refused. */
export function parseHubOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '') return null
  if (url.hostname === '') return null
  if (url.search !== '' || url.hash !== '') return null
  if (url.pathname !== '/' && url.pathname !== '') return null
  return url.origin
}

/** The origin of a SAVED server URL (operator-typed, may be http or carry a
 *  trailing slash), or `null` when it does not parse. */
export function originOf(url: string): string | null {
  try {
    return new URL(url.trim()).origin
  } catch {
    return null
  }
}

/** Do two URLs name the same hub (same scheme, host and port)? */
export function sameHubOrigin(a: string, b: string): boolean {
  const left = originOf(a)
  return left !== null && left === originOf(b)
}

/** A short display name for a saved server: its host (with port), or the raw
 *  URL when it does not parse. */
export function serverDisplayName(serverUrl: string): string {
  try {
    return new URL(serverUrl.trim()).host || serverUrl
  } catch {
    return serverUrl
  }
}
