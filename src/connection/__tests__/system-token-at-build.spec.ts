import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemController, type SystemControllerConfig } from '../system-controller.js'

const { createSystem } = vi.hoisted(() => ({ createSystem: vi.fn() }))
vi.mock('@camstack/sdk', () => ({ createSystem }))

class FakeSystem {
  closed = false
  readonly trpcClient = {}
  constructor(readonly serverUrl: string) {}
  awaitConnected(): Promise<void> {
    return new Promise(() => undefined)
  }
  switchServerUrl(): void {}
  close(): void {
    this.closed = true
  }
}

const base = (extra: Partial<SystemControllerConfig>): SystemControllerConfig => ({
  serverUrl: 'http://hub.test:8080',
  token: 'expired-session-token',
  candidates: ['http://hub.test:8080'],
  raceCandidatesImpl: async (urls) => ({ winner: urls[0] ?? null, results: [] }),
  ...extra,
})

beforeEach(() => {
  createSystem.mockReset()
  createSystem.mockImplementation((c: { serverUrl: string }) => new FakeSystem(c.serverUrl))
})

describe('the token a System is built with', () => {
  it('is the LIVE token when a renewal landed before the System was built', async () => {
    const controller = new SystemController(base({ getLiveToken: () => 'renewed-token' }))
    await controller.connect()
    expect(createSystem.mock.calls[0]?.[0].token).toBe('renewed-token')
    controller.dispose()
  })

  it('falls back to the session token when no live token is known', async () => {
    const controller = new SystemController(base({ getLiveToken: () => null }))
    await controller.connect()
    expect(createSystem.mock.calls[0]?.[0].token).toBe('expired-session-token')
    controller.dispose()
  })

  it('hands the SDK a refreshCredential that renews before an expired handshake (never a bare reconnect)', async () => {
    const refresh = vi.fn(async () => undefined)
    const controller = new SystemController(base({ refreshCredential: refresh }))
    await controller.connect()
    await createSystem.mock.calls[0]?.[0].refreshCredential('expired')
    expect(refresh).toHaveBeenCalledWith('expired')
    controller.dispose()
  })
})
