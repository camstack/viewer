/**
 * `createEventsDataClient` binds the narrow embed interface onto the generated
 * tRPC client.
 *
 * tRPC's client is a recursive Proxy: every property access extends the
 * procedure path, and the next CALL is the request. `fn.bind(this)` is a CALL,
 * so a bound procedure is sent as procedure type `bind` and the feed never
 * loads — which is why every binding here must be a plain wrapper.
 */
import { describe, expect, it } from 'vitest'
import type { System } from '@camstack/sdk'
import { createEventsDataClient } from '../events-client'

/**
 * The same recursive-Proxy shape `@trpc/client` uses. A real `Function.bind`
 * would work; this one records EVERY apply, including `.bind`.
 */
function createTrpcStyleProxy(
  onApply: (path: readonly string[], args: readonly unknown[]) => unknown,
): object {
  const create = (path: readonly string[]): object =>
    new Proxy(function trpcPath() {}, {
      get(_target, key) {
        if (typeof key !== 'string') return undefined
        return create([...path, key])
      },
      apply(_target, _thisArg, args) {
        return onApply(path, args as readonly unknown[])
      },
    })
  return create([])
}

function systemWith(trpcClient: object): System {
  // Test seam: the embed only reads `trpcClient` off System.
  return { trpcClient } as System
}

describe('createEventsDataClient', () => {
  it('the feed goes through listRecentTracks.query, never Function.bind on the proxy', async () => {
    const calls: { path: string; args: readonly unknown[] }[] = []
    const trpcClient = createTrpcStyleProxy((path, args) => {
      calls.push({ path: path.join('.'), args })
      return { tracks: [], nextCursor: null }
    })
    const client = createEventsDataClient(systemWith(trpcClient))
    await client.listRecentTracks({
      deviceIds: [104],
      since: 1,
      limit: 5,
      projection: 'slim',
    })
    expect(calls.map((c) => c.path)).toContain('pipelineAnalytics.listRecentTracks.query')
    expect(calls.some((c) => c.path.endsWith('.bind'))).toBe(false)
    // Co-moving track groups were deleted (D330): the cap methods this file
    // once bound are off the wire and must never be asked for again.
    expect(calls.some((c) => c.path.includes('listGroups'))).toBe(false)
  })

  /**
   * The Events page's FIRST call, and `deviceIds` — hence `listRecentTracks`
   * and `listEventKinds` — waits on it. Unnarrowed it is 988 devices / 970 KB /
   * 205 ms on this deployment, against 30 rows / 10.5 KB / 21 ms narrowed, and
   * the 970 KB carries every device's `config` (camera credentials included)
   * into a browser iframe. An `{}` here is not a style nit; it is the cold-open
   * cost of the feed.
   */
  it('listDevices narrows to cameras and the slim projection SERVER-side', async () => {
    const calls: { path: string; args: readonly unknown[] }[] = []
    const trpcClient = createTrpcStyleProxy((path, args) => {
      calls.push({ path: path.join('.'), args })
      return []
    })
    const client = createEventsDataClient(systemWith(trpcClient))
    await client.listDevices()
    const query = calls.find((c) => c.path === 'deviceManager.listAll.query')
    expect(query?.args[0]).toEqual({ isCamera: true, projection: 'slim' })
  })
})
