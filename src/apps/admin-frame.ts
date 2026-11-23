/**
 * admin-frame — how the Admin app is put on screen, as pure rules.
 *
 * The Admin UI is loaded from the base URL the viewer's own endpoint race won
 * (LAN at home, the tunnel away): each origin is its own browser origin, so each
 * gets its own one-time handoff. On the web the viewer is served by the hub at
 * `/viewer/camstack/`, so the Admin is a same-origin iframe and nothing is
 * handed over; a viewer that is NOT on the hub's origin cannot frame it (the hub
 * answers `frame-ancestors 'self'`) and opens a tab instead.
 */
import { sameHubOrigin } from '../connection/hub-origin.js'

/** What the Admin app renders as. */
export type AdminFramePlan =
  /** Native: a WebView signed in by a one-time handoff. */
  | { readonly kind: 'webview-handoff' }
  /** Web, viewer on the hub's origin: a same-origin iframe, session shared. */
  | { readonly kind: 'iframe'; readonly src: string }
  /** Web, viewer elsewhere: the hub refuses to be framed — open a new tab. */
  | { readonly kind: 'new-tab'; readonly href: string }

export interface AdminFrameInput {
  readonly os: 'ios' | 'android' | 'web' | 'windows' | 'macos'
  /** The base URL the endpoint race won (no trailing slash needed). */
  readonly baseUrl: string
  /** `window.location.origin` on the web; `null` elsewhere. */
  readonly pageOrigin: string | null
}

export function trimBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

export function adminRootUrl(baseUrl: string): string {
  return `${trimBase(baseUrl)}/`
}

export function planAdminFrame(input: AdminFrameInput): AdminFramePlan {
  if (input.os !== 'web') return { kind: 'webview-handoff' }
  const href = adminRootUrl(input.baseUrl)
  if (input.pageOrigin !== null && sameHubOrigin(input.baseUrl, input.pageOrigin)) {
    return { kind: 'iframe', src: href }
  }
  return { kind: 'new-tab', href }
}

/** The hub path a handoff mint must answer with; anything else is not trusted. */
export const HANDOFF_PATH_PREFIX = '/api/auth/browser-handoff?'

/** The hub-relative handoff path, or `null` when the answer is not one. */
export function parseHandoffPath(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null
  const path: unknown = Reflect.get(raw, 'path')
  return typeof path === 'string' && path.startsWith(HANDOFF_PATH_PREFIX) ? path : null
}

/** The absolute URL a WebView loads to be signed in: base + the one-time path. */
export function handoffUrl(baseUrl: string, path: string): string {
  return `${trimBase(baseUrl)}${path}`
}

/**
 * Whether to OFFER switching to a faster route: the page was loaded on a remote
 * route and the race now sits on a local one. Never reload under the user — the
 * caller shows a banner and waits for a tap.
 */
export function shouldOfferLocalSwitch(loadedLocal: boolean, nowLocal: boolean, loadedBase: string, nowBase: string): boolean {
  return !loadedLocal && nowLocal && trimBase(loadedBase) !== trimBase(nowBase)
}

/**
 * The script a native frame runs before its page loads, telling the Admin UI the
 * viewer is hosting it (it hides its own entry to the viewer). Idempotent.
 */
export const EMBEDDED_BY_VIEWER_SCRIPT = 'window.__CAMSTACK_VIEWER_EMBED__ = true; true;'
