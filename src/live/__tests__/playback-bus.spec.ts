import { describe, it, expect, vi } from 'vitest'
import { createGridPlaybackBus, type GridPlaybackSink } from '../playback-bus.js'

function fakeSink(): GridPlaybackSink & { readonly calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    scrubStart: () => void calls.push('scrubStart'),
    scrubTo: (ms: number) => void calls.push(`scrubTo:${ms}`),
    scrubCommit: (ms: number) => void calls.push(`scrubCommit:${ms}`),
    seek: (ms: number) => void calls.push(`seek:${ms}`),
    setRate: (r: number) => void calls.push(`setRate:${r}`),
    goLive: () => void calls.push('goLive'),
  }
}

describe('createGridPlaybackBus', () => {
  it('reaches every registered sink and reports the count', () => {
    const bus = createGridPlaybackBus()
    const a = fakeSink()
    const b = fakeSink()
    bus.register('a', a)
    bus.register('b', b)

    expect(bus.broadcast((s) => s.seek(1_234))).toBe(2)
    expect(a.calls).toEqual(['seek:1234'])
    expect(b.calls).toEqual(['seek:1234'])
  })

  it('reaches nothing (0) when no surface is mounted — a caller can log that', () => {
    expect(createGridPlaybackBus().broadcast((s) => s.goLive())).toBe(0)
  })

  it('unregisters on the returned disposer', () => {
    const bus = createGridPlaybackBus()
    const a = fakeSink()
    const off = bus.register('a', a)
    off()
    expect(bus.size()).toBe(0)
    expect(bus.broadcast((s) => s.seek(1))).toBe(0)
  })

  it('REPLACES a sink registered under the same key (no double-fire on remount)', () => {
    const bus = createGridPlaybackBus()
    const old = fakeSink()
    const fresh = fakeSink()
    bus.register('embed', old)
    bus.register('embed', fresh)
    expect(bus.size()).toBe(1)
    bus.broadcast((s) => s.seek(7))
    expect(old.calls).toEqual([])
    expect(fresh.calls).toEqual(['seek:7'])
  })

  it("a stale disposer does NOT unregister the replacement", () => {
    const bus = createGridPlaybackBus()
    const old = fakeSink()
    const fresh = fakeSink()
    const offOld = bus.register('embed', old)
    bus.register('embed', fresh)
    offOld() // the remounted surface's cleanup, arriving late
    expect(bus.size()).toBe(1)
    bus.broadcast((s) => s.seek(9))
    expect(fresh.calls).toEqual(['seek:9'])
  })

  it('one throwing sink never stops the others from seeking', () => {
    const bus = createGridPlaybackBus()
    const broken = { ...fakeSink(), seek: vi.fn(() => { throw new Error('tile is dead') }) }
    const ok = fakeSink()
    bus.register('broken', broken)
    bus.register('ok', ok)

    expect(bus.broadcast((s) => s.seek(5))).toBe(1)
    expect(ok.calls).toEqual(['seek:5'])
  })

  it('survives a sink unregistering itself mid-broadcast', () => {
    const bus = createGridPlaybackBus()
    const b = fakeSink()
    let offA: () => void = () => {}
    const a: GridPlaybackSink = { ...fakeSink(), seek: () => offA() }
    offA = bus.register('a', a)
    bus.register('b', b)

    expect(bus.broadcast((s) => s.seek(3))).toBe(2)
    expect(b.calls).toEqual(['seek:3'])
    expect(bus.size()).toBe(1)
  })

  it('clear() drops everything', () => {
    const bus = createGridPlaybackBus()
    bus.register('a', fakeSink())
    bus.register('b', fakeSink())
    bus.clear()
    expect(bus.size()).toBe(0)
  })
})
