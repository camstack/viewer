/**
 * The Sign-in methods screen's wire boundary: every answer parsed field by
 * field, so a hub sending an unknown shape degrades one row, not the screen.
 */
import { describe, expect, it } from 'vitest'
import {
  groupSecret,
  normalizeTotpCode,
  parseBrowserHandoffPath,
  parseLinkCallback,
  parseLinkClaim,
  parseLinkStartUrl,
  parseLinkableProviders,
  parseLinkedAccounts,
  parsePasskeys,
  parseSecondFactorPreference,
  parseTotpEnrollment,
  parseTotpStatus,
  passwordFormProblem,
  providersToLink,
} from '../sign-in-methods.js'

describe('TOTP', () => {
  it('status: enabled only on a literal true', () => {
    expect(parseTotpStatus({ enabled: true, confirmedAt: 5 })).toEqual({ enabled: true, confirmedAt: 5 })
    expect(parseTotpStatus({ enabled: 'yes' })).toEqual({ enabled: false, confirmedAt: null })
    expect(parseTotpStatus(null)).toEqual({ enabled: false, confirmedAt: null })
  })

  it('enrollment needs a secret and an otpauth URL', () => {
    expect(parseTotpEnrollment({ secret: 'ABC', otpauthUrl: 'otpauth://totp/x?secret=ABC' })).toEqual({
      secret: 'ABC',
      otpauthUrl: 'otpauth://totp/x?secret=ABC',
    })
    expect(parseTotpEnrollment({ secret: 'ABC', otpauthUrl: 'https://evil' })).toBeNull()
    expect(parseTotpEnrollment({ secret: '', otpauthUrl: 'otpauth://totp/x' })).toBeNull()
  })

  it('a typed code keeps six digits and nothing else', () => {
    expect(normalizeTotpCode(' 12-34 567 ')).toBe('123456')
  })

  it('the secret reads in groups of four', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP')
    expect(groupSecret('ABCDE')).toBe('ABCD E')
  })
})

describe('passkeys', () => {
  it('keeps well-formed entries and drops the rest', () => {
    expect(
      parsePasskeys([
        { credentialId: 'c1', label: 'iPhone', createdAt: 1, lastUsedAt: null, transports: [] },
        { credentialId: 'c2', createdAt: 2, lastUsedAt: 9 },
        { label: 'orphan' },
      ]),
    ).toEqual([
      { credentialId: 'c1', label: 'iPhone', createdAt: 1, lastUsedAt: null },
      { credentialId: 'c2', label: '', createdAt: 2, lastUsedAt: 9 },
    ])
  })

  it('second factor is on only on a literal true', () => {
    expect(parseSecondFactorPreference({ enabled: true })).toBe(true)
    expect(parseSecondFactorPreference({ enabled: 1 })).toBe(false)
  })
})

describe('linked accounts', () => {
  const linked = parseLinkedAccounts([
    {
      provider: 'auth-oidc/authentik',
      subject: 's1',
      label: 'me@example.com',
      linkedAt: 10,
      providerLabel: 'Authentik',
      available: true,
    },
    // A provider the operator removed: the link is still LISTED, so it can be
    // unlinked — hiding it would leave an identity nobody can see.
    { provider: 'auth-oidc/old', subject: 's2', linkedAt: 5, providerLabel: null, available: false },
  ])

  it('lists unavailable links too', () => {
    expect(linked).toEqual([
      {
        provider: 'auth-oidc/authentik',
        subject: 's1',
        accountLabel: 'me@example.com',
        linkedAt: 10,
        providerLabel: 'Authentik',
        available: true,
      },
      {
        provider: 'auth-oidc/old',
        subject: 's2',
        accountLabel: null,
        linkedAt: 5,
        providerLabel: null,
        available: false,
      },
    ])
  })

  it('offers Link only for providers not already linked', () => {
    const linkable = parseLinkableProviders([
      { provider: 'auth-oidc/authentik', label: 'Authentik' },
      { provider: 'auth-oidc/google', label: '' },
      { label: 'no id' },
    ])
    expect(linkable).toEqual([
      { provider: 'auth-oidc/authentik', label: 'Authentik' },
      { provider: 'auth-oidc/google', label: 'auth-oidc/google' },
    ])
    expect(providersToLink(linkable, linked)).toEqual([{ provider: 'auth-oidc/google', label: 'auth-oidc/google' }])
  })

  it('the link start URL is read from the answer', () => {
    expect(parseLinkStartUrl({ url: '/addon/auth-oidc/x/start?link=li_1' })).toBe('/addon/auth-oidc/x/start?link=li_1')
    expect(parseLinkStartUrl({ url: '' })).toBeNull()
  })
})

describe('change-password form', () => {
  it('names the first thing wrong, in the order a person fills it', () => {
    expect(passwordFormProblem({ current: '', next: 'longenough', confirm: 'longenough' })).toBe('missing-current')
    expect(passwordFormProblem({ current: 'old', next: 'short', confirm: 'short' })).toBe('too-short')
    expect(passwordFormProblem({ current: 'old', next: 'longenough', confirm: 'longenougH' })).toBe('mismatch')
    expect(passwordFormProblem({ current: 'longenough', next: 'longenough', confirm: 'longenough' })).toBe('unchanged')
    expect(passwordFormProblem({ current: 'old', next: 'longenough', confirm: 'longenough' })).toBeNull()
  })
})

describe('native link and browser handoff (D801)', () => {
  it('reads the app callback: a code to claim, or a refusal', () => {
    expect(parseLinkCallback('camstack://auth-callback?link=nlc_abc')).toEqual({ code: 'nlc_abc' })
    expect(parseLinkCallback('camstack:///auth-callback?linkError=provider')).toEqual({ error: 'provider' })
    expect(parseLinkCallback('camstack://auth-callback?code=chc_x')).toBeNull()
    expect(parseLinkCallback('camstack://auth-callback')).toBeNull()
  })

  it('reads the claim outcome', () => {
    expect(parseLinkClaim({ outcome: 'linked', provider: 'p' })).toBe('linked')
    expect(parseLinkClaim({ outcome: 'session' })).toBe('session')
    expect(parseLinkClaim({ outcome: 'weird' })).toBeNull()
  })

  it('opens only the handoff route the hub names', () => {
    expect(parseBrowserHandoffPath({ path: '/api/auth/browser-handoff?code=chc_1', expiresAt: 1 })).toBe(
      '/api/auth/browser-handoff?code=chc_1',
    )
    expect(parseBrowserHandoffPath({ path: 'https://evil/x' })).toBeNull()
  })
})
