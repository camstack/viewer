/**
 * @vitest-environment jsdom
 *
 * "When I entered a wrong URL the button kept spinning" (operator, 2026-10-06).
 * Every way a sign-in can go wrong must END: the spinner off and a sentence on
 * screen that names the problem. Mounted on the real `LoginScreen`; only the
 * wire (`../auth/login.js`) is faked, with the errors the real client raises.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import React from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { TRPCClientError } from '@trpc/client'

import { mountScreen } from '../../testing/mount.js'
import { setTestPlatform } from '../../testing/platform-control.js'
import { HubUnreachableError } from '../../auth/web-reachability.js'
import { LoginScreen, LOGIN_SLOW_HINT_MS, type LoginScreenProps } from '../LoginScreen.js'

const wire = vi.hoisted(() => ({
  login: vi.fn<(url: string, user: string, pass: string) => Promise<{ status: string; token: string }>>(),
  verifyTotp: vi.fn<(url: string, challenge: string, code: string) => Promise<{ token: string }>>(),
}))

vi.mock('../../auth/login.js', () => ({ login: wire.login, verifyTotp: wire.verifyTotp }))
vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const HUB = 'https://hub.example.com:4443'
const SIGNING_IN = 'Signing in…'

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function mountLogin(url: string = HUB): Promise<void> {
  const Login = (): React.ReactElement => LoginScreen({ initialServerUrl: url } satisfies LoginScreenProps)
  mountScreen(React.createElement(Login), { pathname: '/' })
  await settle()
}

function field(placeholder: string): HTMLElement {
  return screen.getByPlaceholderText(placeholder)
}

async function signIn(): Promise<void> {
  fireEvent.change(field('Username'), { target: { value: 'admin' } })
  fireEvent.change(field('Password'), { target: { value: 'secret' } })
  await settle()
  await act(async () => {
    fireEvent.keyDown(field('Password'), { key: 'Enter', code: 'Enter' })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await settle()
}

/** The spinner is the button's loading label; it must be gone at the end. */
function expectSpinnerOff(): void {
  expect(screen.queryByText(SIGNING_IN)).toBeNull()
  expect(screen.getByText('Sign in')).toBeTruthy()
}

/** What the real tRPC client raises when the body is not JSON (an HTML page). */
function htmlPageError(): TRPCClientError<never> {
  return TRPCClientError.from(
    new SyntaxError(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`),
  )
}

beforeEach(async () => {
  await AsyncStorage.clear()
  setTestPlatform('web')
  wire.login.mockReset()
  wire.verifyTotp.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  setTestPlatform('ios')
})

describe('a malformed server URL is refused before anything is sent', () => {
  it.each(['abc', 'https://', 'ftp://x', 'http://'])('%s', async (url) => {
    await mountLogin(url)
    await signIn()

    expect(wire.login).not.toHaveBeenCalled()
    expect(await screen.findByText('Enter a valid server URL (https://…) first')).toBeTruthy()
    expectSpinnerOff()
  })
})

describe('a host that answers but is not a CamStack hub', () => {
  it.each([
    ['an HTML page', htmlPageError()],
    ['JSON that is not a tRPC envelope', TRPCClientError.from(new Error('Unable to transform response from server'))],
    ['an empty 404 body', TRPCClientError.from(new SyntaxError('Unexpected end of JSON input'))],
  ])('%s', async (_label, failure) => {
    wire.login.mockRejectedValue(failure)
    await mountLogin()
    await signIn()

    expect(
      await screen.findByText('hub.example.com:4443 answered, but it is not a CamStack server — check the address.'),
    ).toBeTruthy()
    expectSpinnerOff()
  })

  it('is told apart from the hub itself refusing the login', async () => {
    // A real hub answers with its tRPC error envelope — its words are shown.
    wire.login.mockRejectedValue(
      TRPCClientError.from({
        error: { code: -32001, message: 'Invalid username or password', data: { code: 'UNAUTHORIZED', httpStatus: 401 } },
      }),
    )
    await mountLogin()
    await signIn()

    expect(await screen.findByText('Invalid username or password')).toBeTruthy()
    expect(screen.queryByText(/not a CamStack server/)).toBeNull()
    expectSpinnerOff()
  })
})

describe('every failure ends with the spinner off and a reason', () => {
  it.each([
    ['a DNS name that does not exist (browser)', new TypeError('Failed to fetch'), /Can't reach hub\.example\.com:4443/],
    ['a TLS error from the browser', TRPCClientError.from(new TypeError('Failed to fetch')), /Can't reach hub\.example\.com:4443/],
    ['an IP with nothing listening (the bound)', new HubUnreachableError(HUB), /Can't reach hub\.example\.com:4443/],
    ['a wrong password', new Error('Invalid username or password'), /Invalid username or password/],
  ])('%s', async (_label, failure, message) => {
    wire.login.mockRejectedValue(failure)
    await mountLogin()
    await signIn()

    expect(await screen.findByText(message)).toBeTruthy()
    expectSpinnerOff()
  })

  it('a refused TOTP code', async () => {
    wire.login.mockResolvedValue({ status: 'totp-required', token: 'challenge' })
    wire.verifyTotp.mockRejectedValue(new Error('Invalid code'))
    await mountLogin()
    await signIn()

    const code = await screen.findByPlaceholderText('123456')
    fireEvent.change(code, { target: { value: '123456' } })
    await settle()
    await act(async () => {
      fireEvent.keyDown(code, { key: 'Enter', code: 'Enter' })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(await screen.findByText('Invalid code')).toBeTruthy()
    expect(screen.queryByText('Verifying…')).toBeNull()
  })
})

describe('a slow request says it is still trying', () => {
  it(`after ${LOGIN_SLOW_HINT_MS} ms, and the hint goes when the request ends`, async () => {
    let fail: (err: Error) => void = () => undefined
    wire.login.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject
      }),
    )
    await mountLogin()
    fireEvent.change(field('Username'), { target: { value: 'admin' } })
    fireEvent.change(field('Password'), { target: { value: 'secret' } })
    await settle()

    vi.useFakeTimers()
    await act(async () => {
      fireEvent.keyDown(field('Password'), { key: 'Enter', code: 'Enter' })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText(SIGNING_IN)).toBeTruthy()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOGIN_SLOW_HINT_MS - 100)
    })
    expect(screen.queryByText(/Still trying to reach/)).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(screen.getByText('Still trying to reach hub.example.com:4443…')).toBeTruthy()

    await act(async () => {
      fail(new HubUnreachableError(HUB))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.queryByText(/Still trying to reach/)).toBeNull()
    expect(screen.getByText(/Can't reach hub\.example\.com:4443/)).toBeTruthy()
    expectSpinnerOff()
  })
})
