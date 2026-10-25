import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OfflineDebouncer } from '../offline-debounce.js'
import type { ConnState } from '../recheck-policy.js'

const GRACE_MS = 3_000

describe('OfflineDebouncer', () => {
  let seen: ConnState[]
  let debouncer: OfflineDebouncer

  beforeEach(() => {
    vi.useFakeTimers()
    seen = []
    debouncer = new OfflineDebouncer(GRACE_MS, (s) => seen.push(s))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes connected/connecting through immediately', () => {
    debouncer.handle('connected')
    debouncer.handle('connecting')
    expect(seen).toEqual(['connected', 'connecting'])
  })

  it('debounces disconnected: connecting now, offline only past the grace window', () => {
    debouncer.handle('disconnected')
    expect(seen).toEqual(['connecting'])
    vi.advanceTimersByTime(GRACE_MS - 1)
    expect(seen).toEqual(['connecting'])
    vi.advanceTimersByTime(1)
    expect(seen).toEqual(['connecting', 'disconnected'])
  })

  it('a recovery within the grace window cancels the pending offline', () => {
    debouncer.handle('disconnected')
    vi.advanceTimersByTime(GRACE_MS - 1)
    debouncer.handle('connected')
    vi.advanceTimersByTime(GRACE_MS * 2)
    expect(seen).toEqual(['connecting', 'connected'])
  })

  it('re-arms cleanly across repeated drops', () => {
    debouncer.handle('disconnected')
    vi.advanceTimersByTime(GRACE_MS / 2)
    debouncer.handle('disconnected')
    vi.advanceTimersByTime(GRACE_MS - 1)
    // Only the SECOND drop's timer counts — the first was superseded.
    expect(seen).toEqual(['connecting', 'connecting'])
    vi.advanceTimersByTime(1)
    expect(seen).toEqual(['connecting', 'connecting', 'disconnected'])
  })

  it('REGRESSION: the teardown-emitted disconnected must not fire after dispose', () => {
    // Controller replacement (post-login handoff: new token → new controller):
    // the old System's WS close fires a final 'disconnected' through the old
    // handler DURING cleanup. It must be swallowed — the old code armed a
    // grace timer here that flipped the NEW controller's state to offline
    // ~3s after it had already connected, latching the UI until force-close.
    debouncer.dispose()
    debouncer.handle('disconnected')
    vi.advanceTimersByTime(GRACE_MS * 2)
    expect(seen).toEqual([])
  })

  it('dispose cancels an already-armed grace timer', () => {
    debouncer.handle('disconnected')
    expect(seen).toEqual(['connecting'])
    debouncer.dispose()
    vi.advanceTimersByTime(GRACE_MS * 2)
    expect(seen).toEqual(['connecting'])
  })

  it('ignores every event after dispose (late connect() rejection included)', () => {
    debouncer.dispose()
    debouncer.handle('connected')
    debouncer.handle('connecting')
    debouncer.handle('disconnected')
    vi.advanceTimersByTime(GRACE_MS * 2)
    expect(seen).toEqual([])
  })
})
