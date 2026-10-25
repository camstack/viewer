/**
 * The app's binding of the shared feed hook's one call. What matters is what it
 * does on FAILURE: the feed owns the retry and the error state, and can only do
 * that if a dead page is an exception — a swallowed `null` would be painted as
 * an unexpected response and never retried.
 */
import { describe, expect, it, vi } from 'vitest'
import { createEventsFeedClient, logEventsFeed } from '../events-feed-client.js'
import { log } from '../../lib/logger.js'

const INPUT = { deviceIds: [1], since: 1, limit: 60, projection: 'slim' as const }

function trpc(query: () => Promise<unknown>): object {
  return { pipelineAnalytics: { listRecentTracks: { query } } }
}

describe('createEventsFeedClient', () => {
  it('forwards the input verbatim to pipelineAnalytics.listRecentTracks', async () => {
    const query = vi.fn(() => Promise.resolve({ tracks: [], nextCursor: null }))
    const answer = await createEventsFeedClient(() => trpc(query)).listRecentTracks(INPUT)
    expect(query).toHaveBeenCalledWith(INPUT)
    expect(answer).toEqual({ tracks: [], nextCursor: null })
  })

  it('PROPAGATES a failing call, so the feed can retry and then admit the error', async () => {
    const client = createEventsFeedClient(() => trpc(() => Promise.reject(new Error('boom'))))
    await expect(client.listRecentTracks(INPUT)).rejects.toThrow('boom')
  })

  it('rejects when there is no connection, instead of asking a dead socket', async () => {
    await expect(createEventsFeedClient(() => null).listRecentTracks(INPUT)).rejects.toThrow('not connected')
  })

  it('resolves the client PER CALL: a route failover replaces the system underneath', async () => {
    const first = vi.fn(() => Promise.resolve({ tracks: [], nextCursor: null }))
    const second = vi.fn(() => Promise.resolve({ tracks: [], nextCursor: null }))
    let current = trpc(first)
    const client = createEventsFeedClient(() => current)
    await client.listRecentTracks(INPUT)
    current = trpc(second)
    await client.listRecentTracks(INPUT)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('logEventsFeed', () => {
  it('keeps the routine page line quiet (debug) and a failure, retry or hole loud (warn)', () => {
    const debug = vi.spyOn(log, 'debug').mockImplementation(() => undefined)
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    logEventsFeed('request complete', { rows: 3 })
    expect(debug).toHaveBeenCalledWith('events:feed', 'request complete', { rows: 3 })
    expect(warn).not.toHaveBeenCalled()
    logEventsFeed('listRecentTracks failed', { error: 'x' })
    expect(warn).toHaveBeenCalledWith('events:feed', 'listRecentTracks failed', { error: 'x' })
    debug.mockRestore()
    warn.mockRestore()
  })
})
