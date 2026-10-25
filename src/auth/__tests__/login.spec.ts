import { describe, it, expect, vi } from 'vitest'
import { authClientOver, login, verifyTotp, type AuthClient, type LoginLegsClient } from '../login.js'
import { HubUnreachableError } from '../web-reachability.js'

function fakeCreate(client: Partial<AuthClient>): (url: string) => AuthClient {
  return () =>
    ({
      login: vi.fn(async () => ({ token: 'sess' })),
      loginVerifyTotp: vi.fn(async () => ({ token: 'sess' })),
      close: vi.fn(),
      ...client,
    }) as AuthClient
}

describe('login', () => {
  it('returns success + session token when TOTP not required', async () => {
    const out = await login('https://h:4443', 'u', 'p', fakeCreate({ login: async () => ({ token: 'jwt' }) }))
    expect(out).toEqual({ status: 'success', token: 'jwt', refreshToken: null })
  })
  it('carries the refresh token a D812 hub answers with', async () => {
    const out = await login('https://h:4443', 'u', 'p', fakeCreate({ login: async () => ({ token: 'jwt', refreshToken: 'csr_1' }) }))
    expect(out).toEqual({ status: 'success', token: 'jwt', refreshToken: 'csr_1' })
  })
  it('returns totp-required + challenge token when requiresTotp', async () => {
    const out = await login('https://h:4443', 'u', 'p', fakeCreate({ login: async () => ({ token: 'chal', requiresTotp: true }) }))
    expect(out).toEqual({ status: 'totp-required', token: 'chal', refreshToken: null })
  })
})

describe('verifyTotp', () => {
  it('returns the session token from the second leg', async () => {
    const out = await verifyTotp('https://h:4443', 'chal', '123456', fakeCreate({ loginVerifyTotp: async () => ({ token: 'jwt2' }) }))
    expect(out).toEqual({ token: 'jwt2', refreshToken: null })
  })
  it('carries the refresh token from the second leg', async () => {
    const out = await verifyTotp('https://h:4443', 'chal', '123456', fakeCreate({ loginVerifyTotp: async () => ({ token: 'jwt2', refreshToken: 'csr_2' }) }))
    expect(out).toEqual({ token: 'jwt2', refreshToken: 'csr_2' })
  })
})

/**
 * A browser login at a hub that never answers used to leave its SDK client
 * open, reconnecting its WebSocket forever — one more loop per attempt, and
 * nothing on screen. Every leg now closes its client and is bounded in time.
 */
describe('a login leg is bounded and always releases its client', () => {
  it('closes the client after success and after a refusal', async () => {
    const close = vi.fn()
    await login('https://h', 'u', 'p', fakeCreate({ close }))
    await expect(
      login('https://h', 'u', 'p', fakeCreate({ close, login: async () => { throw new Error('nope') } })),
    ).rejects.toThrow('nope')
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('a hub that never answers is HubUnreachableError, and the client is closed', async () => {
    const close = vi.fn()
    const never = fakeCreate({ close, login: () => new Promise(() => undefined) })
    const attempt = login('https://typo.example:4443', 'u', 'p', never, 20)
    await expect(attempt).rejects.toBeInstanceOf(HubUnreachableError)
    await expect(attempt).rejects.toThrow("Can't reach typo.example:4443")
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('the TOTP leg is bounded the same way', async () => {
    const close = vi.fn()
    const never = fakeCreate({ close, loginVerifyTotp: () => new Promise(() => undefined) })
    await expect(verifyTotp('https://h', 'c', '123456', never, 20)).rejects.toBeInstanceOf(HubUnreachableError)
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('the default client asks for a refreshing session (D812)', () => {
  it('both legs send refreshable: true — an older hub strips it', async () => {
    const calls: unknown[] = []
    const legs: LoginLegsClient = {
      auth: {
        login: { mutate: async (input) => (calls.push(input), { token: 't' }) },
        loginVerifyTotp: { mutate: async (input) => (calls.push(input), { token: 't' }) },
      },
    }
    const client = authClientOver(legs, () => undefined)
    await client.login('u', 'p')
    await client.loginVerifyTotp('chal', '123456')
    expect(calls).toEqual([
      { username: 'u', password: 'p', refreshable: true },
      { challengeToken: 'chal', code: '123456', refreshable: true },
    ])
  })
})
