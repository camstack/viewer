/**
 * snapshot-image-auth — WHICH credential a snapshot `<Image>` carries, per platform.
 *
 * ## The header is not free on web, and it was never meant to be there
 *
 * `use-snapshot.ts` has documented since the URL path shipped that the Bearer is
 * attached "on native (`expo-image` honours it); omitted on web where the
 * same-origin session cookie authenticates the reverse-proxy". The code never
 * omitted it — a leftover that described the right design, which is worse than
 * no comment at all because it reads as verification.
 *
 * What the header actually does on web is switch `expo-image` onto a completely
 * different loader. Its web implementation (`expo-image/src/web/hooks.ts`,
 * `useHeaders`) cannot put a header on an `<img>`, so when `source.headers` is
 * present it instead:
 *
 *   1. `fetch()`es the URL from JS,
 *   2. awaits `.blob()`,
 *   3. `URL.createObjectURL(blob)`,
 *   4. and **renders nothing at all until step 3 lands** (`if (!objectURL)
 *      return null`).
 *
 * So on the hosted web viewer every tile went through a JS round trip with no
 * progressive decode, no HTTP-cache hit for a repeat paint, no browser
 * prioritisation, and — because that effect is keyed on the `source` OBJECT —
 * a fresh full download on every re-render of the card. A grid of sixteen
 * cameras therefore queued dozens of duplicate whole-JPEG fetches behind the
 * browser's per-origin connection limit, which is what "the snapshots do load,
 * but after an eternity" is.
 *
 * Without the header, `expo-image` hands the URL straight to an `<img>`: the
 * browser loads it natively, in parallel, from its own cache when the frame has
 * not moved, and attaches the httpOnly `camstack_session` cookie the hub-served
 * viewer already holds (`server/backend/src/auth/session-cookie.ts` — the
 * addon-route catch-all accepts it for `authenticated` routes).
 *
 * ## Why "same origin" and not simply "web"
 *
 * The cookie is the ONLY credential a plain `<img>` can carry, and it is scoped
 * to the origin that set it. A web viewer pointed at a DIFFERENT hub than the
 * one serving the page (the standalone PWA build, or an operator who typed
 * another server URL) has no such cookie, so there the header — and its slow
 * blob path — is still the only thing that works. Dropping it there would trade
 * a slow tile for a 401.
 *
 * Pure and injected (no `window`, no `Platform` read here) so both branches are
 * unit-testable; `use-snapshot.ts` supplies the real values.
 */

/** Everything the decision needs, and nothing that would make it impure. */
export interface SnapshotImageAuthInput {
  /** `Platform.OS`. */
  readonly platform: string
  /** The URL about to be painted, or null when there is nothing to paint. */
  readonly uri: string | null
  /** Hub session token; null before sign-in. */
  readonly token: string | null
  /**
   * `window.location.origin` of the page, or null off-browser. Supplied rather
   * than read so the rule can be tested for both a hub-served viewer and a
   * standalone one.
   */
  readonly pageOrigin: string | null
}

/**
 * The serving page's origin, or null off-browser.
 *
 * The ONE impure function in this module, kept here so every caller reads the
 * origin the same way and no surface invents a second answer. `globalThis` and
 * a shape check rather than `Platform.OS === 'web'`: a native bundle has no
 * `location` at all, and a WebView-hosted surface may.
 */
export function snapshotPageOrigin(): string | null {
  const loc: unknown = (globalThis as { location?: unknown }).location
  if (typeof loc !== 'object' || loc === null) return null
  const origin: unknown = (loc as { origin?: unknown }).origin
  return typeof origin === 'string' && origin.length > 0 ? origin : null
}

/** The origin of an absolute URL, or null when it has none (relative, `file:`). */
function originOf(uri: string): string | null {
  try {
    return new URL(uri).origin
  } catch {
    return null
  }
}

/**
 * True when this surface must attach `Authorization: Bearer …` to the image.
 *
 * False for a `file://` path (ours, unauthenticated — handing a token to the
 * platform image loader for nothing), for a missing token, and for a web page
 * fetching a snapshot from its OWN origin, where the session cookie already
 * authenticates the request and the header would only cost the blob path.
 */
export function shouldAttachSnapshotBearer(input: SnapshotImageAuthInput): boolean {
  const { platform, uri, token, pageOrigin } = input
  if (uri === null || token === null || token.length === 0) return false
  if (uri.startsWith('file:')) return false
  if (isSignedSnapshotLink(uri)) return false
  if (platform !== 'web') return true
  if (pageOrigin === null || pageOrigin.length === 0) return true
  return originOf(uri) !== pageOrigin
}

/**
 * The public, signed snapshot plane (`snapshot-link-url.ts` on the hub):
 * `/addon/snapshot/link/<deviceId>.jpg?…&exp=…&sig=…`. Its authority is the
 * HMAC in the URL, so it never needs — and must never be given — a header.
 */
const SIGNED_SNAPSHOT_LINK = /\/addon\/snapshot\/link\/[^/?]+\?(?:[^#]*&)?sig=/

export function isSignedSnapshotLink(uri: string): boolean {
  return SIGNED_SNAPSHOT_LINK.test(uri)
}

/** Everything the signed-link decision needs; pure, like the bearer rule. */
export interface SignedSnapshotLinkInput {
  /** `Platform.OS`. */
  readonly platform: string
  /** The hub base URL the app talks to. */
  readonly serverUrl: string | null
  /** `window.location.origin`, or null off-browser. */
  readonly pageOrigin: string | null
  /** The minted root-relative link, or null when none is held. */
  readonly linkPath: string | null
  /** When the link stops verifying (epoch ms); null = unknown. */
  readonly expiresAt: number | null
  readonly nowMs: number
  /** A link that already failed to load — never painted twice. */
  readonly failedLinkPath: string | null
}

/**
 * True when a web tile should paint the SIGNED link instead of the
 * authenticated media URL.
 *
 * A web viewer on another origin than its hub (the hosted PWA) can only
 * authenticate the media URL with a Bearer header, and a header turns every
 * tile into a CORS preflight (~110–140 ms each through the tunnel) plus a JS
 * `fetch` → blob → object URL per frame. The signed link is a plain `<img>`:
 * no header, no preflight, the browser's own loader and cache.
 *
 * Not on native: links expire while iOS is suspended, and the native file
 * cache already paints from disk. Not same-origin: the session cookie already
 * makes the media URL a plain `<img>`, with a URL that does not roll with the
 * link's expiry bucket. Not an expired link, nor one that already failed: the
 * media URL with a Bearer is the fallback that always works.
 */
export function shouldPaintSignedSnapshotLink(input: SignedSnapshotLinkInput): boolean {
  const { platform, serverUrl, pageOrigin, linkPath, expiresAt, nowMs, failedLinkPath } = input
  if (platform !== 'web') return false
  if (serverUrl === null || linkPath === null || linkPath.length === 0) return false
  if (linkPath === failedLinkPath) return false
  if (expiresAt !== null && expiresAt <= nowMs) return false
  if (pageOrigin === null || pageOrigin.length === 0) return false
  return originOf(serverUrl) !== pageOrigin
}
