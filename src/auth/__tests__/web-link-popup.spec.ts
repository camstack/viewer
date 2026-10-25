/**
 * The web viewer's half of the SSO popup contract (admin-ui `lib/sso-popup.ts`).
 */
import { describe, expect, it } from 'vitest'
import { linkOutcomeFromQuery, profileQueryOf, withPopupFlag } from '../web-link-popup.js'

describe('withPopupFlag', () => {
  it('keeps a relative hub path relative', () => {
    expect(withPopupFlag('/addon/auth-oidc/a/start?link=li_1')).toBe('/addon/auth-oidc/a/start?link=li_1&popup=1')
  })
  it('keeps an absolute URL absolute', () => {
    expect(withPopupFlag('https://hub.example/x/start?link=li_1')).toBe('https://hub.example/x/start?link=li_1&popup=1')
  })
})

describe('profileQueryOf', () => {
  it('reads a link completion', () => {
    expect(
      profileQueryOf({ type: 'camstack:sso-return', completion: { target: 'profile', query: 'linked=auth-oidc%2Fa' } }),
    ).toBe('linked=auth-oidc%2Fa')
  })
  it('ignores a LOGIN completion — it carries a session this page must not take', () => {
    expect(profileQueryOf({ type: 'camstack:sso-return', completion: { target: 'login', fragment: 'token=x' } })).toBeNull()
  })
  it('ignores anything else', () => {
    expect(profileQueryOf({ type: 'other' })).toBeNull()
    expect(profileQueryOf('linked=1')).toBeNull()
  })
})

describe('linkOutcomeFromQuery', () => {
  it('linked, refused, or nothing said', () => {
    expect(linkOutcomeFromQuery('linked=auth-oidc%2Fa')).toEqual({ kind: 'linked' })
    expect(linkOutcomeFromQuery('linkError=conflict')).toEqual({ kind: 'error', reason: 'conflict' })
    expect(linkOutcomeFromQuery('')).toEqual({ kind: 'closed' })
  })
})
