/**
 * @vitest-environment jsdom
 *
 * The Settings tab mounted: four segments behind the Library tab's selector,
 * one shown at a time, the choice written to the device-local store, and the
 * Account segment's tokens: listed (own only, expiry highlighted), opened,
 * extended and revoked, and a new one minted and shown once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import { DEVICE_SETTINGS_DEFAULTS, useDeviceSettingsStore } from '../../../store/device-settings-store.js'
import { SettingsScreen } from '../../SettingsScreen.js'

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
}

beforeEach(() => {
  setTestPlatform('web')
  useDeviceSettingsStore.setState({ settings: DEVICE_SETTINGS_DEFAULTS, hydrated: true })
})
afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

const segment = (key: string): HTMLElement => screen.getByTestId(`settings-segment-${key}`)
const shown = (el: HTMLElement): boolean => el.style.display !== 'none'

describe('Settings segments', () => {
  it('opens on the stored segment and mounts nothing else', () => {
    useDeviceSettingsStore.setState({ settings: { ...DEVICE_SETTINGS_DEFAULTS, settingsSegment: 'app' } })
    mountScreen(React.createElement(SettingsScreen), { hub: HUB })
    expect(shown(segment('app'))).toBe(true)
    expect(screen.queryByTestId('settings-segment-account')).toBeNull()
    expect(screen.queryByTestId('settings-segment-advanced')).toBeNull()
  })

  it('switching remembers the choice and keeps the left segment mounted, hidden', () => {
    mountScreen(React.createElement(SettingsScreen), { hub: HUB })
    expect(shown(segment('account'))).toBe(true)
    act(() => {
      fireEvent.click(screen.getByText('Advanced'))
    })
    expect(useDeviceSettingsStore.getState().settings.settingsSegment).toBe('advanced')
    expect(shown(segment('advanced'))).toBe(true)
    // Still there — its scroll position survives — but not shown.
    expect(shown(segment('account'))).toBe(false)
    expect(screen.getByText('Diagnostics')).toBeTruthy()
  })
})

describe('Account → Tokens', () => {
  it("lists this account's tokens only, with what each may do and its dates", async () => {
    mountScreen(React.createElement(SettingsScreen), { hub: HUB })
    expect(await screen.findByText('Kitchen wall')).toBeTruthy()
    expect(screen.queryByText('Somebody else')).toBeNull()
    expect(screen.getByText('Live view · 3 cameras')).toBeTruthy()
    expect(screen.getByText(/^Created .* · Expires .* · Last used /)).toBeTruthy()
  })

  it('a tap opens the token; Revoke asks first, then revokes that token', async () => {
    mountScreen(React.createElement(SettingsScreen), { hub: HUB })
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
    mountScreen(React.createElement(SettingsScreen), { hub: HUB })
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
    mountScreen(React.createElement(SettingsScreen), { hub: { ...HUB, 'deviceManager.listAll': cameras } })
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
