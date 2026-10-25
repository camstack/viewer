/**
 * @vitest-environment jsdom
 *
 * Sign-in methods mounted against a stub hub: what each section shows, and
 * which self-service procedure each control calls with what.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { setTestPlatform, type TestPlatformOS } from '../../../testing/platform-control.js'
import { SignInMethodsScreen } from '../SignInMethodsScreen.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)
// `expo-web-browser` and `expo-linking` both resolve to ONE stub file
// (vitest.config.ts), so one mock object must answer for both.
const browser = vi.hoisted(() => ({
  openAuthSessionAsync: vi.fn(async () => ({ type: 'success', url: 'camstack://auth-callback?link=nlc_1' })),
  openBrowserAsync: vi.fn(async () => ({ type: 'opened' })),
  createURL: (path: string) => `camstack:///${path}`,
}))
vi.mock('expo-web-browser', () => browser)
vi.mock('expo-linking', () => browser)
// The harness signs no server in; these screens build hub URLs from it.
vi.mock('../../../app/ServerProvider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../app/ServerProvider.js')>()
  return {
    ...actual,
    useServer: () => ({ ...actual.useServer(), server: { id: 's1', serverUrl: 'http://hub.test:8080' } }),
  }
})

const HUB = {
  'auth.me': { id: 'u1', username: 'operator', isAdmin: false },
  'auth.getOwnTotpStatus': { enabled: false, confirmedAt: null },
  'auth.setupOwnTotp': { secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/CamStack:operator?secret=JBSWY3DPEHPK3PXP' },
  'auth.confirmOwnTotp': { success: true },
  'auth.listOwnPasskeys': [{ credentialId: 'c1', label: 'MacBook', createdAt: 1, lastUsedAt: null, transports: [] }],
  'auth.getOwnPasskeySecondFactorPreference': { enabled: false },
  'auth.listOwnExternalIdentities': [
    { provider: 'auth-oidc/gone', subject: 's1', linkedAt: 1, providerLabel: null, available: false },
  ],
  'auth.listLinkableProviders': [{ provider: 'auth-oidc/authentik', label: 'Authentik' }],
  'auth.changeOwnPassword': { success: true },
  'auth.beginExternalLink': { url: '/addon/auth-oidc/authentik/start?link=li_1' },
  'auth.completeExternalLink': { outcome: 'linked', provider: 'auth-oidc/authentik' },
  'auth.createBrowserHandoff': { path: '/api/auth/browser-handoff?code=chc_1', expiresAt: 1 },
  'auth.reauthenticate': { reauthToken: 'rat_1', expiresAt: 1, method: 'password' },
  'auth.disableOwnTotp': { success: true },
  'auth.removeOwnPasskey': { success: true },
  'auth.listOwnSessions': [
    { id: 'ls_me', userId: 'u1', method: 'handoff', refreshable: true, createdAt: 1, lastUsedAt: 30, expiresAt: 99, client: 'CamStack/1 CFNetwork/1568 Darwin/24.1.0', ip: '10.0.0.5', current: true },
    { id: 'ls_mac', userId: 'u1', method: 'password', refreshable: true, createdAt: 1, lastUsedAt: 20, expiresAt: 99, client: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', ip: '10.0.0.9', current: false },
  ],
  'auth.revokeOwnSession': { success: true },
}

/** Waits for the field: the sheet opens after a promise chain, not in the press. */
async function typeInto(testId: string, value: string): Promise<void> {
  const field = await screen.findByTestId(testId)
  act(() => {
    fireEvent.change(field, { target: { value } })
  })
}

/** The confirm dialog's own button (the row that opened it carries the same text). */
async function pressDialogButton(label: string, before: number): Promise<void> {
  await waitFor(() => expect(screen.getAllByText(label).length).toBeGreaterThan(before))
  const matches = screen.getAllByText(label)
  act(() => {
    fireEvent.click(matches[matches.length - 1]!)
  })
}

function mount(os: TestPlatformOS): void {
  setTestPlatform(os)
  mountScreen(React.createElement(SignInMethodsScreen), { hub: HUB })
}

beforeEach(() => setTestPlatform('ios'))
afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

describe('Sign-in methods', () => {
  it('lists passkeys, and a linked account whose provider is gone', async () => {
    mount('ios')
    expect(await screen.findByText('MacBook')).toBeTruthy()
    expect(await screen.findByText('auth-oidc/gone')).toBeTruthy()
    expect(screen.getByText(/provider unavailable/)).toBeTruthy()
  })

  it('on a phone, Link asks "Confirm it\'s you", then runs in the system browser with the proof and the app return', async () => {
    mount('ios')
    const link = await screen.findByText('Link Authentik')
    act(() => {
      fireEvent.click(link)
    })
    expect(await screen.findByText('Confirm it’s you')).toBeTruthy()
    // The phone cannot run a passkey ceremony for the hub's origin.
    expect(screen.queryByTestId('reauth-passkey')).toBeNull()
    expect(hubCalls().some((c) => c.path === 'auth.beginExternalLink')).toBe(false)
    await typeInto('reauth-password', 'my-password')
    act(() => {
      fireEvent.click(screen.getByTestId('reauth-confirm'))
    })
    await waitFor(() => {
      expect(hubCalls().find((c) => c.path === 'auth.completeExternalLink')?.input).toEqual({ code: 'nlc_1' })
    })
    expect(hubCalls().find((c) => c.path === 'auth.reauthenticate')?.input).toEqual({ password: 'my-password' })
    expect(hubCalls().find((c) => c.path === 'auth.beginExternalLink')?.input).toEqual({
      provider: 'auth-oidc/authentik',
      returnTo: 'camstack://auth-callback',
      reauthToken: 'rat_1',
    })
    expect(browser.openAuthSessionAsync).toHaveBeenCalledWith(
      'http://hub.test:8080/addon/auth-oidc/authentik/start?link=li_1',
      'camstack://auth-callback',
    )
  })

  it('a wrong password stays in the sheet with the hub\'s message, and starts nothing', async () => {
    setTestPlatform('ios')
    mountScreen(React.createElement(SignInMethodsScreen), {
      hub: {
        ...HUB,
        'auth.reauthenticate': () => {
          throw Object.assign(new Error('Password is incorrect'), { data: { code: 'UNAUTHORIZED' } })
        },
      },
    })
    const link = await screen.findByText('Link Authentik')
    act(() => {
      fireEvent.click(link)
    })
    await typeInto('reauth-password', 'wrong')
    act(() => {
      fireEvent.click(screen.getByTestId('reauth-confirm'))
    })
    expect(await screen.findByText('Password is incorrect')).toBeTruthy()
    expect(screen.getByText('Confirm it’s you')).toBeTruthy()
    expect(hubCalls().some((c) => c.path === 'auth.beginExternalLink')).toBe(false)
  })

  it('an older hub without re-authentication links as before, with no proof field', async () => {
    setTestPlatform('ios')
    const { 'auth.reauthenticate': _absent, ...olderHub } = HUB
    mountScreen(React.createElement(SignInMethodsScreen), { hub: olderHub })
    const link = await screen.findByText('Link Authentik')
    act(() => {
      fireEvent.click(link)
    })
    await typeInto('reauth-password', 'my-password')
    act(() => {
      fireEvent.click(screen.getByTestId('reauth-confirm'))
    })
    await waitFor(() => {
      expect(hubCalls().find((c) => c.path === 'auth.beginExternalLink')?.input).toEqual({
        provider: 'auth-oidc/authentik',
        returnTo: 'camstack://auth-callback',
      })
    })
  })

  it('Cancel in the sheet starts nothing', async () => {
    mount('ios')
    const link = await screen.findByText('Link Authentik')
    act(() => {
      fireEvent.click(link)
    })
    act(() => {
      fireEvent.click(screen.getByTestId('reauth-cancel'))
    })
    // The sheet's exit animation never ends in jsdom; what matters is that the
    // cancelled proof started nothing — and the row is a Link button again.
    expect(await screen.findByText('Link Authentik')).toBeTruthy()
    expect(hubCalls().some((c) => c.path === 'auth.reauthenticate' || c.path === 'auth.beginExternalLink')).toBe(false)
  })

  it('on a phone, Add a passkey opens the one-time browser handoff on the hub', async () => {
    mount('ios')
    const add = await screen.findByText('Add a passkey')
    act(() => {
      fireEvent.click(add)
    })
    await waitFor(() => {
      expect(browser.openBrowserAsync).toHaveBeenCalledWith(
        'http://hub.test:8080/api/auth/browser-handoff?code=chc_1',
      )
    })
  })

  it('on the web, Link and Add a passkey are offered', async () => {
    mount('web')
    expect(await screen.findByText('Link Authentik')).toBeTruthy()
    expect(screen.getByText('Add a passkey')).toBeTruthy()
  })

  it('the password form refuses a mismatch before any call, then sends both fields', async () => {
    mount('ios')
    act(() => {
      fireEvent.click(screen.getByText('Change password'))
    })
    const type = (id: string, value: string): void => {
      act(() => {
        fireEvent.change(screen.getByTestId(id), { target: { value } })
      })
    }
    type('password-current', 'old-secret')
    type('password-new', 'new-secret-1')
    type('password-confirm', 'new-secret-2')
    act(() => {
      fireEvent.click(screen.getByTestId('password-save'))
    })
    expect(screen.getByText('The two new passwords differ')).toBeTruthy()
    expect(hubCalls().some((c) => c.path === 'auth.changeOwnPassword')).toBe(false)
    type('password-confirm', 'new-secret-1')
    act(() => {
      fireEvent.click(screen.getByTestId('password-save'))
    })
    await waitFor(() => {
      expect(hubCalls().find((c) => c.path === 'auth.changeOwnPassword')?.input).toEqual({
        currentPassword: 'old-secret',
        newPassword: 'new-secret-1',
      })
    })
  })

  it('TOTP setup on the web shows the QR and the grouped key, and confirms the typed code', async () => {
    mount('web')
    const setupRow = await screen.findByText('Set up')
    act(() => {
      fireEvent.click(setupRow)
    })
    expect(await screen.findByTestId('totp-qr')).toBeTruthy()
    expect(screen.getByTestId('totp-secret').textContent).toBe('JBSW Y3DP EHPK 3PXP')
    expect(screen.queryByTestId('totp-open')).toBeNull()
    act(() => {
      fireEvent.change(screen.getByTestId('totp-code'), { target: { value: '12 34 56' } })
    })
    act(() => {
      fireEvent.click(screen.getByTestId('totp-confirm'))
    })
    await waitFor(() => {
      expect(hubCalls().find((c) => c.path === 'auth.confirmOwnTotp')?.input).toEqual({ code: '123456' })
    })
  })

  it('TOTP setup on a phone offers Open in authenticator instead of a QR', async () => {
    mount('ios')
    const setupRow = await screen.findByText('Set up')
    act(() => {
      fireEvent.click(setupRow)
    })
    expect(await screen.findByTestId('totp-open')).toBeTruthy()
    expect(screen.queryByTestId('totp-qr')).toBeNull()
  })

  it('turning the authenticator off: the confirmation, then the proof, then disableOwnTotp({ reauthToken })', async () => {
    setTestPlatform('web')
    mountScreen(React.createElement(SignInMethodsScreen), {
      hub: { ...HUB, 'auth.getOwnTotpStatus': { enabled: true, confirmedAt: 1 } },
    })
    const turnOff = await screen.findAllByText('Turn off')
    act(() => {
      fireEvent.click(turnOff[0]!)
    })
    await pressDialogButton('Turn off', 1)
    expect(await screen.findByText('Confirm it’s you')).toBeTruthy()
    await typeInto('reauth-password', 'my-password')
    act(() => {
      fireEvent.click(screen.getByTestId('reauth-confirm'))
    })
    await waitFor(() => {
      expect(hubCalls().find((c) => c.path === 'auth.disableOwnTotp')?.input).toEqual({ reauthToken: 'rat_1' })
    })
  })

  it('a refusal (FORBIDDEN) is shown with the hub\'s own message', async () => {
    setTestPlatform('web')
    mountScreen(React.createElement(SignInMethodsScreen), {
      hub: {
        ...HUB,
        'auth.removeOwnPasskey': () => {
          throw Object.assign(new Error('Confirm it is you first: re-enter your password or use a passkey.'), {
            data: { code: 'FORBIDDEN' },
          })
        },
      },
    })
    const remove = await screen.findByText('Remove')
    act(() => {
      fireEvent.click(remove)
    })
    await pressDialogButton('Remove', 1)
    await typeInto('reauth-password', 'my-password')
    act(() => {
      fireEvent.click(screen.getByTestId('reauth-confirm'))
    })
    expect(await screen.findByText('Confirm it is you first: re-enter your password or use a passkey.')).toBeTruthy()
    expect(hubCalls().find((c) => c.path === 'auth.removeOwnPasskey')?.input).toEqual({
      credentialId: 'c1',
      reauthToken: 'rat_1',
    })
  })

  it('Active sessions: this app first and marked, another device can be signed out', async () => {
    setTestPlatform('web')
    mountScreen(React.createElement(SignInMethodsScreen), { hub: HUB })
    expect(await screen.findByText('Active sessions')).toBeTruthy()
    expect(screen.getByText('CamStack app on iOS')).toBeTruthy()
    expect(screen.getByText(/This device/)).toBeTruthy()
    expect(screen.getByText('Safari on macOS')).toBeTruthy()
    // Only the other device has its own Sign out.
    const own = screen.getByTestId('session-ls_me')
    expect(own.textContent).not.toContain('Sign out')
    act(() => {
      fireEvent.click(screen.getAllByText('Sign out')[0]!)
    })
    await pressDialogButton('Sign out', 1)
    await waitFor(() => {
      expect(hubCalls().find((c) => c.path === 'auth.revokeOwnSession')?.input).toEqual({ id: 'ls_mac' })
    })
  })

  it('a hub without login sessions draws no Active sessions section', async () => {
    const { 'auth.listOwnSessions': _absent, ...olderHub } = HUB
    setTestPlatform('ios')
    mountScreen(React.createElement(SignInMethodsScreen), { hub: olderHub })
    expect(await screen.findByText('MacBook')).toBeTruthy()
    await waitFor(() => expect(hubCalls().some((c) => c.path === 'auth.listOwnSessions')).toBe(true))
    expect(screen.queryByText('Active sessions')).toBeNull()
    expect(screen.queryByText('Sign out everywhere')).toBeNull()
  })
})
