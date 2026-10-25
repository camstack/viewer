/**
 * notifier-icon — a pure, RN-free helper that resolves a notifier kind's
 * server-served brand icon into an absolute, renderable image URL.
 *
 * The notifiers addon serves one bundled brand icon per kind over its own
 * data-plane route (`GET /addon/notifiers/icons/<kind>`) and stamps the
 * root-relative path onto each kind descriptor as `iconUrl` (see the server's
 * `iconUrlFor`). The viewer receives it via `listTargetKinds` and must join it
 * against the connected hub's base URL to load it in an `<Image>`.
 *
 * Kept out of the React component so the join logic is unit-testable in the
 * repo's node test env (mirrors `snapshot-media-url.ts`).
 */

/** Strip trailing slashes so we never emit a `//` when joining base + path. */
function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

/**
 * Absolute brand-icon URL for a notifier kind, or `null` when it cannot be
 * built (missing hub base or no `iconUrl` on the kind — the caller then renders
 * a neutral fallback glyph).
 *
 * `iconUrl` is normally the server's root-relative path
 * (`/addon/notifiers/icons/telegram`); an already-absolute `http(s)://` URL is
 * passed through unchanged (defensive — the server does not send one today).
 */
export function buildNotifierIconUrl(
  serverUrl: string | null | undefined,
  iconUrl: string | null | undefined,
): string | null {
  if (!iconUrl) return null
  if (/^https?:\/\//i.test(iconUrl)) return iconUrl
  if (!serverUrl) return null
  const base = trimTrailingSlashes(serverUrl)
  const path = iconUrl.startsWith('/') ? iconUrl : `/${iconUrl}`
  return `${base}${path}`
}

/**
 * `true` when a kind's icon must be drawn by the SVG renderer.
 *
 * ABSENT is deliberately treated as raster: it is what a legacy server that
 * does not stamp `iconMediaType` sends, and expo-image handling a PNG is a
 * working path — whereas handing a PNG to the SVG parser is not. Match on the
 * type only, ignoring any `; charset=…` parameter.
 */
export function isSvgMediaType(mediaType: string | null | undefined): boolean {
  if (!mediaType) return false
  return mediaType.split(';')[0]?.trim().toLowerCase() === 'image/svg+xml'
}
