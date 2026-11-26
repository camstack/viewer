/**
 * pending-deep-link — the URL a cold start was OPENING, preserved across the
 * auth gate.
 *
 * A notification tap (or any Universal Link) on a cold or logged-out app used
 * to die at the `(app)` guard's bare `Redirect href="/"`: nothing captured the
 * intended URL, the index then redirected to `/cameras`, and the operator
 * concluded the link was broken. This is §3.4.1 of
 * docs/design/2026-08-18-notification-click-actions.md — the prerequisite,
 * not an enhancement.
 *
 * Module-level, not React state: the guard stashes DURING the render that
 * returns the Redirect (there is no later lifecycle moment — the subtree
 * unmounts), and the auth gate consumes it in a different subtree. Take-once
 * so a stale link can never replay on an unrelated later login.
 */

import { HUB_PARAM } from '../connection/hub-link.js'
import { parseHubOrigin } from '../connection/hub-origin.js'

/**
 * Route families a deep link may land on: the first path segment of every
 * route the `(app)` group serves, except the default landing `/cameras`.
 * Defaults and auth flows are not destinations — redirecting to them is what
 * this module prevents.
 *
 * Matched on whole segments: `/grids` is a family, `/gridsfoo` is not. A
 * prefix list that wrote `/grid/` silently refused `/grids` and every
 * `/settings/*`, so a cold link to them landed on the cameras (#708); a spec
 * walks `app/(app)` so a route added there cannot be dropped the same way.
 */
const DESTINATION_FAMILIES = [
  '/camera',
  '/events',
  '/grid',
  '/grids',
  '/notifications',
  '/settings',
  '/account',
  '/device',
  '/rule',
  '/timelapse-rule',
  '/summary-rule',
  '/retrain',
  '/remote',
  '/artifacts',
  '/exports',
] as const

let pending: string | null = null

export function isStashableDeepLink(href: string): boolean {
  const path = href.split(/[?#]/, 1)[0] ?? href
  return DESTINATION_FAMILIES.some((family) => path === family || path.startsWith(`${family}/`))
}

export function stashPendingDeepLink(href: string): void {
  if (!isStashableDeepLink(href)) return
  pending = href
}

/**
 * The hub a pending link named (`?hub=`), passed through the link gate — the
 * login prefills it. Read-only: the link itself is still consumed after login,
 * where `HubParamOffer` asks about the hub if the operator signed in elsewhere.
 */
export function peekPendingDeepLinkHub(): string | null {
  if (pending === null) return null
  const queryStart = pending.indexOf('?')
  if (queryStart === -1) return null
  return parseHubOrigin(new URLSearchParams(pending.slice(queryStart + 1)).get(HUB_PARAM))
}

/** Where a flow that a deep link started lands when it finishes: that link
 *  when it is one of the app's own route families, the cameras otherwise. */
export function deepLinkLanding(href: unknown): string {
  return typeof href === 'string' && isStashableDeepLink(href) ? href : '/cameras'
}

/** Read AND clear — a pending link is consumed exactly once. */
export function takePendingDeepLink(): string | null {
  const link = pending
  pending = null
  return link
}

/** Test seam. */
export function _resetPendingDeepLink(): void {
  pending = null
}
