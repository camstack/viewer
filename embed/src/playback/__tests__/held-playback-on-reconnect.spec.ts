/**
 * A playback position asked for while the channel is still NEGOTIATING is held
 * for its open edge — never refused, and never dropped in silence.
 *
 * Reported 2026-11-18 (iOS, camera screen, scrubbed into a recording): pull
 * the notification shade, come back, and the player says "the video stream is
 * unavailable"; play has to be pressed several times, and when it plays it is
 * not where the cursor was.
 *
 * The chain: the foreground rebuilds the peer; the host re-asserts the cursor
 * (`playRecorded`) as soon as the player reports `playing` — which the player
 * does on ICE `connected`, BEFORE DTLS/SCTP has opened the data channel. The
 * session refused the move (`send()` on a `connecting` channel), the page
 * reported `recState: error`, and the new connection stayed on the live edge.
 *
 * Holding the move opens three more ways to lose it, each covered here: the
 * channel closes before it opens, it never opens, or an auto-retry replaces
 * the session with one on a new channel.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRecordedCommandRouter } from '../recorded-command-router.js'
import {
  HELD_OPEN_TIMEOUT_MS,
  RecordedTrackSession,
  type HeldDropReason,
} from '../recorded-track-session.js'

type MessageCb = (ev: { data: unknown }) => void
type EdgeCb = () => void

interface NegotiatingChannel {
  readyState: string
  readonly sent: string[]
  send(data: string): void
  addEventListener(type: 'message', cb: MessageCb): void
  addEventListener(type: 'open' | 'close', cb: EdgeCb): void
  removeEventListener(type: 'message', cb: MessageCb): void
  removeEventListener(type: 'open' | 'close', cb: EdgeCb): void
  open(): void
  close(): void
}

/** A channel the way `createDataChannel` hands it over: `connecting`. */
function negotiatingChannel(): NegotiatingChannel {
  const edges = { open: new Set<EdgeCb>(), close: new Set<EdgeCb>() }
  const sent: string[] = []
  const fire = (set: Set<EdgeCb>): void => {
    for (const cb of [...set]) cb()
  }
  const channel: NegotiatingChannel = {
    readyState: 'connecting',
    sent,
    send: (d: string) => {
      sent.push(d)
    },
    addEventListener: (type: string, cb: MessageCb | EdgeCb) => {
      if (type === 'open' || type === 'close') edges[type].add(cb as EdgeCb)
    },
    removeEventListener: (type: string, cb: MessageCb | EdgeCb) => {
      if (type === 'open' || type === 'close') edges[type].delete(cb as EdgeCb)
    },
    open: () => {
      channel.readyState = 'open'
      fire(edges.open)
    },
    close: () => {
      channel.readyState = 'closed'
      fire(edges.close)
    },
  }
  return channel
}

const sentMsgs = (ch: NegotiatingChannel): Array<Record<string, unknown>> =>
  ch.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>)

const CURSOR = 1_763_460_000_000

interface Probe {
  readonly session: RecordedTrackSession
  readonly drops: HeldDropReason[]
  readonly logs: string[]
}

function sessionOn(channel: NegotiatingChannel): Probe {
  const drops: HeldDropReason[] = []
  const logs: string[] = []
  const session = new RecordedTrackSession({
    channel,
    video: () => null,
    onHeldDropped: (reason) => drops.push(reason),
    onLog: (msg) => logs.push(msg),
  })
  return { session, drops, logs }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('RecordedTrackSession — a reconnect in flight', () => {
  it('holds the cursor and the pause for the open edge, and sends them in order', () => {
    const ch = negotiatingChannel()
    const { session: s, drops } = sessionOn(ch)

    expect(s.acceptsPointerMoves()).toBe(true)
    // Accepted, not refused: a refusal is what the page turned into a dead stream.
    expect(s.playRecorded(7, CURSOR, 'mid')).toBe(true)
    expect(s.setRate(0)).toBe(true)
    expect(ch.sent).toEqual([])

    ch.open()
    expect(sentMsgs(ch)).toEqual([
      { t: 'playRecorded', deviceId: 7, epoch: CURSOR, profile: 'mid' },
      { t: 'setRate', rate: 0 },
    ])
    expect(drops).toEqual([])
  })

  it('keeps only the newest position', () => {
    const ch = negotiatingChannel()
    const { session: s } = sessionOn(ch)
    s.playRecorded(7, CURSOR - 5_000, 'low')
    s.playRecorded(7, CURSOR, 'low')
    ch.open()
    expect(sentMsgs(ch)).toEqual([{ t: 'playRecorded', deviceId: 7, epoch: CURSOR, profile: 'low' }])
  })

  it('a go-live before the open edge drops the held position, as asked', () => {
    const ch = negotiatingChannel()
    const { session: s, drops } = sessionOn(ch)
    s.playRecorded(7, CURSOR, 'low')
    s.goLive()
    ch.open()
    expect(ch.sent).toEqual([])
    expect(drops).toEqual([])
  })

  it('a dead channel still reports the gap', () => {
    const ch = negotiatingChannel()
    ch.readyState = 'closed'
    const { session: s } = sessionOn(ch)
    expect(s.acceptsPointerMoves()).toBe(false)
    expect(s.playRecorded(7, CURSOR, 'low')).toBe(false)
  })
})

describe('RecordedTrackSession — a held move is never lost in silence', () => {
  it('connecting → closed: the held position is reported dropped, with the reason', () => {
    const ch = negotiatingChannel()
    const { session: s, drops, logs } = sessionOn(ch)
    s.playRecorded(7, CURSOR, 'low')
    ch.close()
    expect(drops).toEqual(['channel-closed'])
    expect(logs).toContain('playback:held-dropped')
    expect(ch.sent).toEqual([])
  })

  it('a channel stuck connecting is an error after the bound, not a wait forever', () => {
    vi.useFakeTimers()
    const ch = negotiatingChannel()
    const { session: s, drops } = sessionOn(ch)
    s.playRecorded(7, CURSOR, 'low')
    vi.advanceTimersByTime(HELD_OPEN_TIMEOUT_MS - 1)
    expect(drops).toEqual([])
    vi.advanceTimersByTime(1)
    expect(drops).toEqual(['open-timeout'])
    // Nothing is flushed by a late open: the host's recovery owns it now.
    ch.open()
    expect(ch.sent).toEqual([])
  })

  it('an open before the bound disarms it', () => {
    vi.useFakeTimers()
    const ch = negotiatingChannel()
    const { session: s, drops } = sessionOn(ch)
    s.playRecorded(7, CURSOR, 'low')
    ch.open()
    vi.advanceTimersByTime(HELD_OPEN_TIMEOUT_MS * 2)
    expect(drops).toEqual([])
  })

  it('disposed with a move still held (nobody carried it): reported dropped', () => {
    const ch = negotiatingChannel()
    const { session: s, drops } = sessionOn(ch)
    s.playRecorded(7, CURSOR, 'low')
    s.dispose()
    ch.open()
    expect(drops).toEqual(['disposed'])
    expect(ch.sent).toEqual([])
  })

  it('auto-retry: the move held for channel A is carried into the session on channel B', () => {
    const a = negotiatingChannel()
    const first = sessionOn(a)
    first.session.playRecorded(7, CURSOR, 'mid')
    first.session.setRate(0)

    // What the page does on a new control channel.
    const carried = first.session.takeHeld()
    first.session.dispose()
    const b = negotiatingChannel()
    const second = sessionOn(b)
    expect(carried).not.toBeNull()
    if (carried !== null) second.session.adoptHeld(carried)

    expect(first.drops).toEqual([])
    expect(second.logs).toContain('playback:held-carried')
    a.open()
    expect(a.sent).toEqual([])
    b.open()
    expect(sentMsgs(b)).toEqual([
      { t: 'playRecorded', deviceId: 7, epoch: CURSOR, profile: 'mid' },
      { t: 'setRate', rate: 0 },
    ])
    expect(second.drops).toEqual([])
  })

  it('a move carried onto a channel already dead is reported dropped', () => {
    const a = negotiatingChannel()
    const first = sessionOn(a)
    first.session.playRecorded(7, CURSOR, 'mid')
    const carried = first.session.takeHeld()
    const b = negotiatingChannel()
    b.readyState = 'closed'
    const second = sessionOn(b)
    if (carried !== null) second.session.adoptHeld(carried)
    expect(second.drops).toEqual(['channel-closed'])
  })
})

describe('RecordedTrackSession — the newest intent wins at the open edge', () => {
  it('a position asked for after a clip replaces the clip', () => {
    const ch = negotiatingChannel()
    const { session: s } = sessionOn(ch)
    expect(s.playClip(7, 'clip-a', 'recorder', 4_000)).toBe(true)
    s.playRecorded(7, CURSOR, 'low')
    ch.open()
    expect(sentMsgs(ch)).toEqual([{ t: 'playRecorded', deviceId: 7, epoch: CURSOR, profile: 'low' }])
  })

  it('a clip asked for after a position replaces the position', () => {
    const ch = negotiatingChannel()
    const { session: s } = sessionOn(ch)
    s.playRecorded(7, CURSOR, 'low')
    s.playClip(7, 'clip-a', 'recorder', 4_000)
    ch.open()
    expect(sentMsgs(ch)).toEqual([
      { t: 'playClip', deviceId: 7, clipId: 'clip-a', provider: 'recorder', offsetMs: 4_000 },
    ])
    expect(s.holdsClip()).toBe(true)
  })

  it('a carried position wins over an OLDER clip that waited for the new channel', () => {
    const a = negotiatingChannel()
    const first = sessionOn(a)
    first.session.playRecorded(7, CURSOR, 'low')
    const carried = first.session.takeHeld()
    first.session.dispose()

    const b = negotiatingChannel()
    const second = sessionOn(b)
    // The page's `assertWaitingClip` runs first, with the older clip…
    second.session.playClip(7, 'clip-old', 'recorder', 0)
    // …then the carried move, which was asked for later.
    if (carried !== null) second.session.adoptHeld(carried)
    b.open()
    expect(sentMsgs(b)).toEqual([{ t: 'playRecorded', deviceId: 7, epoch: CURSOR, profile: 'low' }])
  })

  it('a seek on a held clip moves its file-relative offset', () => {
    const ch = negotiatingChannel()
    const { session: s } = sessionOn(ch)
    s.playClip(7, 'clip-a', 'recorder', 0)
    expect(s.seek(12_000)).toBe(true)
    ch.open()
    expect(sentMsgs(ch)).toEqual([
      { t: 'playClip', deviceId: 7, clipId: 'clip-a', provider: 'recorder', offsetMs: 12_000 },
    ])
  })
})

describe('RecordedTrackSession — a connecting channel still refuses the rest', () => {
  it('seek, stepFrame, goLive, begin and warm refuse and send nothing', () => {
    const ch = negotiatingChannel()
    const { session: s } = sessionOn(ch)
    expect(s.seek(CURSOR)).toBe(false)
    expect(s.stepFrame(1)).toBe(false)
    expect(s.goLive()).toBe(false)
    expect(s.begin('drag-1')).toBe(false)
    expect(s.warm(CURSOR)).toBe(false)
    expect(ch.sent).toEqual([])
    ch.open()
    // Nothing of the refused moves comes back on the open edge either.
    expect(ch.sent).toEqual([])
  })
})

describe('the page’s command router hands a negotiating session its moves', () => {
  it('a play on a negotiating channel is taken, not reported as a gap', () => {
    const ch = negotiatingChannel()
    const { session } = sessionOn(ch)
    const gaps: string[] = []
    const router = createRecordedCommandRouter({ current: () => session, onGap: (w) => gaps.push(w) })

    expect(router.run('playRecorded', (s) => s.playRecorded(7, CURSOR, 'low'))).toBe(true)
    expect(router.run('setRate', (s) => s.setRate(0))).toBe(true)
    expect(gaps).toEqual([])
    ch.open()
    expect(sentMsgs(ch)).toEqual([
      { t: 'playRecorded', deviceId: 7, epoch: CURSOR, profile: 'low' },
      { t: 'setRate', rate: 0 },
    ])
  })

  it('a dead channel or no session is a gap, reported once until a move lands', () => {
    const dead = negotiatingChannel()
    dead.readyState = 'closed'
    const { session } = sessionOn(dead)
    let current: RecordedTrackSession | null = session
    const gaps: string[] = []
    const router = createRecordedCommandRouter({ current: () => current, onGap: (w) => gaps.push(w) })

    expect(router.run('playRecorded', (s) => s.playRecorded(7, CURSOR, 'low'))).toBe(false)
    expect(router.run('seek', (s) => s.seek(CURSOR))).toBe(false)
    expect(gaps).toEqual(['playRecorded'])

    current = null
    router.resetGap()
    expect(router.run('goLive', (s) => s.goLive())).toBe(false)
    expect(gaps).toEqual(['playRecorded', 'goLive'])
    expect(router.session()).toBeNull()
  })
})
