/**
 * Linking a sign-in account from the WEB viewer (D782 / D791).
 *
 * `auth.beginExternalLink` answers the provider's start URL. The hub's SSO
 * finish binds a link to the BROWSER session cookie of the user who asked —
 * the hub-served web viewer has it (`HubSessionBootstrap` exchanged it). Run
 * in a popup (`?popup=1`), the finish lands on admin-ui's `/sso-complete`,
 * which hands the outcome to `window.opener` by `postMessage` at its own
 * origin — the hub's, which is this page's origin too.
 *
 * The message contract mirrors admin-ui `lib/sso-popup.ts`
 * (`camstack:sso-return` → ack `camstack:sso-ack`); it is restated here
 * because the viewer cannot import from admin-ui. Only `target: 'profile'`
 * (a link outcome) is accepted, from the popup this page opened, at this
 * page's origin. A closed popup with no message still refreshes the list —
 * the finish may have landed on another hub address that cannot post here.
 */

export const SSO_POPUP_MESSAGE = 'camstack:sso-return'
export const SSO_POPUP_ACK = 'camstack:sso-ack'
const SSO_POPUP_NAME = 'camstack-sso'
const POPUP_FEATURES = 'popup=yes,width=520,height=680,resizable=yes,scrollbars=yes'
const POPUP_CLOSED_POLL_MS = 500

export type LinkOutcome = { readonly kind: 'linked' } | { readonly kind: 'error'; readonly reason: string } | { readonly kind: 'closed' }

/** `url` with `popup=1` — a relative hub path stays relative. */
export function withPopupFlag(url: string): string {
  const parsed = new URL(url, 'http://placeholder.invalid')
  parsed.searchParams.set('popup', '1')
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`
}

/** The outcome a profile completion query carries (`linked=…` / `linkError=…`). */
export function linkOutcomeFromQuery(query: string): LinkOutcome {
  const params = new URLSearchParams(query)
  const error = params.get('linkError')
  if (error !== null) return { kind: 'error', reason: error }
  return params.has('linked') ? { kind: 'linked' } : { kind: 'closed' }
}

/** The profile query in `data`, when it is a well-formed return message. */
export function profileQueryOf(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const message = data as { type?: unknown; completion?: unknown }
  if (message.type !== SSO_POPUP_MESSAGE) return null
  const completion = message.completion as { target?: unknown; query?: unknown } | null
  if (typeof completion !== 'object' || completion === null) return null
  return completion.target === 'profile' && typeof completion.query === 'string' ? completion.query : null
}

/**
 * Open a blank popup NOW (inside the click — a popup opened after an await is
 * what blockers block), to be pointed at the start URL once it is known.
 * `null` when blocked.
 */
export function openLinkPopup(): Window | null {
  try {
    return window.open('about:blank', SSO_POPUP_NAME, POPUP_FEATURES) ?? null
  } catch {
    return null
  }
}

/**
 * Navigate `popup` to the start URL (resolved against the HUB, not this page:
 * a dev or third-party-served viewer is at another origin) and resolve with
 * what came back. A message is accepted only from the hub's origin.
 */
export function runLinkPopup(popup: Window, startUrl: string, hubUrl: string): Promise<LinkOutcome> {
  const origin = new URL(hubUrl).origin
  popup.location.href = new URL(withPopupFlag(startUrl), hubUrl).toString()
  return new Promise((resolve) => {
    let settled = false
    const finish = (outcome: LinkOutcome): void => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      window.clearInterval(poll)
      resolve(outcome)
    }
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== popup || event.origin !== origin) return
      const query = profileQueryOf(event.data)
      if (query === null) return
      popup.postMessage({ type: SSO_POPUP_ACK }, origin)
      finish(linkOutcomeFromQuery(query))
    }
    window.addEventListener('message', onMessage)
    const poll = window.setInterval(() => {
      if (popup.closed) finish({ kind: 'closed' })
    }, POPUP_CLOSED_POLL_MS)
  })
}
