import { describe, it, expect } from 'vitest'
import {
  trackToTimelineEvent,
  timelineEventToTrackSummary,
  collectTrackPages,
  mergeDeviceTrackWindows,
  isDeviceTracksLiveWindow,
  PAST_WINDOW_SETTLE_MS,
  TRACKS_PAGE_SIZE,
  TRACKS_MAX_ROWS,
} from '../use-device-tracks.js'
import type { TrackSummary } from '../track-events.js'
import type { ObjectEvent } from '../../components/camera/theater/event-cluster.js'

function track(partial: Partial<TrackSummary>): TrackSummary {
  return {
    trackId: 't1', deviceId: 1, cameraName: 'Cam', className: 'person',
    firstSeen: 1_000, lastSeen: 2_000, state: 'idle', active: false,
    zonesVisited: [], zoneNames: [], audioLabels: [], bestEventId: 'best-1',
    ...partial,
  }
}

describe('trackToTimelineEvent — TrackSummary → timeline ObjectEvent', () => {
  it('maps id to bestEventId (the id the media plane resolves) + core fields', () => {
    const e = trackToTimelineEvent(track({ label: 'Alice', importance: 0.8 }))
    expect(e).toEqual({
      id: 'best-1',
      deviceId: 1, // the authz subject of every media fetch for this event
      timestamp: 1_000, // firstSeen — when the object appeared (seek target)
      endTimestamp: 2_000, // lastSeen — powers the cluster fragment dedupe
      className: 'person',
      label: 'Alice',
      importance: 0.8,
      trackId: 't1',
    })
  })

  it('falls back to the trackId when the track has no bestEventId (toTrackSummary already does)', () => {
    const e = trackToTimelineEvent(track({ bestEventId: 't1' }))
    expect(e.id).toBe('t1')
    expect(e.trackId).toBe('t1')
  })

  it('omits absent optionals', () => {
    const e = trackToTimelineEvent(track({}))
    expect(e.label).toBeUndefined()
    expect(e.importance).toBeUndefined()
    expect(e.audioLabels).toBeUndefined()
    expect(e.positionBoxes).toBeUndefined()
    expect(e.normalizedEnvelope).toBeUndefined()
  })

  it('carries audio enrichment labels when the track heard any', () => {
    const e = trackToTimelineEvent(track({ audioLabels: ['dog_bark', 'speech'] }))
    expect(e.audioLabels).toEqual(['dog_bark', 'speech'])
  })

  it('carries pixel position boxes for the zone filter, omitting empty sets', () => {
    const boxes = [{ x: 10, y: 20, w: 30, h: 40 }]
    const geometry = { positionBoxes: boxes, normalizedEnvelope: null }
    expect(trackToTimelineEvent(track({}), geometry).positionBoxes).toEqual(boxes)
    expect(
      trackToTimelineEvent(track({}), { positionBoxes: [], normalizedEnvelope: null })
        .positionBoxes,
    ).toBeUndefined()
  })

  it('carries the normalised envelope ALONGSIDE the boxes — the pair is the scale', () => {
    // Boxes without the envelope leave the zone filter guessing the detection
    // frame from the loaded extents, which is exactly how it ended up comparing
    // the drawn rect against a frame half the real height.
    const envelope = { x: 0.1, y: 0.1, w: 0.75, h: 0.75 }
    const e = trackToTimelineEvent(track({}), {
      positionBoxes: [{ x: 64, y: 36, w: 32, h: 18 }],
      normalizedEnvelope: envelope,
    })
    expect(e.normalizedEnvelope).toEqual(envelope)
    expect(e.positionBoxes).toHaveLength(1)
  })
})

describe('timelineEventToTrackSummary — timeline ObjectEvent → TrackSummary', () => {
  function ev(over: Partial<ObjectEvent> = {}): ObjectEvent {
    return { id: 'best-1', deviceId: 7, timestamp: 1_000, className: 'person', ...over }
  }

  it('resolves media against the SAME id the timeline card renders (bestEventId = event id)', () => {
    const s = timelineEventToTrackSummary(ev({ trackId: 't1', endTimestamp: 2_000 }), 7)
    expect(s.bestEventId).toBe('best-1')
    expect(s.trackId).toBe('t1')
    expect(s.deviceId).toBe(7)
    expect(s.firstSeen).toBe(1_000)
    expect(s.lastSeen).toBe(2_000)
  })

  it('the modal hero and the timeline card can never diverge (round-trips the bestEventId)', () => {
    const summary: TrackSummary = {
      trackId: 't9', deviceId: 3, cameraName: '', className: 'car',
      firstSeen: 5, lastSeen: 9, state: 'idle', active: false,
      zonesVisited: [], zoneNames: [], audioLabels: [], bestEventId: 'ev:42',
    }
    // timeline card id === modal hero bestEventId
    const timelineItem = trackToTimelineEvent(summary)
    const back = timelineEventToTrackSummary(timelineItem, 3)
    expect(timelineItem.id).toBe('ev:42')
    expect(back.bestEventId).toBe(timelineItem.id)
  })

  it('falls back trackId → id, endTimestamp → timestamp, carries label/importance/audio', () => {
    const s = timelineEventToTrackSummary(
      ev({ label: 'Alice', importance: 0.7, audioLabels: ['speech'] }),
      1,
    )
    expect(s.trackId).toBe('best-1') // no trackId → the id
    expect(s.lastSeen).toBe(1_000) // no endTimestamp → timestamp
    expect(s.label).toBe('Alice')
    expect(s.importance).toBe(0.7)
    expect(s.audioLabels).toEqual(['speech'])
  })

  it('defaults the fields the slim timeline projection does not carry', () => {
    const s = timelineEventToTrackSummary(ev(), 2)
    expect(s.state).toBe('idle')
    expect(s.active).toBe(false)
    expect(s.zonesVisited).toEqual([])
    expect(s.cameraName).toBe('')
    expect(s.label).toBeUndefined()
    expect(s.importance).toBeUndefined()
  })
})

describe('collectTrackPages — walk newest-first pages until the window is exhausted', () => {
  interface Row {
    readonly id: string
    readonly firstSeen: number
  }

  function row(id: string, firstSeen: number): Row {
    return { id, firstSeen }
  }

  async function collect(
    pages: readonly Row[][],
    opts: { until: number; pageSize?: number; maxRows?: number } = { until: 10_000 },
  ): Promise<{ rows: Row[]; hasMore: boolean; nextUntil: number | null; untils: number[] }> {
    const untils: number[] = []
    const remaining = [...pages]
    const result = await collectTrackPages<Row>({
      until: opts.until,
      pageSize: opts.pageSize ?? 3,
      maxRows: opts.maxRows ?? 50,
      firstSeen: (r) => r.firstSeen,
      id: (r) => r.id,
      fetchPage: async ({ until, limit }) => {
        untils.push(until)
        const page = remaining.shift() ?? []
        expect(limit).toBe(opts.pageSize ?? 3)
        return page
      },
    })
    return { ...result, untils }
  }

  it('stops after a short page and does not fetch again — the window is EXHAUSTED, not capped', async () => {
    const { rows, untils, hasMore, nextUntil } = await collect([[row('a', 9), row('b', 8)]], {
      until: 10,
    })
    expect(untils).toEqual([10])
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(hasMore).toBe(false)
    expect(nextUntil).toBeNull()
  })

  it('walks a full page then a remainder, shrinking until past the oldest firstSeen', async () => {
    // The 500-cap bug: newest-first page of 3, then 2 older rows the first
    // call never returned. Next until is exclusive of the oldest already seen.
    const { rows, untils, hasMore } = await collect(
      [
        [row('n1', 1000), row('n2', 900), row('n3', 800)],
        [row('o1', 700), row('o2', 600)],
      ],
      { until: 2000, pageSize: 3 },
    )
    expect(untils).toEqual([2000, 799])
    expect(rows.map((r) => r.id)).toEqual(['n1', 'n2', 'n3', 'o1', 'o2'])
    expect(hasMore).toBe(false)
  })

  it('keeps morning rows that a single 500-cap newest-first page would drop', async () => {
    const newest = Array.from({ length: TRACKS_PAGE_SIZE }, (_, i) =>
      row(`n${i}`, 12_000 - i),
    )
    const morning = [row('08:01', 8_000), row('08:02', 7_900)]
    const { rows, hasMore } = await collect([newest, morning], {
      until: 20_000,
      pageSize: TRACKS_PAGE_SIZE,
      maxRows: TRACKS_MAX_ROWS,
    })
    expect(rows).toHaveLength(TRACKS_PAGE_SIZE + 2)
    expect(rows.some((r) => r.id === '08:01')).toBe(true)
    expect(hasMore).toBe(false)
  })

  it('stops at maxRows even if every page is full, and SAYS SO — hasMore, not a shorter list', async () => {
    const page1 = [row('a', 9), row('b', 8), row('c', 7)]
    const page2 = [row('d', 6), row('e', 5), row('f', 4)]
    const { rows, untils, hasMore, nextUntil } = await collect([page1, page2], {
      until: 10,
      pageSize: 3,
      maxRows: 5,
    })
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(untils).toEqual([10, 6])
    expect(TRACKS_MAX_ROWS).toBeGreaterThan(TRACKS_PAGE_SIZE)
    // The bound was hit mid-window (page2's 'f' was never fetched) — this is
    // exactly "there is more, ask for it", not "this camera has 5 rows".
    expect(hasMore).toBe(true)
    // A caller that resumes from nextUntil must not re-see 'e' (firstSeen 5).
    expect(nextUntil).toBe(4)
  })

  it('an empty first page is a quiet camera, not a retry', async () => {
    const { rows, untils, hasMore, nextUntil } = await collect([[]], { until: 10 })
    expect(rows).toEqual([])
    expect(untils).toEqual([10])
    expect(hasMore).toBe(false)
    expect(nextUntil).toBeNull()
  })

  it('a full page that adds nothing new (all duplicates of the prior page) is exhaustion, not a bound hit', async () => {
    // A well-behaved server never re-returns an already-passed row, but the
    // walk must still terminate rather than loop or falsely report `hasMore`
    // if it ever did — `added === 0` is exhaustion, same as a short page.
    const page1 = [row('a', 9), row('b', 8), row('c', 7)]
    const page2 = [row('a', 9), row('b', 8), row('c', 7)]
    const { rows, hasMore, nextUntil } = await collect([page1, page2], {
      until: 10,
      pageSize: 3,
      maxRows: 50,
    })
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(hasMore).toBe(false)
    expect(nextUntil).toBeNull()
  })
})

describe('isDeviceTracksLiveWindow — today is live; yesterday is not', () => {
  const noon = Date.parse('2026-08-24T12:00:00+02:00')

  it('a window that ends after the settle margin is still live', () => {
    expect(isDeviceTracksLiveWindow(noon + 12 * 3_600_000, noon)).toBe(true)
    expect(isDeviceTracksLiveWindow(noon, noon)).toBe(true)
  })

  it('a window that ended more than two minutes ago is settled history', () => {
    expect(isDeviceTracksLiveWindow(noon - PAST_WINDOW_SETTLE_MS - 1, noon)).toBe(false)
  })
})

describe('mergeDeviceTrackWindows — tail overwrites history on the same id', () => {
  const history: ObjectEvent = {
    id: 'a',
    deviceId: 1,
    timestamp: 1_000,
    endTimestamp: 2_000,
    className: 'person',
    trackId: 't-a',
  }
  const tailUpdate: ObjectEvent = {
    id: 'a',
    deviceId: 1,
    timestamp: 1_000,
    endTimestamp: 3_000,
    className: 'person',
    trackId: 't-a',
  }
  const tailOnly: ObjectEvent = {
    id: 'b',
    deviceId: 1,
    timestamp: 4_000,
    className: 'car',
    trackId: 't-b',
  }

  it('returns undefined when neither half has landed', () => {
    expect(mergeDeviceTrackWindows(undefined, undefined)).toBeUndefined()
  })

  it('keeps history while the tail is still loading', () => {
    expect(mergeDeviceTrackWindows([history], undefined)).toEqual([history])
  })

  it('does not flash an empty timeline while history is still in flight', () => {
    expect(mergeDeviceTrackWindows(undefined, [])).toBeUndefined()
    expect(mergeDeviceTrackWindows(undefined, [tailOnly])).toEqual([tailOnly])
  })

  it('lets the tail replace a history row of the same id', () => {
    const merged = mergeDeviceTrackWindows([history], [tailUpdate, tailOnly])
    expect(merged).toBeDefined()
    expect(merged).toHaveLength(2)
    expect(merged?.find((e) => e.id === 'a')?.endTimestamp).toBe(3_000)
    expect(merged?.some((e) => e.id === 'b')).toBe(true)
  })
})
