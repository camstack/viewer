import { describe, expect, it, vi } from 'vitest'
import { createSessionRenewer, type SessionVault } from '../session-renewer.js'
import type { RenewInput, RenewOutcome } from '../refresh-session.js'

function vault(initial: Record<string, string | null> = {}): SessionVault & {
  readonly writes: { serverId: string; token: string; refreshToken: string | null }[]
} {
  const refresh = new Map(Object.entries(initial))
  const writes: { serverId: string; token: string; refreshToken: string | null }[] = []
  return {
    writes,
    getRefreshToken: async (id) => refresh.get(id) ?? null,
    setSession: async (id, session) => {
      writes.push({ serverId: id, ...session })
      refresh.set(id, session.refreshToken)
    },
  }
}

const REQUEST = { serverUrl: 'https://hub', currentToken: 'access-1', client: null }

describe('createSessionRenewer', () => {
  it('reads the refresh token from the vault at call time and persists the rotated pair', async () => {
    const v = vault({ s1: 'csr_1' })
    const renew = vi.fn(async (input: RenewInput): Promise<RenewOutcome> => {
      expect(input.refreshToken).toBe('csr_1')
      return { status: 'renewed', token: 'access-2', refreshToken: 'csr_2', supersededToken: null }
    })
    const renewer = createSessionRenewer({ vault: v, renew })
    const out = await renewer.renew('s1', REQUEST)
    expect(out.status).toBe('renewed')
    expect(v.writes).toEqual([{ serverId: 's1', token: 'access-2', refreshToken: 'csr_2' }])
  })

  it('is single-flight per server: concurrent callers share ONE refresh (a second would reuse a rotated token)', async () => {
    const v = vault({ s1: 'csr_1' })
    let release: (o: RenewOutcome) => void = () => undefined
    const renew = vi.fn(
      () =>
        new Promise<RenewOutcome>((resolve) => {
          release = resolve
        }),
    )
    const renewer = createSessionRenewer({ vault: v, renew })
    const a = renewer.renew('s1', REQUEST)
    const b = renewer.renew('s1', REQUEST)
    await Promise.resolve()
    release({ status: 'renewed', token: 'access-2', refreshToken: 'csr_2', supersededToken: null })
    expect(await a).toEqual(await b)
    expect(renew).toHaveBeenCalledTimes(1)
  })

  it('another server renews independently', async () => {
    const v = vault({ s1: 'csr_1', s2: 'csr_x' })
    const renew = vi.fn(async (): Promise<RenewOutcome> => ({ status: 'failed', message: 'offline' }))
    const renewer = createSessionRenewer({ vault: v, renew })
    await Promise.all([renewer.renew('s1', REQUEST), renewer.renew('s2', REQUEST)])
    expect(renew).toHaveBeenCalledTimes(2)
  })

  it('a rotation whose write fails is still used next time — the old token is already dead', async () => {
    const writes: string[] = []
    const failingVault: SessionVault = {
      getRefreshToken: async () => 'csr_1',
      setSession: async (_id, s) => {
        writes.push(s.refreshToken ?? 'null')
        throw new Error('keychain locked')
      },
    }
    const seen: (string | null)[] = []
    const renew = vi.fn(async (input: RenewInput): Promise<RenewOutcome> => {
      seen.push(input.refreshToken)
      return { status: 'renewed', token: `a-${seen.length}`, refreshToken: `csr_${seen.length + 1}`, supersededToken: null }
    })
    const renewer = createSessionRenewer({ vault: failingVault, renew })
    expect((await renewer.renew('s1', REQUEST)).status).toBe('renewed')
    await renewer.renew('s1', REQUEST)
    expect(seen).toEqual(['csr_1', 'csr_2'])
  })

  it('persists nothing on a refusal or a failure', async () => {
    const v = vault({ s1: 'csr_1' })
    const renewer = createSessionRenewer({
      vault: v,
      renew: async () => ({ status: 'refused' }),
    })
    expect(await renewer.renew('s1', REQUEST)).toEqual({ status: 'refused' })
    expect(v.writes).toEqual([])
  })

  it('forget() drops the in-memory rotation, so a signed-out server cannot renew from it', async () => {
    const failingVault: SessionVault = {
      getRefreshToken: async () => null,
      setSession: async () => {
        throw new Error('keychain locked')
      },
    }
    const seen: (string | null)[] = []
    const renewer = createSessionRenewer({
      vault: failingVault,
      renew: async (input) => {
        seen.push(input.refreshToken)
        return { status: 'renewed', token: 't', refreshToken: 'csr_mem', supersededToken: null }
      },
    })
    await renewer.renew('s1', REQUEST)
    renewer.forget('s1')
    await renewer.renew('s1', REQUEST)
    expect(seen).toEqual([null, null])
  })
})
