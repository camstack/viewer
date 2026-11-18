/**
 * A playback position asked for while the channel is still NEGOTIATING is held
 * for its open edge — never refused.
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
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RecordedTrackSession } from '../recorded-track-session.js'

type MessageCb = (ev: { data: unknown }) => void
type OpenCb = () => void

interface NegotiatingChannel {
  readyState: string
  readonly sent: string[]
  send(data: string): void
  addEventListener(type: 'message', cb: MessageCb): void
  addEventListener(type: 'open', cb: OpenCb): void
  removeEventListener(type: 'message', cb: MessageCb): void
  removeEventListener(type: 'open', cb: OpenCb): void
  open(): void
}

/** A channel the way `createDataChannel` hands it over: `connecting`. */
function negotiatingChannel(): NegotiatingChannel {
  const opens = new Set<OpenCb>()
  const sent: string[] = []
  const channel: NegotiatingChannel = {
    readyState: 'connecting',
    sent,
    send: (d: string) => {
      sent.push(d)
    },
    addEventListener: (type: string, cb: MessageCb | OpenCb) => {
      if (type === 'open') opens.add(cb as OpenCb)
    },
    removeEventListener: (type: string, cb: MessageCb | OpenCb) => {
      if (type === 'open') opens.delete(cb as OpenCb)
    },
    open: () => {
      channel.readyState = 'open'
      for (const cb of [...opens]) cb()
    },
  }
  return channel
}

const sentMsgs = (ch: NegotiatingChannel): Array<Record<string, unknown>> =>
  ch.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>)

const CURSOR = 1_763_460_000_000

describe('RecordedTrackSession — a reconnect in flight', () => {
  it('holds the cursor and the pause for the open edge, and sends them in order', () => {
    const ch = negotiatingChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => null })

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
  })

  it('keeps only the newest position', () => {
    const ch = negotiatingChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => null })
    s.playRecorded(7, CURSOR - 5_000, 'low')
    s.playRecorded(7, CURSOR, 'low')
    ch.open()
    expect(sentMsgs(ch)).toEqual([{ t: 'playRecorded', deviceId: 7, epoch: CURSOR, profile: 'low' }])
  })

  it('a go-live before the open edge drops the held position', () => {
    const ch = negotiatingChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => null })
    s.playRecorded(7, CURSOR, 'low')
    s.goLive()
    ch.open()
    expect(ch.sent).toEqual([])
  })

  it('a session replaced before the open edge sends nothing', () => {
    const ch = negotiatingChannel()
    const s = new RecordedTrackSession({ channel: ch, video: () => null })
    s.playRecorded(7, CURSOR, 'low')
    s.dispose()
    ch.open()
    expect(ch.sent).toEqual([])
  })

  it('a dead channel still reports the gap', () => {
    const ch = negotiatingChannel()
    ch.readyState = 'closed'
    const s = new RecordedTrackSession({ channel: ch, video: () => null })
    expect(s.acceptsPointerMoves()).toBe(false)
    expect(s.playRecorded(7, CURSOR, 'low')).toBe(false)
  })
})

describe('EmbedPlayerPage hands a negotiating session its pointer moves', () => {
  it('gates on acceptsPointerMoves, not on an open channel', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'pages', 'EmbedPlayerPage.tsx'), 'utf8')
    expect(src).toContain('if (!current?.acceptsPointerMoves()) return null')
    expect(src).not.toContain('if (!current?.isOpen()) return null')
  })
})
