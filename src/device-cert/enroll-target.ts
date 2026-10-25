/**
 * Which hub does an enrollment link point at, and what must the person be told
 * before anything starts? A link or a QR is whatever someone put in front of
 * the phone, so it never enrolls by itself: the confirmation names the hub,
 * says when it is not one this device already knows, and waits for a tap.
 */
import { parseHubOrigin, sameHubOrigin, serverDisplayName } from '../connection/hub-origin.js'
import { isSecureHub } from './transport.js'

export interface EnrollTargetInput {
  /** The `hub` of the link: an origin, or null when the link names none. */
  readonly linkHub: string | null
  readonly servers: readonly { readonly id: string; readonly label: string; readonly serverUrl: string }[]
  /** The hub this device is signed in to right now, if any. */
  readonly signedInServerUrl: string | null
  readonly lastServerUrl: string | null
}

export type EnrollTarget =
  | { readonly status: 'unresolved'; readonly reason: 'invalid-hub' | 'no-hub' }
  | {
      readonly status: 'ready'
      /** The origin the enrollment will talk to. */
      readonly origin: string
      /** `serverDisplayName` of it: what the confirmation shows first. */
      readonly name: string
      /** Already one of this device's saved hubs (its id is then reused). */
      readonly knownServerId: string | null
      readonly knownLabel: string | null
      readonly knownServerUrl: string | null
      /** True when this hub is not in the saved list: the warning case. */
      readonly isNewHub: boolean
      /** The hub this device is signed in to, when that is another sign-in the link would replace. */
      readonly replacesSignInTo: string | null
    }

export function resolveEnrollTarget(input: EnrollTargetInput): EnrollTarget {
  const fromLink = input.linkHub !== null
  const origin = fromLink ? parseHubOrigin(input.linkHub) : parseHubOrigin(input.signedInServerUrl ?? input.lastServerUrl)
  if (origin === null) return { status: 'unresolved', reason: fromLink ? 'invalid-hub' : 'no-hub' }
  if (!isSecureHub(origin)) return { status: 'unresolved', reason: 'invalid-hub' }
  const known = input.servers.find((s) => sameHubOrigin(s.serverUrl, origin))
  return {
    status: 'ready',
    origin,
    name: serverDisplayName(origin),
    knownServerId: known?.id ?? null,
    knownLabel: known?.label ?? null,
    knownServerUrl: known?.serverUrl ?? null,
    isNewHub: known === undefined,
    replacesSignInTo: input.signedInServerUrl === null ? null : serverDisplayName(input.signedInServerUrl),
  }
}
