/**
 * `capQuery` options — the two things a BULK read needs that a badge read does
 * not.
 *
 * `capQuery` was written for per-camera status probes and collapses every
 * outcome into `null`: the hub has no such cap, the call failed, the call never
 * answered. For a badge those are all "unknown" and the collapse is right.
 *
 * For a list that fills a screen it is a lie with a cost. On 2026-08-14 the
 * camera timeline asked for a day of tracks from a busy camera (7.9 MB on the
 * `full` projection), the six-second badge deadline expired, `capQuery`
 * returned `null`, the hook mapped it to `[]` and React Query recorded a
 * SUCCESS. `isError` was false, no retry ran, and the screen drew a quiet
 * camera for five minutes while the hub held 380 tracks.
 */
import { describe, it, expect, vi } from 'vitest'
import { capQuery, CAP_QUERY_DEADLINE_MS, BULK_QUERY_DEADLINE_MS } from '../cap-query.js'
import { isQueryDeadlineError } from '../query-deadline.js'

vi.mock('../../lib/logger.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

/** A tRPC-shaped client whose one procedure behaves however the test says. */
function clientWith(query: () => Promise<unknown>): Record<string, unknown> {
  return { pipelineAnalytics: { listTracks: { query } } }
}

describe('capQuery — the default contract is unchanged', () => {
  it('still swallows a server error to null when no options are given', async () => {
    const client = clientWith(() => Promise.reject(new Error('boom')))
    await expect(capQuery(client, 'pipelineAnalytics', 'listTracks', {})).resolves.toBeNull()
  })

  it('still returns null for a cap this hub does not have', async () => {
    await expect(capQuery({}, 'pipelineAnalytics', 'listTracks', {})).resolves.toBeNull()
  })
})

describe('capQuery — rethrow separates "no answer" from "no feature"', () => {
  it('propagates a server error so React Query can record a failure', async () => {
    const client = clientWith(() => Promise.reject(new Error('boom')))
    await expect(
      capQuery(client, 'pipelineAnalytics', 'listTracks', {}, { rethrow: true }),
    ).rejects.toThrow('boom')
  })

  it('propagates a DEADLINE expiry, and it is recognisable as one', async () => {
    // The distinction matters downstream: "this took too long" and "the server
    // said no" want different words on screen.
    const client = clientWith(() => new Promise(() => { /* never settles */ }))
    const err = await capQuery(
      client,
      'pipelineAnalytics',
      'listTracks',
      {},
      { rethrow: true, deadlineMs: 5 },
    ).catch((e: unknown) => e)
    expect(isQueryDeadlineError(err)).toBe(true)
  })

  it('an ABSENT cap still answers null even under rethrow — that is a real answer', async () => {
    // A hub too old to have the procedure is not a failure to reach one, and
    // putting the screen into a permanent error state over it would be wrong.
    await expect(
      capQuery({}, 'pipelineAnalytics', 'listTracks', {}, { rethrow: true }),
    ).resolves.toBeNull()
  })
})

describe('capQuery — a void procedure is called with NO argument', () => {
  it('does not pass undefined — tRPC serializes that as null and z.void() rejects', async () => {
    // `auth.me` (and faceGallery.listIdentities) are z.void(). The resume
    // probe already calls `.query()` with no args and the session lives; useMe
    // went through capQuery, which forwarded the omitted input as
    // `query(undefined)`. SuperJSON then sent `{ json: null }`, Zod rejected
    // it, capQuery swallowed the error to null, React Query cached SUCCESS
    // with staleTime Infinity, and every admin affordance vanished.
    const query = vi.fn(async (...args: unknown[]) => {
      if (args.length > 0) throw new Error('void procedures reject an explicit input')
      return { id: 'u-1', username: 'alice', isAdmin: true }
    })
    const client = { auth: { me: { query } } }
    await expect(capQuery(client, 'auth', 'me')).resolves.toEqual({
      id: 'u-1',
      username: 'alice',
      isAdmin: true,
    })
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]).toEqual([])
  })

  it('still forwards a real input object when the caller gave one', async () => {
    const query = vi.fn(async (input: unknown) => input)
    const client = { pipelineAnalytics: { listTracks: { query } } }
    await expect(
      capQuery(client, 'pipelineAnalytics', 'listTracks', { deviceId: 108 }),
    ).resolves.toEqual({ deviceId: 108 })
    expect(query).toHaveBeenCalledWith({ deviceId: 108 })
  })
})

describe('capQuery — the deadline is the caller\'s to choose', () => {
  it('honours a caller deadline instead of the badge-sized default', async () => {
    const client = clientWith(() => new Promise(() => { /* never settles */ }))
    const t0 = Date.now()
    await capQuery(client, 'pipelineAnalytics', 'listTracks', {}, { deadlineMs: 10 })
    // Far below CAP_QUERY_DEADLINE_MS: proof the override is what bounded it.
    expect(Date.now() - t0).toBeLessThan(CAP_QUERY_DEADLINE_MS)
  })

  it('the bulk deadline is bigger than the badge one — a day of history is not a status probe', () => {
    expect(BULK_QUERY_DEADLINE_MS).toBeGreaterThan(CAP_QUERY_DEADLINE_MS)
  })
})
