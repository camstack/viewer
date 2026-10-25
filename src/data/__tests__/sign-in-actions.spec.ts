/**
 * The re-authentication-gated self-service calls (D813), against both hub
 * generations: what each sends, and how an older hub that has no
 * re-authentication is told apart.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  beginLinkInput,
  disableTotp,
  proveIdentity,
  removePasskeyInput,
} from '../sign-in-actions.js'
import { isMissingProcedureError } from '../../auth/missing-procedure.js'
import type { AuthSelfServiceClient } from '../sign-in-methods.js'

const trpcError = (code: string, message = code): Error => Object.assign(new Error(message), { data: { code } })

/** A client with only the procedures a test touches; the rest throw. */
function clientWith(auth: Record<string, unknown>): AuthSelfServiceClient {
  return { auth } as unknown as AuthSelfServiceClient
}

describe('isMissingProcedureError', () => {
  it('a NOT_FOUND from the hub, or the hub-stub shape, is a missing procedure', () => {
    expect(isMissingProcedureError(trpcError('NOT_FOUND', 'No procedure found on path "auth.reauthenticate"'))).toBe(true)
    expect(isMissingProcedureError(new Error('NOT_FOUND: no such procedure "x" on this hub'))).toBe(true)
  })
  it('anything else is not', () => {
    expect(isMissingProcedureError(trpcError('UNAUTHORIZED', 'Password is incorrect'))).toBe(false)
    expect(isMissingProcedureError(new Error('socket closed'))).toBe(false)
    expect(isMissingProcedureError(null)).toBe(false)
  })
})

describe('proveIdentity', () => {
  it('answers the hub\'s 5-minute proof', async () => {
    const mutate = vi.fn(async () => ({ reauthToken: 'rat_1', expiresAt: 1, method: 'password' }))
    const proof = await proveIdentity(clientWith({ reauthenticate: { mutate } }), { password: 'pw' })
    expect(proof).toEqual({ reauthToken: 'rat_1' })
    expect(mutate).toHaveBeenCalledWith({ password: 'pw' })
  })

  it('an older hub has no re-authentication: no proof is needed, and none is sent', async () => {
    const mutate = vi.fn(async () => {
      throw trpcError('NOT_FOUND', 'No procedure found on path "auth.reauthenticate"')
    })
    expect(await proveIdentity(clientWith({ reauthenticate: { mutate } }), { password: 'pw' })).toEqual({
      reauthToken: null,
    })
  })

  it('a wrong password is the hub\'s message, thrown to the sheet', async () => {
    const mutate = vi.fn(async () => {
      throw trpcError('UNAUTHORIZED', 'Password is incorrect')
    })
    await expect(proveIdentity(clientWith({ reauthenticate: { mutate } }), { password: 'nope' })).rejects.toThrow(
      'Password is incorrect',
    )
  })

  it('an answer without a token is an error, never a silent pass', async () => {
    const mutate = vi.fn(async () => ({ expiresAt: 1 }))
    await expect(proveIdentity(clientWith({ reauthenticate: { mutate } }), { password: 'pw' })).rejects.toThrow()
  })
})

describe('the gated actions carry the proof — and an older hub\'s input when there is none', () => {
  it('disableOwnTotp: { reauthToken }, or no input at all (an older hub takes void)', async () => {
    const mutate = vi.fn(async () => ({ success: true }))
    const client = clientWith({ disableOwnTotp: { mutate } })
    await disableTotp(client, 'rat_1')
    await disableTotp(client, null)
    expect(mutate.mock.calls).toEqual([[{ reauthToken: 'rat_1' }], []])
  })

  it('removeOwnPasskey and beginExternalLink add the field only when there is a proof', () => {
    expect(removePasskeyInput('c1', 'rat_1')).toEqual({ credentialId: 'c1', reauthToken: 'rat_1' })
    expect(removePasskeyInput('c1', null)).toEqual({ credentialId: 'c1' })
    expect(beginLinkInput({ provider: 'p', returnTo: 'camstack://auth-callback' }, 'rat_1')).toEqual({
      provider: 'p',
      returnTo: 'camstack://auth-callback',
      reauthToken: 'rat_1',
    })
    expect(beginLinkInput({ provider: 'p' }, null)).toEqual({ provider: 'p' })
  })
})
