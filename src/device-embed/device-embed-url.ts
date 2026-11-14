/**
 * The hub's device card, as the viewer loads it.
 *
 * The device detail is ONE shareable block: the admin UI's
 * `/embed/device/<id>` page (the same `DeviceDetailModule` the admin's device
 * page mounts — hero, history, power supply, timed runs, consumables). The
 * viewer shows that page in a WebView (an `<iframe>` on the web build) instead
 * of keeping a native copy that lags it.
 *
 * ## Auth: the admin's stored session, seeded before the page boots
 *
 * The page sits behind the admin's `ProtectedRoute`, which signs in from the
 * session the admin keeps in localStorage (`camstack_admin_token`). The httpOnly
 * cookie alone does not sign the page in. So the viewer seeds that key with its
 * own LIVE access token before the page's scripts run — the same channel the
 * camera player uses for its token (`injectedJavaScriptBeforeContentLoaded`),
 * never the URL, never a credential login.
 *
 * Only the access token is seeded: the viewer owns the refresh. The refresh
 * and expiry keys are cleared so the page never rotates a refresh token the
 * viewer did not hand it. When the viewer renews its token, or opens another
 * device, it messages the document that is already up — it does not reload.
 */
import type { ThemeMode } from '../theme/tokens.js'

/** The admin's stored-session keys (`addon-admin-ui/src/lib/admin-session.ts`). */
export const ADMIN_ACCESS_TOKEN_KEY = 'camstack_admin_token'
export const ADMIN_REFRESH_TOKEN_KEY = 'camstack_admin_refresh'
export const ADMIN_TOKEN_EXPIRES_KEY = 'camstack_admin_token_expires'

/** The languages the embed page takes on `?lang=`. */
export type DeviceEmbedLang = 'en' | 'it'

/** The app's language, narrowed to one the embed page reads. */
export function deviceEmbedLang(language: string): DeviceEmbedLang {
  return language.toLowerCase().startsWith('it') ? 'it' : 'en'
}

export interface DeviceEmbedUrlInput {
  readonly serverUrl: string
  readonly deviceId: number
  readonly theme: ThemeMode
  readonly lang: DeviceEmbedLang
}

/**
 * `<hub>/embed/device/<id>?theme=…&lang=…&host=viewer` — no token, ever.
 * `host=viewer` tells the card that the header above it already names the device.
 */
export function buildDeviceEmbedUrl(input: DeviceEmbedUrlInput): string {
  const base = input.serverUrl.replace(/\/+$/, '')
  const query = new URLSearchParams({ theme: input.theme, lang: input.lang, host: 'viewer' })
  return `${base}/embed/device/${String(input.deviceId)}?${query.toString()}`
}

/**
 * The script a native WebView runs before the page's own: the viewer's access
 * token under the admin's key, the refresh pair cleared. A null token clears
 * the session, so a signed-out viewer never shows a card signed in earlier.
 */
export function buildSessionSeedScript(token: string | null): string {
  const set =
    token === null || token.length === 0
      ? `localStorage.removeItem(${JSON.stringify(ADMIN_ACCESS_TOKEN_KEY)});`
      : `localStorage.setItem(${JSON.stringify(ADMIN_ACCESS_TOKEN_KEY)},${JSON.stringify(token)});`
  return (
    `(function(){try{${set}` +
    `localStorage.removeItem(${JSON.stringify(ADMIN_REFRESH_TOKEN_KEY)});` +
    `localStorage.removeItem(${JSON.stringify(ADMIN_TOKEN_EXPIRES_KEY)});` +
    `}catch(e){}})(); true;`
  )
}

/**
 * Whether a URL the card navigated to is still the card. The admin redirects an
 * unauthenticated page to `/login`; inside the viewer that is a failure to show,
 * not a login form to offer (the viewer never signs in through a page).
 */
export function isDeviceEmbedPath(url: string): boolean {
  try {
    return /\/embed\/device\/[0-9]+\/?$/.test(new URL(url).pathname)
  } catch {
    return false
  }
}

/** Whether `url` is on the hub the card was loaded from. */
export function isSameHubOrigin(url: string, serverUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(serverUrl).origin
  } catch {
    return false
  }
}
