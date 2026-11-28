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
import type { AppEntry } from '@dominevo/types'

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
  /** The hub-relative path the app is served at (its entry's `path`). Defaults to the hub root. */
  readonly path?: string
  /** How the app signs in: a one-time handoff (native) or the browser's own session cookie. Defaults to `handoff`. */
  readonly auth?: 'handoff' | 'session-cookie'
}

/** The URL of an embedded app: the base the race won plus the app's own path. */
export function appUrl(baseUrl: string, path: string): string {
  return `${trimBase(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`
}

export function trimBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

export function adminRootUrl(baseUrl: string): string {
  return `${trimBase(baseUrl)}/`
}

/** Where the admin SPA serves an addon page: `/addon/:pagePath`. */
export const ADDON_PAGE_MOUNT = '/addon'

/** What to frame for an app entry: the hub-relative path and how the frame signs in. */
export interface FrameTarget {
  readonly path: string
  readonly auth: 'handoff' | 'session-cookie'
  /** A handoff lands on the admin root: the page the frame must be sent to once it says `ready`. */
  readonly openAfterHandoff: string | null
}

/** The frame an entry is shown in, or `null` for an entry the shell draws itself (`native`). */
export function frameTargetOf(entry: AppEntry): FrameTarget | null {
  if (entry.kind === 'web') return { path: entry.path, auth: entry.auth, openAfterHandoff: null }
  if (entry.kind === 'addon-page') {
    const path = `${ADDON_PAGE_MOUNT}/${encodeURIComponent(entry.pageId)}`
    return { path, auth: 'handoff', openAfterHandoff: path }
  }
  return null
}

export function planAdminFrame(input: AdminFrameInput): AdminFramePlan {
  const href = appUrl(input.baseUrl, input.path ?? '/')
  if (input.os !== 'web') {
    // A webview carries no browser session: only a handoff can sign it in.
    return input.auth === 'session-cookie' ? { kind: 'new-tab', href } : { kind: 'webview-handoff' }
  }
  if (input.pageOrigin !== null && sameHubOrigin(input.baseUrl, input.pageOrigin)) {
    return { kind: 'iframe', src: href }
  }
  return { kind: 'new-tab', href }
}

/**
 * The `auth.createBrowserHandoff` landing every `auth: 'handoff'` web app signs
 * in through. The hub knows only `account | admin` (a landing kind, not an app
 * id); the app's own entry path is what the frame then opens.
 */
export const HANDOFF_LANDING = 'admin'

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
 * The script a native frame runs before its page loads, telling the app the
 * viewer is hosting it (the older signal; the `hello` bridge message is the one
 * an app goes chromeless on). Idempotent.
 */
export const EMBEDDED_BY_VIEWER_SCRIPT = 'window.__CAMSTACK_VIEWER_EMBED__ = true; true;'
