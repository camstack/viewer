import { describe, expect, it, vi } from 'vitest'
import { settleSessionAfterDisconnect } from '../after-disconnect.js'

describe('settling the session after "Disconnect this device"', () => {
  it('a refused renewal (the certificate session) signs out and tells the login screen', async () => {
    const renewSession = vi.fn().mockResolvedValue({ status: 'refused' })
    const markDisconnected = vi.fn()
    expect(await settleSessionAfterDisconnect({ renewSession, markDisconnected })).toBe('signed-out')
    expect(renewSession).toHaveBeenCalledWith('unauthorized')
    expect(markDisconnected).toHaveBeenCalledTimes(1)
  })

  it('a session opened another way stands: nothing is signed out', async () => {
    const renewSession = vi.fn().mockResolvedValue({ status: 'renewed', token: 't', refreshToken: 'r', supersededToken: null })
    const markDisconnected = vi.fn()
    expect(await settleSessionAfterDisconnect({ renewSession, markDisconnected })).toBe('kept')
    expect(markDisconnected).not.toHaveBeenCalled()
  })

  it('an unreachable hub changes nothing', async () => {
    const markDisconnected = vi.fn()
    const renewSession = vi.fn().mockResolvedValue({ status: 'failed', message: 'offline' })
    expect(await settleSessionAfterDisconnect({ renewSession, markDisconnected })).toBe('unknown')
    expect(markDisconnected).not.toHaveBeenCalled()
  })
})
