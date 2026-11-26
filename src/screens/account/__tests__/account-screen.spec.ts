/**
 * @vitest-environment jsdom
 *
 * The shell's Account screen (`/account`, D1102) mounted: the sections that left
 * the viewer's Settings are here — Servers, This device, Tokens, the sign-in
 * methods and the sessions — and the tokens work as they did: listed (own only,
 * expiry highlighted), opened, extended and revoked, a new one minted and shown
 * once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import { AccountScreen } from '../AccountScreen.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const ME = { id: 'u1', username: 'operator', isAdmin: true }
const DAY = 86_400_000
const NOW = Date.now()

/** An admin's list carries other users' tokens too; only u1's are this account's. */
const TOKENS = [
  {
    id: 'mine',
    subjectId: 'u1',
    label: 'Kitchen wall',
    scopes: [{ type: 'share-view', grant: { kind: 'grid-view', deviceIds: [1, 2, 3] } }],
    createdAt: NOW - 3 * DAY,
    expiresAt: NOW + 2 * DAY,
    lastUsedAt: NOW - DAY,
    revokedAt: null,
  },
  {
    id: 'theirs',
    subjectId: 'u2',
    label: 'Somebody else',
    scopes: ['*'],
    createdAt: NOW - DAY,
    expiresAt: NOW + 30 * DAY,
    lastUsedAt: null,
    revokedAt: null,
  },
]

const HUB = {
  'auth.me': ME,
  'auth.listTokens': TOKENS,
  'auth.revokeToken': { success: true },
  'auth.extendToken': TOKENS[0],
  'auth.mintToken': { token: 'SECRET-ONCE', record: { ...TOKENS[0], id: 'new', label: 'Hall' } },
  'auth.listOwnSessions': [],
  'auth.listOwnPasskeys': [{ credentialId: 'c1', label: 'MacBook', createdAt: 1, lastUsedAt: null, transports: [] }],
  'auth.getOwnPasskeySecondFactorPreference': { enabled: false },
  'auth.getOwnTotpStatus': { enabled: false, confirmedAt: null },
  'auth.listOwnExternalIdentities': [],
  'auth.listLinkableProviders': [],
}

beforeEach(() => setTestPlatform('web'))
afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

describe('the Account screen', () => {
  it('renders the moved sections: servers, tokens, passkeys', async () => {
    mountScreen(React.createElement(AccountScreen), { hub: HUB })
    expect(await screen.findByText('Servers')).toBeTruthy()
    expect(await screen.findByText(/operator · Admin/)).toBeTruthy()
    expect(await screen.findByText('Kitchen wall')).toBeTruthy()
    expect(await screen.findByText('MacBook')).toBeTruthy()
  })
})

describe('Account → Tokens', () => {
  it("lists this account's tokens only, with what each may do and its dates", async () => {
    mountScreen(React.createElement(AccountScreen), { hub: HUB })
    expect(await screen.findByText('Kitchen wall')).toBeTruthy()
    expect(screen.queryByText('Somebody else')).toBeNull()
    expect(screen.getByText('Live view · 3 cameras')).toBeTruthy()
    expect(screen.getByText(/^Created .* · Expires .* · Last used /)).toBeTruthy()
  })

  it('a tap opens the token; Revoke asks first, then revokes that token', async () => {
    mountScreen(React.createElement(AccountScreen), { hub: HUB })
    await screen.findByText('Kitchen wall')
    act(() => {
      fireEvent.click(screen.getByTestId('token-row-mine'))
    })
    act(() => {
      fireEvent.click(screen.getByTestId('token-revoke'))
    })
    expect(hubCalls().some((c) => c.path === 'auth.revokeToken')).toBe(false)
    const confirmButtons = await screen.findAllByText('Revoke')
    act(() => {
      fireEvent.click(confirmButtons[confirmButtons.length - 1] as HTMLElement)
    })
    await waitFor(() => {
      expect(hubCalls().find((c) => c.path === 'auth.revokeToken')?.input).toEqual({ id: 'mine' })
    })
  })

  it('Extend moves the expiry of that token in place', async () => {
    mountScreen(React.createElement(AccountScreen), { hub: HUB })
    await screen.findByText('Kitchen wall')
    act(() => {
      fireEvent.click(screen.getByTestId('token-row-mine'))
    })
    act(() => {
      fireEvent.click(screen.getByTestId('token-extend'))
    })
    await waitFor(() => {
      expect(hubCalls().find((c) => c.path === 'auth.extendToken')?.input).toEqual({ id: 'mine', expiresIn: 30 * 86_400 })
    })
  })

  it('a new view token is minted for every camera and its secret shown once', async () => {
    const cameras = [
      { id: 1, name: 'Dispensa', type: 'Camera', isCamera: true, online: true, features: [] },
      { id: 2, name: 'Garage', type: 'Camera', isCamera: true, online: true, features: [] },
    ]
    mountScreen(React.createElement(AccountScreen), { hub: { ...HUB, 'deviceManager.listAll': cameras } })
    await screen.findByText('Kitchen wall')
    act(() => {
      fireEvent.click(screen.getByText('New token'))
    })
    const label = await screen.findByLabelText('Name')
    act(() => {
      fireEvent.change(label, { target: { value: 'Hall' } })
    })
    act(() => {
      fireEvent.click(screen.getByTestId('token-create'))
    })
    await waitFor(() => {
      expect(hubCalls().find((c) => c.path === 'auth.mintToken')?.input).toEqual({
        label: 'Hall',
        scopes: [{ type: 'share-view', grant: { kind: 'grid-view', deviceIds: [1, 2] } }],
        expiresIn: 30 * 86_400,
      })
    })
    expect((await screen.findByTestId('token-secret')).textContent).toBe('SECRET-ONCE')
  })
})
