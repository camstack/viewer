import { describe, it, expect, vi } from 'vitest'
import { fetchWithFailover, AllEndpointsFailedError } from '../data-plane-failover.js'

function res(status: number): Response {
  return new Response(status === 200 ? 'ok' : '', { status })
}

describe('fetchWithFailover', () => {
  it('returns the first endpoint that responds 2xx', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('lan') ? res(200) : res(500),
    )
    const r = await fetchWithFailover(['https://lan/a', 'https://relay/a'], { fetchImpl })
    expect(r.url).toBe('https://lan/a')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('falls through 401/timeout/5xx to the next endpoint', async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.includes('relay') ? res(200) : res(401)))
    const r = await fetchWithFailover(['https://lan/a', 'https://relay/a'], { fetchImpl })
    expect(r.url).toBe('https://relay/a')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('throws AllEndpointsFailedError when every endpoint fails', async () => {
    const fetchImpl = vi.fn(async () => res(503))
    await expect(
      fetchWithFailover(['https://lan/a', 'https://relay/a'], { fetchImpl }),
    ).rejects.toBeInstanceOf(AllEndpointsFailedError)
  })

  it('treats a thrown fetch (network error) as failover', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('lan')) throw new Error('ECONNREFUSED')
      return res(200)
    })
    const r = await fetchWithFailover(['https://lan/a', 'https://relay/a'], { fetchImpl })
    expect(r.url).toBe('https://relay/a')
  })
})
