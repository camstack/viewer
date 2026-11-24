/**
 * Which top bar a route wears — ONE pure map, so "does this screen have a bar"
 * is answered in one place and pinned by a spec instead of by each screen.
 *
 *   - `home`  the list pages (Cameras, Library, Grids, Notifications, Settings
 *             root): ☰ · logo · bell · avatar on a phone, the 56 px top bar on a
 *             wide window.
 *   - `inner` a detail page that is read or edited (a settings sub-page, a rule,
 *             a device): ← title ☰, drawn by the page's own `ScreenHeader`.
 *   - `none`  a picture (the live camera, a grid wall) or anything not listed:
 *             full height, with its own overlay controls. An unknown route is
 *             `none` on purpose — a new screen never grows a bar by accident.
 *
 * Pure (no React, no expo-router) so the specs read it directly.
 */

export type BarKind = 'home' | 'inner' | 'none'

/** The tab routes, exactly (`/settings` is the root; `/settings/…` is inner). */
const HOME_ROUTES: readonly string[] = ['/', '/cameras', '/events', '/grids', '/notifications', '/settings']

/** Stacked detail routes that read or edit something, matched by prefix. */
const INNER_PREFIXES: readonly string[] = [
  '/settings/',
  '/notifications/',
  '/rule/',
  '/timelapse-rule/',
  '/summary-rule/',
  '/device/',
  '/retrain/',
  '/remote/',
  '/artifacts',
  '/exports',
]

function cleanPath(pathname: string): string {
  const bare = pathname.split('?')[0] ?? pathname
  return bare.length > 1 && bare.endsWith('/') ? bare.slice(0, -1) : bare
}

export function barKindForPath(pathname: string): BarKind {
  const path = cleanPath(pathname)
  if (HOME_ROUTES.includes(path)) return 'home'
  // A grid wall is a picture; its editor is a form.
  if (path === '/grid/adhoc') return 'none'
  if (/^\/grid\/[^/]+\/edit$/.test(path)) return 'inner'
  if (INNER_PREFIXES.some((prefix) => path === prefix.replace(/\/$/, '') || path.startsWith(prefix))) return 'inner'
  return 'none'
}

/** The home bar's two shapes: the phone's 48 px bar, the wide window's 56 px bar beside the rail. */
export type HomeBarVariant = 'phone' | 'wide'

export const PHONE_BAR_HEIGHT = 48
export const WIDE_BAR_HEIGHT = 56

/**
 * Phone landscape also shows the (compact) rail, but its height is scarce: it
 * keeps the 48 px phone bar. Only a tablet or a wide window gets the 56 px one.
 */
export function homeBarVariant({ showSidebar, compact }: { readonly showSidebar: boolean; readonly compact: boolean }): HomeBarVariant {
  return showSidebar && !compact ? 'wide' : 'phone'
}

export function homeBarHeight(variant: HomeBarVariant): number {
  return variant === 'wide' ? WIDE_BAR_HEIGHT : PHONE_BAR_HEIGHT
}
