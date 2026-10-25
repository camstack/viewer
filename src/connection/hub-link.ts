/**
 * hub-link — what a link naming a hub (`/connect?hub=…`, or any deep link
 * carrying `?hub=`) may do to the app's servers.
 *
 * The rule (operator decision 2026-10-06): a link OFFERS, it never replaces.
 * The active server changes only when the operator taps "Switch" or completes
 * a sign-in; a crafted link can at most put a question on screen. Same posture
 * as the link domain's "`?hub=` seeds only an empty storage".
 *
 * Pure: the screens ask this module, then render the answer.
 */
import { parseHubOrigin, sameHubOrigin } from './hub-origin.js'

/** The query parameter a link names its hub with — the link domain's own. */
export const HUB_PARAM = 'hub'

export interface HubLinkServer {
  readonly id: string
  readonly serverUrl: string
  /** Holds an unexpired token for this server. */
  readonly signedIn: boolean
}

export interface HubLinkInput {
  /** The raw `hub` parameter, exactly as the link carried it. */
  readonly hub: unknown
  readonly servers: readonly HubLinkServer[]
  readonly activeServerId: string | null
}

export type HubLinkDecision =
  /** No `hub`, or one the origin gate refuses. Nothing to offer. */
  | { readonly kind: 'invalid' }
  /** The link names the server the app is already signed in to. */
  | { readonly kind: 'active' }
  /** A saved, signed-in server that is not the active one: offer a switch. */
  | { readonly kind: 'switch'; readonly serverId: string; readonly serverUrl: string }
  /** Not saved, or saved but signed out: offer the login, prefilled. */
  | { readonly kind: 'sign-in'; readonly serverUrl: string }

export function decideHubLink(input: HubLinkInput): HubLinkDecision {
  const origin = parseHubOrigin(input.hub)
  if (origin === null) return { kind: 'invalid' }
  const saved = input.servers.find((s) => sameHubOrigin(s.serverUrl, origin))
  if (saved === undefined) return { kind: 'sign-in', serverUrl: origin }
  if (!saved.signedIn) return { kind: 'sign-in', serverUrl: saved.serverUrl }
  if (saved.id === input.activeServerId) return { kind: 'active' }
  return { kind: 'switch', serverId: saved.id, serverUrl: saved.serverUrl }
}

/** The raw `hub` value of a query-param bag (expo-router hands arrays for a
 *  repeated key — a repeated `hub` is ambiguous and refused). */
export function hubParamOf(params: Readonly<Record<string, string | string[] | undefined>>): string | null {
  const value = params[HUB_PARAM]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** `href` with its `hub` parameter removed — where to land once the offer is
 *  answered, so the same link does not ask again. */
export function withoutHubParam(href: string): string {
  const queryStart = href.indexOf('?')
  if (queryStart === -1) return href
  const path = href.slice(0, queryStart)
  const query = new URLSearchParams(href.slice(queryStart + 1))
  query.delete(HUB_PARAM)
  const rest = query.toString()
  return rest.length > 0 ? `${path}?${rest}` : path
}
