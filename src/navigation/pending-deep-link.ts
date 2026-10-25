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

/** Path families a deep link may land on. Defaults and auth flows are not
 *  destinations — redirecting to them is what this module prevents. */
const STASHABLE_PREFIXES = ['/camera/', '/events', '/grid/', '/notifications'] as const

let pending: string | null = null

export function isStashableDeepLink(href: string): boolean {
  return STASHABLE_PREFIXES.some((p) => href === p || href.startsWith(p))
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
