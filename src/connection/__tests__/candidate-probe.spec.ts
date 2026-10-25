import { describe, expect, it, vi } from 'vitest'
import {
  HEALTH_PATH,
  probeCandidate,
  probeCandidates,
  probeFailureHint,
  raceCandidates,
  summariseProbe,
} from '../candidate-probe.js'

function clock(steps: readonly number[]): () => number {
  let i = 0
  return () => steps[Math.min(i++, steps.length - 1)] ?? 0
}

describe('probeCandidate', () => {
  it('asks the auth-free health endpoint and reports a 2xx as ok', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 200 }))
    const r = await probeCandidate('https://192.0.2.10:4443/', 1000, {
      fetchImpl,
      now: clock([0, 42]),
    })
    expect(fetchImpl).toHaveBeenCalledWith(`https://192.0.2.10:4443${HEALTH_PATH}`, expect.anything())
    expect(r).toMatchObject({ ok: true, status: 200, ms: 42, error: null })
  })

  it('reports a non-2xx as not-ok but keeps the status — a 502 is not a TLS failure', async () => {
    const r = await probeCandidate('https://h', 1000, {
      fetchImpl: async () => ({ status: 502 }),
      now: clock([0, 5]),
    })
    expect(r).toMatchObject({ ok: false, status: 502, error: null })
  })

  it('keeps the failure VERBATIM — the whole point is telling a TLS refusal from a timeout', async () => {
    const r = await probeCandidate('https://192.0.2.10:4443', 1000, {
      fetchImpl: async () => {
        throw new TypeError('The certificate for this server is invalid')
      },
      now: clock([0, 12]),
    })
    expect(r.ok).toBe(false)
    expect(r.status).toBeNull()
    expect(r.error).toBe('TypeError: The certificate for this server is invalid')
  })

  it('never throws', async () => {
    await expect(
      probeCandidate('https://h', 1, { fetchImpl: async () => { throw 'nope' }, now: clock([0, 1]) }),
    ).resolves.toMatchObject({ ok: false, error: 'nope' })
  })
})

describe('probeCandidates', () => {
  it('probes serially — a diagnostic must not burst the transport it is diagnosing', async () => {
    const order: string[] = []
    let live = 0
    let maxLive = 0
    const fetchImpl = async (url: string): Promise<{ status: number }> => {
      live += 1
      maxLive = Math.max(maxLive, live)
      order.push(url)
      await Promise.resolve()
      live -= 1
      return { status: 200 }
    }
    const out = await probeCandidates(['https://a', 'https://b', 'https://c'], 500, {
      fetchImpl,
      now: () => 0,
    })
    expect(maxLive).toBe(1)
    expect(out.map((r) => r.url)).toEqual(['https://a', 'https://b', 'https://c'])
    expect(order).toHaveLength(3)
  })

  it('reports every candidate even when the first one fails', async () => {
    const out = await probeCandidates(['https://bad', 'https://good'], 500, {
      fetchImpl: async (url) => {
        if (url.startsWith('https://bad')) throw new Error('boom')
        return { status: 200 }
      },
      now: () => 0,
    })
    expect(out.map((r) => r.ok)).toEqual([false, true])
  })
})

describe('HEALTH_PATH', () => {
  it('is /health, NOT /trpc/health', () => {
    // `/trpc/*` is owned by the tRPC plugin, which resolves the tail as a
    // procedure name: `GET /trpc/health` answers 404 `No procedure found on
    // path "health"` on a HEALTHY hub — verified on the live deployment over
    // both the LAN and the public tunnel. The SDK's `raceFastestEndpoint` asks
    // exactly that, with GET, so every probe rejects, `Promise.any` rejects,
    // and the race returns null for every client on every channel. This
    // constant is the fix; the test is here so nobody "restores" it.
    expect(HEALTH_PATH).toBe('/health')
    expect(HEALTH_PATH.startsWith('/trpc')).toBe(false)
  })
})

describe('raceCandidates', () => {
  it('elects the FASTEST candidate that answered, not the first in the list', async () => {
    // now() is consumed as start,end per probe, in list order.
    const out = await raceCandidates(['https://slow', 'https://fast'], 1000, {
      fetchImpl: async () => ({ status: 200 }),
      now: (() => {
        const t = [0, 300, 0, 40]
        let i = 0
        return () => t[i++] ?? 0
      })(),
    })
    expect(out.winner).toBe('https://fast')
  })

  it('KEEPS every loser — the losers are the diagnosis Promise.any threw away', async () => {
    const out = await raceCandidates(['https://192.0.2.10:443', 'https://tunnel'], 1000, {
      fetchImpl: async (url: string) => {
        if (url.startsWith('https://192.0.2.10:443')) throw new TypeError('Could not connect')
        return { status: 200 }
      },
      now: () => 0,
    })
    expect(out.winner).toBe('https://tunnel')
    expect(out.results).toHaveLength(2)
    const lan = out.results.find((r) => r.url.includes('192.0.2.10'))
    expect(lan?.error).toBe('TypeError: Could not connect')
  })

  it('returns no winner — and still every result — when all candidates fail', async () => {
    const out = await raceCandidates(['https://a', 'https://b'], 1000, {
      fetchImpl: async () => ({ status: 404 }),
      now: () => 0,
    })
    expect(out.winner).toBeNull()
    expect(out.results.map((r) => r.status)).toEqual([404, 404])
  })

  it('is empty and winnerless for an empty candidate set', async () => {
    const out = await raceCandidates([], 1000, { fetchImpl: async () => ({ status: 200 }), now: () => 0 })
    expect(out).toEqual({ winner: null, results: [] })
  })
})

describe('summariseProbe', () => {
  it('puts family, scheme, host, verdict and ms in the line — Settings shows msg, not just JSON', () => {
    expect(
      summariseProbe({
        url: 'http://192.0.2.10:4480',
        ok: false,
        ms: 48,
        status: null,
        error: 'TypeError: Network request failed',
      }),
    ).toBe(
      'ipv4 http 192.0.2.10:4480 FAIL TypeError: Network request failed 48ms — ATS, Local Network permission, or IPv4 unreachable',
    )
  })

  it('names an IPv6 GUA HTTP failure as ATS-or-unreachable, not Local Network', () => {
    expect(
      summariseProbe({
        url: 'http://[2a02:908:3614:bfa0::2]:4480',
        ok: false,
        ms: 12,
        status: null,
        error: 'TypeError: Network request failed',
      }),
    ).toContain('ipv6 http')
    expect(
      probeFailureHint({
        url: 'http://[2a02:908:3614:bfa0::2]:4480',
        ok: false,
        ms: 12,
        status: null,
        error: 'TypeError: Network request failed',
      }),
    ).toBe('ATS (IPv6 GUA is not local for ATS) or unreachable')
  })

  it('keeps a 2xx as OK with status', () => {
    expect(
      summariseProbe({
        url: 'https://camstack.example.com',
        ok: true,
        ms: 151,
        status: 200,
        error: null,
      }),
    ).toBe('host https camstack.example.com OK 200 151ms')
  })
})
