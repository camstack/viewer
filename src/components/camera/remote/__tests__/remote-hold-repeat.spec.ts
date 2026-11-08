import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createHoldRepeater,
  HOLD_DELAY_MS,
  isRepeatableRole,
  REPEAT_GAP_MS,
} from '../remote-hold-repeat.js'

describe('remote hold repeat', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('a tap (released before the hold delay) never repeats and is not a hold', async () => {
    const send = vi.fn(() => Promise.resolve(true))
    const r = createHoldRepeater({ send })
    r.pressIn()
    await vi.advanceTimersByTimeAsync(HOLD_DELAY_MS - 1)
    r.pressOut()
    await vi.advanceTimersByTimeAsync(2000)
    expect(send).not.toHaveBeenCalled()
    expect(r.held()).toBe(false)
  })

  it('a hold sends at the delay, then repeats with the gap, until release', async () => {
    const send = vi.fn(() => Promise.resolve(true))
    const onRepeat = vi.fn()
    const r = createHoldRepeater({ send, onRepeat })
    r.pressIn()
    await vi.advanceTimersByTimeAsync(HOLD_DELAY_MS)
    expect(send).toHaveBeenCalledTimes(1)
    expect(r.held()).toBe(true)
    await vi.advanceTimersByTimeAsync(REPEAT_GAP_MS * 3)
    expect(send).toHaveBeenCalledTimes(4)
    expect(onRepeat).toHaveBeenCalledTimes(4)
    r.pressOut()
    await vi.advanceTimersByTimeAsync(2000)
    expect(send).toHaveBeenCalledTimes(4)
  })

  it('never overlaps: a slow send holds the next one back, then the gap applies', async () => {
    const resolvers: Array<(ok: boolean) => void> = []
    const send = vi.fn(() => new Promise<boolean>((resolve) => resolvers.push(resolve)))
    const r = createHoldRepeater({ send })
    r.pressIn()
    await vi.advanceTimersByTimeAsync(HOLD_DELAY_MS + 5000)
    expect(send).toHaveBeenCalledTimes(1)
    resolvers[0]?.(true)
    await vi.advanceTimersByTimeAsync(REPEAT_GAP_MS - 1)
    expect(send).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(send).toHaveBeenCalledTimes(2)
    r.pressOut()
  })

  it('release while a send is in flight sends nothing more', async () => {
    const resolvers: Array<(ok: boolean) => void> = []
    const send = vi.fn(() => new Promise<boolean>((resolve) => resolvers.push(resolve)))
    const r = createHoldRepeater({ send })
    r.pressIn()
    await vi.advanceTimersByTimeAsync(HOLD_DELAY_MS)
    r.pressOut()
    resolvers[0]?.(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('a failed send stops the repeat, a thrown one too', async () => {
    const send = vi.fn(() => Promise.resolve(false))
    const r = createHoldRepeater({ send })
    r.pressIn()
    await vi.advanceTimersByTimeAsync(HOLD_DELAY_MS + 5000)
    expect(send).toHaveBeenCalledTimes(1)
    const boom = vi.fn(() => Promise.reject(new Error('down')))
    const r2 = createHoldRepeater({ send: boom })
    r2.pressIn()
    await vi.advanceTimersByTimeAsync(HOLD_DELAY_MS + 5000)
    expect(boom).toHaveBeenCalledTimes(1)
  })

  it('a new press starts a fresh hold', async () => {
    const send = vi.fn(() => Promise.resolve(true))
    const r = createHoldRepeater({ send })
    r.pressIn()
    await vi.advanceTimersByTimeAsync(HOLD_DELAY_MS)
    r.pressOut()
    r.pressIn()
    expect(r.held()).toBe(false)
    r.pressOut()
  })

  it('only arrows, volume, channel and seek repeat', () => {
    for (const role of ['up', 'down', 'left', 'right', 'volume_up', 'volume_down', 'channel_up', 'channel_down', 'rewind', 'fast_forward']) {
      expect(isRepeatableRole(role)).toBe(true)
    }
    for (const role of ['power', 'power_on', 'mute', 'ok', 'back', 'digit_5', 'source_select', 'play', 'next', 'custom:foo']) {
      expect(isRepeatableRole(role)).toBe(false)
    }
  })
})
