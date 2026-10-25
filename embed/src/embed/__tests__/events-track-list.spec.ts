/**
 * The embed half of the row-collection protocol: what the publisher decides to
 * send, and what the diff REFUSES to state as a delta.
 *
 * The end-to-end pairing with the host's accumulator lives in the viewer suite
 * (`src/events-embed/__tests__/events-track-list-protocol.spec.ts`) — these are
 * the cases where the interesting answer is "a full list", which an end-to-end
 * test would pass just as happily without noticing the cost.
 */
import { describe, expect, it } from 'vitest'
import {
  createTrackListReporter,
  diffTrackList,
  INITIAL_TRACK_LIST_PUBLISHER,
  publishTrackList,
  setTrackListMode,
} from '../events-track-list'
import type { EventsHostMessage, TrackClickPayload } from '../events-messages'

function row(id: number, lastSeen: number): TrackClickPayload {
  return {
    trackId: `t${id}`,
    deviceId: 101,
    bestEventId: `e${id}`,
    className: 'person',
    firstSeen: lastSeen - 1_000,
    lastSeen,
  }
}

function rows(from: number, count: number): readonly TrackClickPayload[] {
  return Array.from({ length: count }, (_, i) => row(from + i, 1_800_000_000_000 - i * 1_000))
}

const ids = (list: readonly TrackClickPayload[]): readonly string[] => list.map((r) => r.trackId)

describe('the mode is the host’s to choose, and full is the default', () => {
  it('posts whole lists until a host asks otherwise', () => {
    // The compatibility guarantee: an older host sends no `setTrackListMode`,
    // and this is the branch it stays on forever.
    const first = publishTrackList(INITIAL_TRACK_LIST_PUBLISHER, rows(1, 3))
    expect(first.state.mode).toBe('full')
    expect(first.message?.type).toBe('trackList')

    const second = publishTrackList(first.state, rows(1, 4))
    expect(second.message?.type).toBe('trackList')
  })

  it('answers the mode command with a fresh full baseline at a new seq', () => {
    // Both jobs of one verb: entering delta mode, and RESYNCHRONISING after a
    // host detected drift. If it did not re-post, a recovering host would sit
    // with an empty collection until the feed happened to change.
    const first = publishTrackList(INITIAL_TRACK_LIST_PUBLISHER, rows(1, 3))
    const asked = setTrackListMode(first.state, 'delta', rows(1, 3))
    expect(asked.state.mode).toBe('delta')
    expect(asked.message?.type).toBe('trackList')
    expect(asked.state.seq).toBe(first.state.seq + 1)
  })

  it('numbers every message it sends, and only the ones it sends', () => {
    // `seq` is what makes a lost delta detectable. A gap the embed introduced
    // itself would desync a host that lost nothing.
    const a = publishTrackList(INITIAL_TRACK_LIST_PUBLISHER, rows(1, 3))
    const b = setTrackListMode(a.state, 'delta', rows(1, 3))
    const quiet = publishTrackList(b.state, rows(1, 3))
    expect(quiet.message).toBeNull()
    expect(quiet.state.seq).toBe(b.state.seq)

    const c = publishTrackList(quiet.state, rows(1, 4))
    expect(c.state.seq).toBe(b.state.seq + 1)
    if (c.message?.type !== 'trackListDelta') throw new Error('expected a delta')
    expect(c.message.baseSeq).toBe(b.state.seq)
  })
})

describe('the diff refuses what it cannot prove', () => {
  it('calls a deep reorder a reset', () => {
    // The silent failure this guards: prev/next walking an order that is not
    // on screen. A swap far down a long list can only be stated by re-sending
    // everything above it, which the size rule then rejects — so the honest
    // answer is a full list.
    const held = ids(rows(1, 400))
    const swapped = [...rows(1, 400)]
    const mid = swapped[40]
    swapped[40] = swapped[360]
    swapped[360] = mid
    expect(diffTrackList(held, swapped).kind).toBe('reset')
  })

  it('never returns a delta that does not rebuild the list exactly', () => {
    // The property the whole design rests on, over the shapes the feed
    // actually produces: append, prepend, promote, drop, and combinations. A
    // delta that reconstructs to something else is undetectable on screen
    // until an operator opens a card and gets the wrong neighbours.
    const base = rows(1, 60)
    const cases: readonly (readonly TrackClickPayload[])[] = [
      [...base, ...rows(100, 20)],
      [...rows(200, 5), ...base],
      [base[30], ...base.filter((_, i) => i !== 30)],
      base.filter((_, i) => i % 7 !== 0),
      [...rows(300, 3), ...base.filter((_, i) => i !== 12), ...rows(400, 9)],
      [base[7], ...base.filter((_, i) => i !== 7 && i % 11 !== 0), ...rows(500, 4)],
    ]
    for (const next of cases) {
      const change = diffTrackList(ids(base), next)
      if (change.kind !== 'delta') continue
      const removed = new Set(change.removeIds)
      const rebuilt = [
        ...change.prepend.map((r) => r.trackId),
        ...ids(base).filter((id) => !removed.has(id)),
        ...change.append.map((r) => r.trackId),
      ]
      expect(rebuilt).toEqual(ids(next))
    }
  })

  it('calls a delta that is no smaller than the list a reset', () => {
    // A filter keeping 3 of 200 expresses as 197 removeIds — more bytes than
    // the 3 rows that survive. "Correct" is not the only bar.
    const held = ids(rows(1, 200))
    const kept = rows(1, 200).slice(50, 53)
    expect(diffTrackList(held, kept).kind).toBe('reset')
  })

  it('calls a wholesale replacement a reset', () => {
    // A day change: nothing in common. There is no baseline to build on.
    const held = ids(rows(1, 50))
    expect(diffTrackList(held, rows(900, 50)).kind).toBe('reset')
  })

  it('reports nothing when only the ids’ ROW OBJECTS changed', () => {
    // The pre-delta protocol keyed on the joined ids and posted nothing here
    // (a rename, a reviewed stamp). Same fidelity, deliberately.
    const held = ids(rows(1, 5))
    const renamed = rows(1, 5).map((r) => ({ ...r, className: 'vehicle' }))
    expect(diffTrackList(held, renamed).kind).toBe('unchanged')
  })
})

describe('the reporter is the page’s whole surface onto the protocol', () => {
  /** Collects what would have gone on the bridge. */
  function recorder(): { sent: EventsHostMessage[]; post: (m: EventsHostMessage) => void } {
    const sent: EventsHostMessage[] = []
    return { sent, post: (m) => void sent.push(m) }
  }

  it('re-baselines a mode command against the LAST reported rows', () => {
    // The command carries no rows. If the reporter did not remember them it
    // would have to re-read the feed — a second source of truth about what is
    // on screen, and the resync would answer with the wrong list.
    const { sent, post } = recorder()
    const reporter = createTrackListReporter(post)
    reporter.report(rows(1, 4))
    reporter.report(rows(1, 6))
    reporter.setMode('delta')

    const last = sent.at(-1)
    if (last?.type !== 'trackList') throw new Error('expected a full baseline')
    expect(last.tracks.map((t) => t.trackId)).toEqual(ids(rows(1, 6)))
  })

  it('posts nothing when the reported collection did not change', () => {
    const { sent, post } = recorder()
    const reporter = createTrackListReporter(post)
    reporter.report(rows(1, 5))
    reporter.report(rows(1, 5))
    expect(sent).toHaveLength(1)
  })

  it('switches to deltas only after the command, and never before', () => {
    const { sent, post } = recorder()
    const reporter = createTrackListReporter(post)
    reporter.report(rows(1, 5))
    reporter.report(rows(1, 6))
    reporter.setMode('delta')
    reporter.report(rows(1, 7))
    expect(sent.map((m) => m.type)).toEqual([
      'trackList',
      'trackList',
      'trackList',
      'trackListDelta',
    ])
  })
})
