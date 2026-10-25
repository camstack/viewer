import { describe, expect, it, vi } from 'vitest'
import { renewSession } from '../refresh-session.js'
import { createSessionRenewer, type DeviceRefreshAnswer } from '../session-renewer.js'

const CERT_TOKEN = `h.${Buffer.from(JSON.stringify({ cid: 'cred-1' })).toString('base64')}.s`
const PASSWORD_TOKEN = `h.${Buffer.from(JSON.stringify({ sub: 'u1' })).toString('base64')}.s`
const refusal = (message: string): Response =>
  new Response(JSON.stringify({ error: { json: { message } } }), { status: 401 })

describe('a refresh bound to a device certificate', () => {
  it('names the reason when the hub refuses the credential', async () => {
    const out = await renewSession({
      serverUrl: 'https://hub',
      refreshToken: 'csr_1',
      currentToken: 't',
      client: null,
      fetchFn: async () => refusal('device-credential:revoked'),
    })
    expect(out).toEqual({ status: 'refused', deviceRefusal: 'revoked' })
  })

  it('a plain expired session stays a plain refusal', async () => {
    const out = await renewSession({
      serverUrl: 'https://hub',
      refreshToken: 'csr_1',
      currentToken: 't',
      client: null,
      fetchFn: async () => refusal('Invalid refresh token'),
    })
    expect(out).toEqual({ status: 'refused' })
  })

  it('the renewer reports refusals and successes to the revocation contract, nothing else', async () => {
    const answers: DeviceRefreshAnswer[] = []
    const vault = { getRefreshToken: async () => 'csr_1', setSession: async () => undefined }
    const outcomes = [
      { status: 'refused', deviceRefusal: 'unknown-credential' },
      { status: 'refused' },
      { status: 'failed', message: 'offline' },
      { status: 'renewed', token: 'a', refreshToken: 'b', supersededToken: null },
    ] as const
    const queue = [...outcomes]
    const renewer = createSessionRenewer({
      vault,
      renew: vi.fn(async () => queue.shift() ?? { status: 'unavailable' as const }),
      onDeviceAnswer: (_id, _url, answer) => answers.push(answer),
    })
    for (let i = 0; i < outcomes.length; i += 1) await renewer.renew('s1', { serverUrl: 'https://hub', currentToken: CERT_TOKEN, client: null })
    expect(answers).toEqual([{ kind: 'refusal', reason: 'unknown-credential' }, { kind: 'success' }])
  })

  it('a password session refreshing fine says nothing about the certificate (the counter is not reset)', async () => {
    const answers: DeviceRefreshAnswer[] = []
    const renewer = createSessionRenewer({
      vault: { getRefreshToken: async () => 'csr_1', setSession: async () => undefined },
      renew: async () => ({ status: 'renewed' as const, token: 'a', refreshToken: 'b', supersededToken: null }),
      onDeviceAnswer: (_id, _url, answer) => answers.push(answer),
    })
    await renewer.renew('s1', { serverUrl: 'https://hub', currentToken: PASSWORD_TOKEN, client: null })
    expect(answers).toEqual([])
  })
})
