/**
 * presented-clock + the session's presented report (planning#728 P2): overlay
 * time is the epoch of the frame the browser PRESENTED, mapped through the RTP
 * stamp of the hub's `position`, never the send cursor.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { anchorFromPosition, presentedEpoch, rtpDelta } from '../presented-clock.js'
import { RecordedTrackSession, PRESENTED_REPORT_MS } from '../recorded-track-session.js'

describe('presented-clock', () => {
  it('maps a presented RTP stamp through the anchor at the play rate', () => {
    const a = anchorFromPosition({ epochMs: 10_000, rtpTs: 1_000, rate: 2 })
    // 9000 ticks at 90 kHz = 100 ms of media = 200 ms of recording at 2x
    expect(presentedEpoch(a, 10_000)).toBe(10_200)
  })

  it('is behind the send cursor when the presented stamp is older than the push', () => {
    const a = anchorFromPosition({ epochMs: 10_000, rtpTs: 900_000 })
    expect(presentedEpoch(a, 900_000 - 45_000)).toBe(9_500)
  })

  it('wraps across the uint32 boundary', () => {
    expect(rtpDelta(0xffff_fff0, 0x10)).toBe(0x20)
    expect(rtpDelta(0x10, 0xffff_fff0)).toBe(-0x20)
  })

  it('has no anchor without an RTP stamp, and no epoch without a frame stamp', () => {
    expect(anchorFromPosition({ epochMs: 1 })).toBeNull()
    expect(presentedEpoch(anchorFromPosition({ epochMs: 1, rtpTs: 5 }), undefined)).toBeNull()
    expect(presentedEpoch(null, 5)).toBeNull()
  })
})

interface Channel {
  readyState: string
  readonly sent: string[]
  send(d: string): void
  addEventListener(t: string, cb: (ev: { data: unknown }) => void): void
  removeEventListener(t: string, cb: (ev: { data: unknown }) => void): void
  emit(d: string): void
}
function channel(): Channel {
  const ls = new Set<(ev: { data: unknown }) => void>()
  const sent: string[] = []
  return {
    readyState: 'open',
    sent,
    send: (d) => sent.push(d),
    addEventListener: (t, cb) => {
      if (t === 'message') ls.add(cb)
    },
    removeEventListener: (_t, cb) => ls.delete(cb),
    emit: (d) => ls.forEach((cb) => cb({ data: d })),
  }
}

type Cb = (now: number, meta?: { rtpTimestamp?: number }) => void
function video(withRtp = true) {
  let pending: Cb | null = null
  return {
    requestVideoFrameCallback(cb: Cb) {
      pending = cb
      return 1
    },
    cancelVideoFrameCallback() {
      pending = null
    },
    present(rtpTimestamp: number) {
      const cb = pending
      pending = null
      cb?.(0, withRtp ? { rtpTimestamp } : {})
    },
  }
}

const pos = (ch: Channel, m: Record<string, unknown>) => ch.emit(JSON.stringify({ t: 'position', ...m }))

describe('RecordedTrackSession — presented report', () => {
  afterEach(() => vi.useRealTimers())

  it('reports the PRESENTED epoch, which differs from the send cursor', () => {
    vi.useFakeTimers()
    const ch = channel()
    const v = video()
    const onPresented = vi.fn()
    const onPosition = vi.fn()
    const s = new RecordedTrackSession({ channel: ch, video: () => v, onPresented, onPosition })
    pos(ch, { epochMs: 20_000, rtpTs: 90_000 })
    v.present(90_000 - 18_000) // 200 ms of media behind the push
    expect(onPosition).toHaveBeenCalledWith(20_000)
    expect(onPresented).toHaveBeenCalledWith(19_800)
    s.dispose()
  })

  it('throttles reports to one per PRESENTED_REPORT_MS', () => {
    vi.useFakeTimers()
    const ch = channel()
    const v = video()
    const onPresented = vi.fn()
    new RecordedTrackSession({ channel: ch, video: () => v, onPresented })
    pos(ch, { epochMs: 20_000, rtpTs: 0 })
    v.present(0)
    v.present(3_000)
    expect(onPresented).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(PRESENTED_REPORT_MS)
    v.present(18_000)
    expect(onPresented).toHaveBeenCalledTimes(2)
  })

  it('re-anchors on a seek: a frame presented before the new position maps to nothing', () => {
    vi.useFakeTimers()
    const ch = channel()
    const v = video()
    const onPresented = vi.fn()
    const s = new RecordedTrackSession({ channel: ch, video: () => v, onPresented })
    pos(ch, { epochMs: 20_000, rtpTs: 0 })
    s.seek(500_000)
    vi.advanceTimersByTime(PRESENTED_REPORT_MS)
    v.present(9_000) // an old-pointer frame, still in the jitter buffer
    expect(onPresented).not.toHaveBeenCalled()
    pos(ch, { epochMs: 500_000, rtpTs: 1_000_000 })
    vi.advanceTimersByTime(PRESENTED_REPORT_MS)
    v.present(1_000_000 + 9_000)
    expect(onPresented).toHaveBeenCalledWith(500_100)
  })

  it('a rate change drops the anchor too', () => {
    vi.useFakeTimers()
    const ch = channel()
    const v = video()
    const onPresented = vi.fn()
    const s = new RecordedTrackSession({ channel: ch, video: () => v, onPresented })
    pos(ch, { epochMs: 20_000, rtpTs: 0 })
    s.setRate(2)
    v.present(9_000)
    expect(onPresented).not.toHaveBeenCalled()
  })

  it('falls back to the cursor when the hub sends no RTP stamp', () => {
    const ch = channel()
    const v = video()
    const onPresented = vi.fn()
    const onPosition = vi.fn()
    new RecordedTrackSession({ channel: ch, video: () => v, onPresented, onPosition })
    pos(ch, { epochMs: 20_000 })
    v.present(1)
    expect(onPosition).toHaveBeenCalledWith(20_000)
    expect(onPresented).not.toHaveBeenCalled()
  })

  it('falls back to the cursor when the engine exposes no rtpTimestamp', () => {
    const ch = channel()
    const v = video(false)
    const onPresented = vi.fn()
    new RecordedTrackSession({ channel: ch, video: () => v, onPresented })
    pos(ch, { epochMs: 20_000, rtpTs: 5 })
    v.present(5)
    expect(onPresented).not.toHaveBeenCalled()
  })

  it('falls back to the cursor when requestVideoFrameCallback is missing', () => {
    const ch = channel()
    const onPresented = vi.fn()
    const onPosition = vi.fn()
    new RecordedTrackSession({ channel: ch, video: () => ({}), onPresented, onPosition })
    pos(ch, { epochMs: 20_000, rtpTs: 5 })
    expect(onPosition).toHaveBeenCalledWith(20_000)
    expect(onPresented).not.toHaveBeenCalled()
  })
})
