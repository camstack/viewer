/**
 * @vitest-environment jsdom
 *
 * The web login (operator report 2026-10-06, hosted PWA in Chrome):
 *  - Enter did nothing in any field — no field had a submit handler;
 *  - a hub address that resolved but never answered left the form with no
 *    reason, while the console filled with WebSocket retries.
 *
 * Mounted on the real `LoginScreen` (react-native-web's TextInput, the real
 * i18n strings); only the wire (`../auth/login.js`) is faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import React from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { mountScreen } from '../../testing/mount.js'
import { setTestPlatform } from '../../testing/platform-control.js'
import { HubUnreachableError } from '../../auth/web-reachability.js'
import { LoginScreen, type LoginScreenProps } from '../LoginScreen.js'

const wire = vi.hoisted(() => ({
  login: vi.fn<(url: string, user: string, pass: string) => Promise<{ status: string; token: string }>>(),
  verifyTotp: vi.fn<(url: string, challenge: string, code: string) => Promise<{ token: string }>>(),
}))

vi.mock('../../auth/login.js', () => ({ login: wire.login, verifyTotp: wire.verifyTotp }))
vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const HUB = 'https://hub.example.com:4443'

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function mountLogin(): Promise<void> {
  const Login = (): React.ReactElement => LoginScreen({ initialServerUrl: HUB } satisfies LoginScreenProps)
  mountScreen(React.createElement(Login), { pathname: '/' })
  await settle()
}

function field(placeholder: string): HTMLElement {
  return screen.getByPlaceholderText(placeholder)
}

async function fillCredentials(): Promise<void> {
  fireEvent.change(field('Username'), { target: { value: 'admin' } })
  fireEvent.change(field('Password'), { target: { value: 'secret' } })
  await settle()
}

async function pressEnter(el: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(el, { key: 'Enter', code: 'Enter' })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(async () => {
  await AsyncStorage.clear()
  setTestPlatform('web')
  wire.login.mockReset()
  wire.verifyTotp.mockReset()
})

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

describe('web login — Enter submits', () => {
  it.each(['https://hub.local:4443', 'Username', 'Password'])('from the %s field', async (placeholder) => {
    wire.login.mockResolvedValue({ status: 'totp-required', token: 'challenge' })
    await mountLogin()
    await fillCredentials()

    await pressEnter(field(placeholder))

    expect(wire.login).toHaveBeenCalledTimes(1)
    expect(wire.login).toHaveBeenCalledWith(HUB, 'admin', 'secret')
  })

  it('from the TOTP code field', async () => {
    wire.login.mockResolvedValue({ status: 'totp-required', token: 'challenge' })
    wire.verifyTotp.mockReturnValue(new Promise(() => undefined))
    await mountLogin()
    await fillCredentials()
    await pressEnter(field('Password'))

    const code = await screen.findByPlaceholderText('123456')
    fireEvent.change(code, { target: { value: '123456' } })
    await settle()
    await pressEnter(code)

    expect(wire.verifyTotp).toHaveBeenCalledWith(HUB, 'challenge', '123456')
  })

  it('does nothing while a required field is empty', async () => {
    await mountLogin()
    await pressEnter(field('Username'))
    expect(wire.login).not.toHaveBeenCalled()
  })
})

describe('web login — an unreachable hub says so, with the host', () => {
  it.each([
    ['a TLS / connection failure (fetch got no response)', new TypeError('Failed to fetch')],
    ['the bounded wait running out', new HubUnreachableError(HUB)],
  ])('%s', async (_label, failure) => {
    wire.login.mockRejectedValue(failure)
    await mountLogin()
    await fillCredentials()
    await pressEnter(field('Password'))

    expect(
      await screen.findByText(/Can't reach hub\.example\.com:4443 — check the address\. From the browser it needs a valid HTTPS certificate/),
    ).toBeTruthy()
  })

  it("the hub's own refusal is shown as the hub said it", async () => {
    wire.login.mockRejectedValue(new Error('Invalid username or password'))
    await mountLogin()
    await fillCredentials()
    await pressEnter(field('Password'))
    expect(await screen.findByText('Invalid username or password')).toBeTruthy()
  })
})
