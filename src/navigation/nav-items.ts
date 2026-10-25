/**
 * The app's top-level destinations, and the active-route test — the ONE list.
 *
 * Extracted from `TabsNavigator` when the side rail stopped being the tab
 * navigator's private business: a wide window keeps the rail on screen over the
 * camera detail, which is a STACK route pushed above the tabs and therefore has
 * no `<Tabs>` context of its own. Two copies of this list would be two answers
 * to "which destination is highlighted", and the one on the detail screen would
 * be the one nobody looked at.
 *
 * Pure (no React, no react-native) so both the rail and its tests can read it.
 */
import type { Href } from 'expo-router'

import { Video, LayoutGrid, Zap, Settings, Bell, type LucideIcon } from '../lib/icons.js'

export interface NavItem {
  /** expo-router trigger/route name (matches app/(app)/(tabs)/<name>.tsx). */
  readonly name: string
  /** Destination href registered on the hidden TabList. */
  readonly href: Href
  /** i18n key under `nav.*`. */
  readonly key: string
  /** Route segment used for active-state matching (e.g. `/cameras`). */
  readonly segment: string
  readonly icon: LucideIcon
}

export const navItems: readonly NavItem[] = [
  { name: 'cameras', href: '/cameras', key: 'cameras', segment: '/cameras', icon: Video },
  { name: 'grids', href: '/grids', key: 'grids', segment: '/grids', icon: LayoutGrid },
  // Library — the route stays `/events` so shared deep links keep resolving;
  // only the label moved on (`nav.library`), because the tab now holds the
  // Artifacts gallery beside the events page.
  { name: 'events', href: '/events', key: 'library', segment: '/events', icon: Zap },
  {
    name: 'notifications',
    href: '/notifications' as Href,
    key: 'notifications',
    segment: '/notifications',
    icon: Bell,
  },
] as const

/**
 * Settings is a ROUTE, not a destination in the bar: it is reached from the
 * account menu (`UserMenuButton`). It still has to be registered with the
 * headless tab navigator or `/settings` would not resolve, so the registered
 * list is the bar's list plus it.
 */
export const settingsTab: NavItem = {
  name: 'settings',
  href: '/settings',
  key: 'settings',
  segment: '/settings',
  icon: Settings,
}

export const registeredTabs: readonly NavItem[] = [...navItems, settingsTab]

/** Active when the current path is exactly the segment or nested under it. */
export function isItemActive(pathname: string, segment: string): boolean {
  return pathname === segment || pathname.startsWith(`${segment}/`)
}

/**
 * The destination a DETAIL route belongs to.
 *
 * `/camera/102` is not any tab's segment, but it was opened from the cameras
 * list and that is the rail entry an operator expects lit while looking at it.
 * Without this the rail on the camera detail highlights nothing, which reads as
 * "you are nowhere".
 */
const DETAIL_HOME: Readonly<Record<string, string>> = Object.freeze({
  '/camera': '/cameras',
  '/grid': '/grids',
})

/**
 * What pressing a nav entry should DO from where we are.
 *
 * The bar used to answer this with one line — `if (isActive) return` — and that
 * line is why pressing "Cameras" while looking at a camera did nothing at all.
 * A detail route LIGHTS its parent entry (see {@link DETAIL_HOME}, which is
 * correct: "you are nowhere" is worse), so `isActive` was true on
 * `/camera/101` and the press was swallowed.
 *
 * The two cases are different questions:
 *   - already AT the entry's own route → nothing to do;
 *   - at a DETAIL above it → go back to the list, which is what every operator
 *     means by pressing the tab they are already lit on.
 */
export function navPressAction(pathname: string, segment: string): 'noop' | 'navigate' {
  return isItemActive(pathname, segment) ? 'noop' : 'navigate'
}

/** Which rail entry a pathname lights up — tab segment, or its detail parent. */
export function activeNavSegment(pathname: string): string | null {
  for (const item of navItems) {
    if (isItemActive(pathname, item.segment)) return item.segment
  }
  for (const [prefix, segment] of Object.entries(DETAIL_HOME)) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return segment
  }
  return null
}
