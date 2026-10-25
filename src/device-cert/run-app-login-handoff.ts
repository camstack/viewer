/**
 * One leg of the app login handoff: PKCE pair → the hub's app flow
 * (D858) in a system auth session → the callback, checked. Returns the code and the
 * verifier it must be redeemed with; redeeming (a session, or an enrollment
 * proof for `step-up`) is the caller's.
 */
import {
  buildAppFlowUrl,
  parseHandoffCallback,
  type AppFlowErrorCode,
  type HandoffPurpose,
} from './app-login-handoff.js'
import { createPkcePair, type PkcePrimitives } from './pkce.js'

export type AuthSessionResult =
  | { readonly type: 'success'; readonly url: string }
  | { readonly type: 'cancel' | 'dismiss' | 'locked' | 'opened' }

export interface HandoffDeps {
  readonly pkce: PkcePrimitives
  /** `WebBrowser.openAuthSessionAsync` in the app. */
  readonly openAuthSession: (url: string, returnUrl: string) => Promise<AuthSessionResult>
  /** The canonical `camstack://auth-callback` (or the dev scheme). */
  readonly callbackUrl: string
  /** The app's current language (`i18n.resolvedLanguage`), read per run. */
  readonly lang?: () => 'en' | 'it'
}

export type HandoffLeg =
  | {
      readonly status: 'code'
      readonly code: string
      readonly codeVerifier: string
      readonly state: string
    }
  | { readonly status: 'cancelled' }
  | { readonly status: 'error'; readonly code: AppFlowErrorCode }
  | { readonly status: 'refused'; readonly reason: 'foreign-url' | 'state-mismatch' | 'no-code' | 'bad-start-path' }

export async function runAppLoginHandoff(
  deps: HandoffDeps,
  input: { readonly serverUrl: string; readonly startPath: string; readonly purpose: HandoffPurpose },
): Promise<HandoffLeg> {
  const pkce = await createPkcePair(deps.pkce)
  const flowUrl = buildAppFlowUrl({
    serverUrl: input.serverUrl,
    startPath: input.startPath,
    callbackUrl: deps.callbackUrl,
    pkce,
    purpose: input.purpose,
    lang: deps.lang?.() ?? 'en',
  })
  if (flowUrl === null) return { status: 'refused', reason: 'bad-start-path' }
  const result = await deps.openAuthSession(flowUrl, deps.callbackUrl)
  if (result.type !== 'success') return { status: 'cancelled' }
  const parsed = parseHandoffCallback(result.url, deps.callbackUrl, pkce.state)
  if (parsed.status === 'cancelled') return { status: 'cancelled' }
  if (parsed.status === 'error') return { status: 'error', code: parsed.code }
  if (parsed.status === 'refused') return { status: 'refused', reason: parsed.reason }
  return { status: 'code', code: parsed.code, codeVerifier: pkce.codeVerifier, state: pkce.state }
}
