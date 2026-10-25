import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createTrailingCommit } from '../trailing-commit.js'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createTrailingCommit', () => {
  it('folds a burst of schedules into ONE commit, after the last one', () => {
    const commit = vi.fn()
    const trailing = createTrailingCommit(400, commit)

    for (let i = 0; i < 8; i += 1) {
      trailing.schedule()
      vi.advanceTimersByTime(100)
    }
    expect(commit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(400)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('commits again for a burst that starts after the window closed', () => {
    const commit = vi.fn()
    const trailing = createTrailingCommit(400, commit)

    trailing.schedule()
    vi.advanceTimersByTime(400)
    trailing.schedule()
    vi.advanceTimersByTime(400)

    expect(commit).toHaveBeenCalledTimes(2)
  })

  it('reports a pending commit and clears the flag once it fires', () => {
    const trailing = createTrailingCommit(400, () => {})
    expect(trailing.isScheduled()).toBe(false)
    trailing.schedule()
    expect(trailing.isScheduled()).toBe(true)
    vi.advanceTimersByTime(400)
    expect(trailing.isScheduled()).toBe(false)
  })

  it('cancel drops a pending commit (unmount)', () => {
    const commit = vi.fn()
    const trailing = createTrailingCommit(400, commit)
    trailing.schedule()
    trailing.cancel()
    vi.advanceTimersByTime(5_000)
    expect(commit).not.toHaveBeenCalled()
  })

  it('still defers a zero delay to a macrotask so one burst is one commit', () => {
    const commit = vi.fn()
    const trailing = createTrailingCommit(0, commit)
    trailing.schedule()
    trailing.schedule()
    expect(commit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(commit).toHaveBeenCalledTimes(1)
  })
})
