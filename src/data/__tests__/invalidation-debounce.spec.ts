import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createInvalidationDebouncer,
  INVALIDATION_DEBOUNCE_MS,
  serializeQueryKey,
} from '../invalidation-debounce.js'

describe('serializeQueryKey', () => {
  it('is stable for the same prefix', () => {
    expect(serializeQueryKey(['v2', 'children-states'])).toBe(
      serializeQueryKey(['v2', 'children-states']),
    )
  })

  it('separates segments so no two distinct prefixes collide', () => {
    // The naive `join('/')` would make these two identical.
    expect(serializeQueryKey(['v2', 'a/b'])).not.toBe(serializeQueryKey(['v2', 'a', 'b']))
  })
})

describe('createInvalidationDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not flush before the window elapses', () => {
    const flush = vi.fn()
    const d = createInvalidationDebouncer(INVALIDATION_DEBOUNCE_MS, flush)
    d.schedule(['v2', 'children-states'])
    vi.advanceTimersByTime(INVALIDATION_DEBOUNCE_MS - 1)
    expect(flush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith(['v2', 'children-states'])
  })

  it('coalesces a burst of N events inside the window into ONE flush', () => {
    // The measured failure: 18,924 dispatches of this exact key in 30s.
    const flush = vi.fn()
    const d = createInvalidationDebouncer(INVALIDATION_DEBOUNCE_MS, flush)
    for (let i = 0; i < 500; i += 1) {
      d.schedule(['v2', 'children-states'])
      vi.advanceTimersByTime(10) // 500 events, 10ms apart — 5s of storm
    }
    // Still nothing: every event reset the trailing timer.
    expect(flush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(INVALIDATION_DEBOUNCE_MS)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('is TRAILING — a new event inside the window extends the wait', () => {
    const flush = vi.fn()
    const d = createInvalidationDebouncer(INVALIDATION_DEBOUNCE_MS, flush)
    d.schedule(['v2', 'accessories'])
    vi.advanceTimersByTime(200)
    d.schedule(['v2', 'accessories'])
    vi.advanceTimersByTime(200) // 400ms since the first, but only 200 since the last
    expect(flush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('debounces PER KEY — different prefixes do not share a timer', () => {
    const flush = vi.fn()
    const d = createInvalidationDebouncer(INVALIDATION_DEBOUNCE_MS, flush)
    d.schedule(['v2', 'children-states'])
    d.schedule(['v2', 'accessories'])
    d.schedule(['v2', 'cap-status'])
    d.schedule(['v2', 'children-states']) // duplicate — must not add a fourth flush
    vi.advanceTimersByTime(INVALIDATION_DEBOUNCE_MS)
    expect(flush).toHaveBeenCalledTimes(3)
    // Order is not part of the contract — the duplicate reset `children-states`'
    // own timer, so it legitimately fires last. Only the SET matters.
    const flushed = flush.mock.calls.map((call: readonly unknown[]) => call[0])
    expect(flushed).toHaveLength(3)
    expect(flushed).toContainEqual(['v2', 'children-states'])
    expect(flushed).toContainEqual(['v2', 'accessories'])
    expect(flushed).toContainEqual(['v2', 'cap-status'])
  })

  it('a second burst after a flush produces a second flush', () => {
    const flush = vi.fn()
    const d = createInvalidationDebouncer(INVALIDATION_DEBOUNCE_MS, flush)
    d.schedule(['v2', 'cameras'])
    vi.advanceTimersByTime(INVALIDATION_DEBOUNCE_MS)
    expect(flush).toHaveBeenCalledTimes(1)
    d.schedule(['v2', 'cameras'])
    vi.advanceTimersByTime(INVALIDATION_DEBOUNCE_MS)
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('dispose() cancels every pending timer — nothing fires after unmount', () => {
    const flush = vi.fn()
    const d = createInvalidationDebouncer(INVALIDATION_DEBOUNCE_MS, flush)
    d.schedule(['v2', 'children-states'])
    d.schedule(['v2', 'accessories'])
    d.dispose()
    vi.advanceTimersByTime(INVALIDATION_DEBOUNCE_MS * 10)
    expect(flush).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a schedule after dispose still works (the hook may remount)', () => {
    const flush = vi.fn()
    const d = createInvalidationDebouncer(INVALIDATION_DEBOUNCE_MS, flush)
    d.dispose()
    d.schedule(['v2', 'cameras'])
    vi.advanceTimersByTime(INVALIDATION_DEBOUNCE_MS)
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('leaks no timer once every key has flushed', () => {
    const flush = vi.fn()
    const d = createInvalidationDebouncer(INVALIDATION_DEBOUNCE_MS, flush)
    d.schedule(['v2', 'a'])
    d.schedule(['v2', 'b'])
    vi.advanceTimersByTime(INVALIDATION_DEBOUNCE_MS)
    expect(vi.getTimerCount()).toBe(0)
  })
})
