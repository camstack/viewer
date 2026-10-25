import { describe, it, expect, vi } from 'vitest'
import {
  LIVE_VIEWERS_POLL_MS,
  LiveViewersPoller,
  parseLiveViewerCounts,
  queryLiveViewerCounts,
  viewersFor,
  type LiveViewerCounts,
} from '../live-viewers'

describe('parseLiveViewerCounts / viewersFor', () => {
  it('per-camera record from the hub list; malformed rows dropped', () => {
    expect(
      parseLiveViewerCounts([
        { deviceId: 4, viewers: 2 },
        { deviceId: 5, viewers: 0 },
        { deviceId: -1, viewers: 3 },
        null,
      ]),
    ).toEqual({ 4: 2 })
  })

  it('null (unknown) for a non-list; a missing camera in a real answer is 0', () => {
    expect(parseLiveViewerCounts({ not: 'a list' })).toBeNull()
    expect(viewersFor(null, 4)).toBeNull()
    expect(viewersFor({ 4: 2 }, 9)).toBe(0)
    expect(viewersFor({ 4: 2 }, 4)).toBe(2)
  })
})

describe('queryLiveViewerCounts', () => {
  it('reads streamBroker.getLiveViewerCounts.query()', async () => {
    const query = vi.fn(() => Promise.resolve([{ deviceId: 3, viewers: 1 }]))
    const client = { streamBroker: { getLiveViewerCounts: { query } } }
    expect(await queryLiveViewerCounts(client)).toEqual({ 3: 1 })
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('is null on a hub without the method and when the call throws — never an empty answer', async () => {
    expect(await queryLiveViewerCounts({})).toBeNull()
    expect(await queryLiveViewerCounts({ streamBroker: {} })).toBeNull()
    const client = {
      streamBroker: { getLiveViewerCounts: { query: () => Promise.reject(new Error('NOT_FOUND')) } },
    }
    expect(await queryLiveViewerCounts(client)).toBeNull()
  })
})

describe('LiveViewersPoller — one shared poll, owned by its listeners', () => {
  function makePoller(answers: (LiveViewerCounts | null)[]) {
    let tick: () => void = () => undefined
    const clear = vi.fn()
    let n = 0
    const fetchCounts = vi.fn(() => Promise.resolve(answers[Math.min(n++, answers.length - 1)] ?? null))
    const poller = new LiveViewersPoller({
      fetchCounts,
      setInterval: (fn, ms) => {
        expect(ms).toBe(LIVE_VIEWERS_POLL_MS)
        tick = fn
        return 'timer'
      },
      clearInterval: clear,
    })
    return { poller, fetchCounts, clear, fire: () => tick() }
  }

  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  it('does nothing until someone listens, then fetches once for any number of tiles', async () => {
    const { poller, fetchCounts } = makePoller([{ 1: 2 }])
    expect(poller.isRunning).toBe(false)
    const off1 = poller.subscribe(() => undefined)
    const off2 = poller.subscribe(() => undefined)
    const off3 = poller.subscribe(() => undefined)
    await flush()
    expect(fetchCounts).toHaveBeenCalledTimes(1)
    expect(poller.getSnapshot()).toEqual({ 1: 2 })
    off1()
    off2()
    off3()
  })

  it('refreshes on the interval and tells the listeners', async () => {
    const { poller, fire } = makePoller([{ 1: 1 }, { 1: 3 }])
    const seen = vi.fn()
    poller.subscribe(seen)
    await flush()
    fire()
    await flush()
    expect(poller.getSnapshot()).toEqual({ 1: 3 })
    expect(seen).toHaveBeenCalledTimes(2)
  })

  it('stops with the last listener and forgets the number', async () => {
    const { poller, clear } = makePoller([{ 1: 5 }])
    const offA = poller.subscribe(() => undefined)
    const offB = poller.subscribe(() => undefined)
    await flush()
    offA()
    expect(poller.isRunning).toBe(true)
    expect(clear).not.toHaveBeenCalled()
    offB()
    expect(poller.isRunning).toBe(false)
    expect(clear).toHaveBeenCalledWith('timer')
    // A later tile does not see the old count as current.
    expect(poller.getSnapshot()).toBeNull()
  })

  it('a failed poll makes the number UNKNOWN, not zero', async () => {
    const { poller, fire } = makePoller([{ 1: 4 }, null])
    poller.subscribe(() => undefined)
    await flush()
    expect(poller.getSnapshot()).toEqual({ 1: 4 })
    fire()
    await flush()
    expect(poller.getSnapshot()).toBeNull()
  })

  it('an answer that lands after the last listener left is dropped', async () => {
    let resolve: (c: LiveViewerCounts | null) => void = () => undefined
    const poller = new LiveViewersPoller({
      fetchCounts: () => new Promise((r) => (resolve = r)),
      setInterval: () => 'timer',
      clearInterval: () => undefined,
    })
    const off = poller.subscribe(() => undefined)
    off()
    resolve({ 1: 9 })
    await flush()
    expect(poller.getSnapshot()).toBeNull()
  })
})
