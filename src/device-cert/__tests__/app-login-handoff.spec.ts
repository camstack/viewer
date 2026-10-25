import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { APP_FLOW_ERROR_CODES, appFlowErrorKey, buildAppFlowUrl, handoffLang, parseHandoffCallback, redeemBoundHandoffCode } from '../app-login-handoff.js'
import { runAppLoginHandoff, type AuthSessionResult } from '../run-app-login-handoff.js'
import { scriptedHub } from './helpers.js'

const CALLBACK = 'camstack://auth-callback'
const START = '/auth/app/passkey'
const PKCE = { codeChallenge: 'C'.repeat(43), state: 'st4te' }

describe('app flow URL', () => {
  const build = (callbackUrl: string, startPath = '/addon/auth-oidc/authentik/start') =>
    buildAppFlowUrl({ serverUrl: 'https://hub.example.com/', startPath, callbackUrl, pkce: PKCE, purpose: 'step-up' })

  it('carries app=1, the S256 challenge, state and purpose on the hub origin', () => {
    const url = new URL(build('camstack:///auth-callback') ?? '')
    expect(url.origin + url.pathname).toBe('https://hub.example.com/addon/auth-oidc/authentik/start')
    expect(url.searchParams.get('app')).toBe('1')
    expect(url.searchParams.get('code_challenge')).toBe(PKCE.codeChallenge)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('st4te')
    expect(url.searchParams.get('purpose')).toBe('step-up')
    expect(url.searchParams.has('redirect')).toBe(false)
  })

  it('carries the app language next to the purpose, and nothing when it is not given', () => {
    const withLang = buildAppFlowUrl({ serverUrl: 'https://hub.example.com', startPath: START, callbackUrl: CALLBACK, pkce: PKCE, purpose: 'step-up', lang: 'it' })
    expect(new URL(withLang ?? '').searchParams.get('lang')).toBe('it')
    expect(new URL(build(CALLBACK) ?? '').searchParams.has('lang')).toBe(false)
  })

  it('maps the i18n language to it or en', () => {
    expect(handoffLang('it')).toBe('it')
    expect(handoffLang('it-IT')).toBe('it')
    expect(handoffLang('en')).toBe('en')
    expect(handoffLang('de')).toBe('en')
    expect(handoffLang(undefined)).toBe('en')
  })

  it('sends the redirect only when the app registers the dev scheme', () => {
    expect(new URL(build('camstack.dev://auth-callback') ?? '').searchParams.get('redirect')).toBe('camstack.dev://auth-callback')
  })

  it('refuses a start path that leaves the hub origin', () => {
    for (const path of ['//evil.example/x', 'https://evil.example/x', 'x', '/a\\b']) expect(build(CALLBACK, path)).toBeNull()
  })

  it('never builds an admin-UI login URL', () => {
    const sources = ['../app-login-handoff.ts', '../run-app-login-handoff.ts', '../login-methods.ts', '../../screens/LoginScreen.tsx']
    for (const file of sources) {
      const text = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')
      expect(text, file).not.toMatch(/\/login\?|\/login`|buildBoundHandoffLoginUrl/)
    }
  })
})

describe('handoff callback parsing', () => {
  it('accepts the canonical and the three-slash callback with our state', () => {
    expect(parseHandoffCallback('camstack://auth-callback?code=chc_1&state=st4te', CALLBACK, 'st4te')).toEqual({ status: 'ok', code: 'chc_1' })
    expect(parseHandoffCallback('camstack:///auth-callback?code=chc_1&state=st4te', CALLBACK, 'st4te')).toEqual({ status: 'ok', code: 'chc_1' })
  })

  it('refuses another scheme, another path, and a lookalike host', () => {
    for (const url of [
      'evil://auth-callback?code=c&state=st4te',
      'https://auth-callback?code=c&state=st4te',
      'camstack://other?code=c&state=st4te',
      'camstack.dev://auth-callback?code=c&state=st4te',
    ]) {
      expect(parseHandoffCallback(url, CALLBACK, 'st4te')).toEqual({ status: 'refused', reason: 'foreign-url' })
    }
  })

  it('refuses a state that is not ours, or missing', () => {
    expect(parseHandoffCallback('camstack://auth-callback?code=c&state=other', CALLBACK, 'st4te')).toEqual({ status: 'refused', reason: 'state-mismatch' })
    expect(parseHandoffCallback('camstack://auth-callback?code=c', CALLBACK, 'st4te')).toEqual({ status: 'refused', reason: 'state-mismatch' })
  })

  it('reports an error code the hub sent, with or without our state', () => {
    expect(parseHandoffCallback('camstack://auth-callback?error=sso-not-linked&state=st4te', CALLBACK, 'st4te')).toEqual({ status: 'error', code: 'sso-not-linked' })
    expect(parseHandoffCallback('camstack://auth-callback?error=invalid-bridge', CALLBACK, 'st4te')).toEqual({ status: 'error', code: 'invalid-bridge' })
  })

  it('treats a cancel on the hub page as a quiet cancel, not an error', () => {
    expect(parseHandoffCallback('camstack://auth-callback?error=cancelled&state=st4te', CALLBACK, 'st4te')).toEqual({ status: 'cancelled' })
  })

  it('shows an unknown error code as failed, and refuses an error echoing another state', () => {
    expect(parseHandoffCallback('camstack://auth-callback?error=martian&state=st4te', CALLBACK, 'st4te')).toEqual({ status: 'error', code: 'failed' })
    expect(parseHandoffCallback('camstack://auth-callback?error=failed&state=other', CALLBACK, 'st4te')).toEqual({ status: 'refused', reason: 'state-mismatch' })
  })

  it('refuses a callback without a code', () => {
    expect(parseHandoffCallback('camstack://auth-callback?state=st4te', CALLBACK, 'st4te')).toEqual({ status: 'refused', reason: 'no-code' })
  })
})

describe('one handoff leg', () => {
  const pkce = { randomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => i + 1), sha256: async (b: Uint8Array) => b.slice(0, 32) }

  function deps(answer: (url: string) => AuthSessionResult) {
    const opened: string[] = []
    return {
      opened,
      deps: {
        pkce,
        callbackUrl: CALLBACK,
        openAuthSession: async (url: string) => {
          opened.push(url)
          return answer(url)
        },
      },
    }
  }

  it('opens the flow in the app language', async () => {
    const d = deps(() => ({ type: 'cancel' }))
    await runAppLoginHandoff({ ...d.deps, lang: () => 'it' }, { serverUrl: 'https://hub.example.com', startPath: START, purpose: 'new-session' })
    expect(new URL(d.opened[0] ?? '').searchParams.get('lang')).toBe('it')
  })

  it('returns the code with the verifier it was minted for', async () => {
    const d = deps((url) => ({ type: 'success', url: `${CALLBACK}?code=chc_9&state=${new URL(url).searchParams.get('state')}` }))
    const leg = await runAppLoginHandoff(d.deps, { serverUrl: 'https://hub.example.com', startPath: START, purpose: 'new-session' })
    expect(leg.status).toBe('code')
    if (leg.status === 'code') {
      expect(leg.code).toBe('chc_9')
      expect(leg.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    }
    expect(new URL(d.opened[0] ?? '').pathname).toBe(START)
    expect(new URL(d.opened[0] ?? '').searchParams.get('purpose')).toBe('new-session')
  })

  it('surfaces the hub error code and opens nothing for a start path off the hub', async () => {
    const refusing = deps(() => ({ type: 'success', url: `${CALLBACK}?error=second-factor-required` }))
    expect(await runAppLoginHandoff(refusing.deps, { serverUrl: 'https://h', startPath: START, purpose: 'new-session' })).toEqual({ status: 'error', code: 'second-factor-required' })
    const off = deps(() => ({ type: 'cancel' }))
    expect(await runAppLoginHandoff(off.deps, { serverUrl: 'https://h', startPath: '//evil/x', purpose: 'new-session' })).toEqual({ status: 'refused', reason: 'bad-start-path' })
    expect(off.opened).toEqual([])
  })

  it('is cancelled when the operator dismisses the sheet', async () => {
    const d = deps(() => ({ type: 'cancel' }))
    expect(await runAppLoginHandoff(d.deps, { serverUrl: 'https://h', startPath: START, purpose: 'new-session' })).toEqual({ status: 'cancelled' })
  })

  it('refuses a state mismatch instead of redeeming', async () => {
    const d = deps(() => ({ type: 'success', url: `${CALLBACK}?code=chc_9&state=forged` }))
    expect(await runAppLoginHandoff(d.deps, { serverUrl: 'https://h', startPath: START, purpose: 'new-session' })).toEqual({ status: 'refused', reason: 'state-mismatch' })
  })
})

describe('redeem', () => {
  it('sends code, verifier and state, asking for a refreshing session', async () => {
    const hub = scriptedHub({
      'auth.redeemHandoffCode': () => ({ token: 't', user: { id: '1', username: 'u', isAdmin: false }, refreshToken: 'csr_1' }),
    })
    const out = await redeemBoundHandoffCode('https://hub', { code: 'c', codeVerifier: 'v', state: 's' }, hub.fetchFn)
    expect(out.status).toBe('ok')
    expect(hub.calls[0]?.input).toEqual({ code: 'c', codeVerifier: 'v', state: 's', refreshable: true })
  })
})

describe('error messages', () => {
  it('every code has a translated message in both languages', () => {
    const read = (lang: string): Record<string, unknown> => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../locales/${lang}.json`, import.meta.url)), 'utf8'))
    const dig = (tree: Record<string, unknown>, key: string): unknown => key.split('.').reduce<unknown>((node, part) => (typeof node === 'object' && node !== null ? Reflect.get(node, part) : undefined), tree)
    for (const lang of ['en', 'it']) {
      const tree = read(lang)
      for (const code of APP_FLOW_ERROR_CODES) expect(typeof dig(tree, appFlowErrorKey(code)), `${lang} ${code}`).toBe('string')
    }
  })
})
