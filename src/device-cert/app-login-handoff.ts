/**
 * The app login handoff, D858 form: the hub's dedicated app flow (OIDC start
 * page, passkey page) in a system auth session, bound to this app run by a PKCE
 * challenge and a `state`, with a purpose (`new-session` opens a session;
 * `step-up` yields an enrollment proof and replaces nothing). The app never
 * opens the admin-UI login.
 *
 * Pure URL building and callback parsing live here so the refusals — a
 * foreign scheme, a `state` that is not ours, an error code — are specified
 * without a browser.
 */
import { canonicalizeCallbackUrl } from '../auth/handoff.js'
import { postHubAuthMutation, type FetchLike, type HubAuthOutcome } from '../auth/hub-auth-wire.js'
import type { PkcePair } from './pkce.js'

export type HandoffPurpose = 'new-session' | 'step-up'
export type AppLang = 'en' | 'it'

/** The hub page language for an i18n language tag: Italian, else English. */
export function handoffLang(resolvedLanguage: string | undefined): AppLang {
  return resolvedLanguage?.startsWith('it') === true ? 'it' : 'en'
}

/** The callback the hub's app flow falls back to; any other (the dev scheme) is sent as `redirect`. */
const DEFAULT_APP_CALLBACK = 'camstack://auth-callback'

/** A start path is a path on the hub's own origin: never `//host`, never a scheme. */
function isHubPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')
}

/** The URL the system auth session opens for one browser arm, or null for a start path that is not on the hub. */
export function buildAppFlowUrl(input: {
  readonly serverUrl: string
  readonly startPath: string
  readonly callbackUrl: string
  readonly pkce: Pick<PkcePair, 'codeChallenge' | 'state'>
  readonly purpose: HandoffPurpose
  /** The app's language, so the hub's page speaks it. */
  readonly lang?: AppLang
}): string | null {
  if (!isHubPath(input.startPath)) return null
  const query = new URLSearchParams({
    app: '1',
    code_challenge: input.pkce.codeChallenge,
    code_challenge_method: 'S256',
    state: input.pkce.state,
    purpose: input.purpose,
  })
  if (input.lang !== undefined) query.set('lang', input.lang)
  const callback = canonicalizeCallbackUrl(input.callbackUrl)
  if (callback.toLowerCase() !== DEFAULT_APP_CALLBACK) query.set('redirect', callback)
  return `${input.serverUrl.replace(/\/+$/, '')}${input.startPath}${input.startPath.includes('?') ? '&' : '?'}${query.toString()}`
}

/** Error codes the hub's app flows answer with; anything else is shown as `failed`. */
export const APP_FLOW_ERROR_CODES = [
  'sso-not-linked',
  'sso-state',
  'state-expired',
  'idp-error',
  'idp-failed',
  'provider-mismatch',
  'provider-disabled',
  'second-factor-required',
  'passkey-failed',
  'user-gone',
  'invalid-bridge',
  'not-app-flow',
  'step-up-not-fresh',
  'too-many-requests',
  'failed',
] as const
export type AppFlowErrorCode = (typeof APP_FLOW_ERROR_CODES)[number]

export function appFlowErrorCode(raw: string): AppFlowErrorCode {
  return APP_FLOW_ERROR_CODES.find((c) => c === raw) ?? 'failed'
}

/** The locale key of the message for an error code. */
export function appFlowErrorKey(code: AppFlowErrorCode): string {
  return `v2.login.appError.${code}`
}

export type CallbackParse =
  | { readonly status: 'ok'; readonly code: string }
  /** The user tapped Cancel on the hub's confirmation page: not an error. */
  | { readonly status: 'cancelled' }
  /** The hub's app flow refused and said why (`error=<code>`). */
  | { readonly status: 'error'; readonly code: AppFlowErrorCode }
  /** Not our callback (another scheme/path), no code, or a `state` that is not ours. */
  | { readonly status: 'refused'; readonly reason: 'foreign-url' | 'state-mismatch' | 'no-code' }

/**
 * Read the code off the URL the auth session returned. Only `expectedCallback`
 * (the exact canonical callback this run asked for) is accepted, and the
 * `state` must equal the one we sent — a code that arrives with any other is
 * never redeemed.
 */
export function parseHandoffCallback(
  returnedUrl: string,
  expectedCallback: string,
  expectedState: string,
): CallbackParse {
  const queryStart = returnedUrl.indexOf('?')
  const base = canonicalizeCallbackUrl(queryStart === -1 ? returnedUrl : returnedUrl.slice(0, queryStart))
  if (base.toLowerCase() !== canonicalizeCallbackUrl(expectedCallback).toLowerCase()) {
    return { status: 'refused', reason: 'foreign-url' }
  }
  const query = queryStart === -1 ? '' : (returnedUrl.slice(queryStart + 1).split('#')[0] ?? '')
  const params = new URLSearchParams(query)
  const error = params.get('error')
  // A refusal may precede a trusted bridge and carry no state; one that carries a
  // state must carry ours.
  if (error !== null && error.length > 0) {
    const echoed = params.get('state')
    if (echoed !== null && echoed !== expectedState) return { status: 'refused', reason: 'state-mismatch' }
    if (error === 'cancelled') return { status: 'cancelled' }
    return { status: 'error', code: appFlowErrorCode(error) }
  }
  if (params.get('state') !== expectedState) return { status: 'refused', reason: 'state-mismatch' }
  const code = params.get('code')
  return code !== null && code.length > 0 ? { status: 'ok', code } : { status: 'refused', reason: 'no-code' }
}

/** Redeem a bound handoff code (PUBLIC procedure) for a refreshing session. */
export async function redeemBoundHandoffCode(
  serverUrl: string,
  bound: { readonly code: string; readonly codeVerifier: string; readonly state: string },
  fetchFn?: FetchLike,
): Promise<HubAuthOutcome> {
  return postHubAuthMutation({
    baseUrl: serverUrl,
    procedure: 'auth.redeemHandoffCode',
    input: { code: bound.code, codeVerifier: bound.codeVerifier, state: bound.state, refreshable: true },
    ...(fetchFn ? { fetchFn } : {}),
  })
}
