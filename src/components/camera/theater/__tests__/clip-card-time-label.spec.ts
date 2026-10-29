/**
 * The card's time IS the tap.
 *
 * Reported by the operator on camera 1438 (2026-08-20): "l'orario mostrato
 * sull'evento delle 10:39 non coincide col tap". It is not a data fault — it
 * is two different questions answered by two different ends of the same
 * cluster:
 *
 *   - the LABEL was `activeEvent.timestamp`, and in clips mode paging is off,
 *     so `activeEvent` is `cluster.anchorEvent` — `carouselEvents[0]`, the
 *     NEWEST subject in the cluster;
 *   - the TAP is `clip.startMs` — `clusterSpanMs()`'s OLDEST subject, clamped
 *     to the footage under it.
 *
 * Every cluster holding more than one subject therefore diverges, and it
 * diverges in BOTH directions: a cluster whose oldest subject has no footage
 * gets clamped FORWARD and the tap lands after its label.
 *
 * `ClusterCard`'s own header already stated the rule this restores — "a paged
 * page would advertise a subject (and a time) the tap does not honour" — and
 * the fix that followed it turned paging off and left the time alone.
 *
 * The fixture is the real thing: camera 1438's tracks and its recorded `low`
 * segment index for 10:35–10:41 on 2026-08-20, read off the hub.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clusterByZoom, type ObjectEvent } from '../event-cluster.js'
import { ZOOM_LEVELS } from '../mock-data.js'
import {
  cardIdForClip,
  clipEndByCardId,
  clipForCardId,
  clipStartByCardId,
  deriveClipsFromClusters,
  type FootageRange,
} from '../clips-from-clusters.js'
import {
  clusterCardAccessibilityLabel,
  clusterCardEndLabel,
  clusterCardTimeLabel,
} from '../ClusterCard.js'

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

/** Camera 1438 person tracks, 2026-08-20 10:35–10:40 (pipelineAnalytics.listTracks). */
const TRACKS_1438: readonly (readonly [string, number, number])[] = [
  ['t-1035', 1787214919838, 1787215047803],
  ['t-1037a', 1787215025510, 1787215033107],
  ['t-1037b', 1787215033999, 1787215073310],
  ['t-1039a', 1787215141520, 1787215146638],
  ['t-1039b', 1787215197478, 1787215201712],
]

/** Camera 1438 recorded `low` segments over the same window (start, duration). */
const SEGMENTS_1438: readonly (readonly [number, number])[] = [
  [1787215009000, 10000], [1787215069000, 10000], [1787215089000, 10000],
  [1787215099000, 10000], [1787215109000, 10000], [1787215119000, 10000],
  [1787215130000, 4160], [1787215137000, 9000], [1787215146000, 10000],
  [1787215157000, 9000], [1787215166000, 10000], [1787215176000, 1520],
  [1787215191000, 10000], [1787215211000, 10000], [1787215221000, 10000],
  [1787215231000, 10000], [1787215241000, 10000], [1787215251000, 8720],
]

const events: readonly ObjectEvent[] = TRACKS_1438.map(([id, timestamp, endTimestamp]) => ({
  id,
  deviceId: 1438,
  timestamp,
  endTimestamp,
  className: 'person',
}))
const recording: readonly FootageRange[] = SEGMENTS_1438.map(([s, d]) => ({
  startMs: s,
  endMs: s + d,
}))

/** The finest scale the ladder offers — where this fixture's 10:39 subjects
 *  land in one card and the divergence is visible. Named rather than written
 *  as a literal: the ladder gained a level when the stepper pair became the
 *  range selector, and a hardcoded `3` silently became "second finest". */
const FINEST_ZOOM_INDEX = ZOOM_LEVELS.length - 1

/** Every zoom the ladder offers. */
const ALL_ZOOM_INDICES: readonly number[] = ZOOM_LEVELS.map((_, index) => index)

function derivedFor(zoomIndex: number) {
  const clusters = clusterByZoom(events, {
    topMs: 1787215300000,
    zoomIndex,
    sizePx: 96,
    gapPx: 8,
  })
  return { clusters, derived: deriveClipsFromClusters({ clusters, recording, deviceId: 1438 }) }
}

describe('the 10:39 card on camera 1438', () => {
  it('labels the card with the moment the tap plays, not the newest subject', () => {
    const { clusters, derived } = derivedFor(FINEST_ZOOM_INDEX)
    const starts = clipStartByCardId(derived)

    // The card the operator tapped: the one holding the 10:39 subjects. Its
    // anchor (the label, before this fix) is the NEWEST of them, 10:39:57.478.
    const card = clusters.find((c) => c.events.some((e) => e.id === 't-1039a'))
    expect(card).toBeDefined()
    expect(card!.anchorEvent.timestamp).toBe(1787215197478)

    // Its clip STARTS 128.5 s earlier, at the first footage under the cluster.
    const clipStartMs = starts.get(card!.id)
    expect(clipStartMs).toBe(1787215069000)

    // So the label LEADS with the clip's start — where the tap goes — and the
    // subject it was named after follows it, never the other way round.
    const label = clusterCardTimeLabel(card!.anchorEvent.timestamp, clipStartMs)
    expect(label.startsWith(clusterCardTimeLabel(1787215069000, undefined))).toBe(true)
    expect(label).not.toBe(clusterCardTimeLabel(1787215197478, undefined))
  })

  it('the 10:35 card diverges too — its clip starts before the label', () => {
    const { clusters, derived } = derivedFor(FINEST_ZOOM_INDEX)
    const starts = clipStartByCardId(derived)
    // The 10:35 track is a card of its own (the 10:37:05 subject sits in the gap
    // under the NEWER card, so it is drawn at its own time). The footage under
    // it starts before the label, at 10:36:49 — the tap and the label disagree.
    const card = clusters.find((c) => c.events.some((e) => e.id === 't-1035'))
    expect(card!.anchorEvent.timestamp).toBe(1787214919838)
    expect(starts.get(card!.id)).toBe(1787215009000)
  })

  it('every card the tap can reach has a start, and it is the one the tap uses', () => {
    for (const zoomIndex of ALL_ZOOM_INDICES) {
      const { derived } = derivedFor(zoomIndex)
      const starts = clipStartByCardId(derived)
      expect(starts.size).toBe(derived.length)
      for (const entry of derived) {
        const cardId = cardIdForClip(entry)
        expect(starts.get(cardId)).toBe(clipForCardId(derived, cardId)!.startMs)
      }
    }
  })

  it('every card also has an end, and it is the SAME clip the start came from', () => {
    // Task 3.3: the card shows where the clip stops, not just where it starts.
    // Reading the end off a different clip than the start (e.g. the cluster's
    // own unclamped `endMs` instead of the derived clip's) would label one
    // card with two different windows.
    for (const zoomIndex of ALL_ZOOM_INDICES) {
      const { derived } = derivedFor(zoomIndex)
      const starts = clipStartByCardId(derived)
      const ends = clipEndByCardId(derived)
      expect(ends.size).toBe(derived.length)
      for (const entry of derived) {
        const cardId = cardIdForClip(entry)
        const clip = clipForCardId(derived, cardId)!
        expect(starts.get(cardId)).toBe(clip.startMs)
        expect(ends.get(cardId)).toBe(clip.endMs)
        expect(ends.get(cardId)).toBeGreaterThan(starts.get(cardId)!)
      }
    }
  })
})

describe('clusterCardTimeLabel', () => {
  it('is the event time when no clip start is supplied (normal mode seeks the event)', () => {
    expect(clusterCardTimeLabel(1787215197478, undefined)).toBe(
      new Date(1787215197478).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    )
  })

  it('keeps ONE time when the clip starts in the same minute as the subject', () => {
    // 10:39:06 and 10:39:57 both render "10:39" — a second copy of the same
    // string is noise on a 9pt row.
    expect(clusterCardTimeLabel(1787215197478, 1787215146000)).toBe(
      clusterCardTimeLabel(1787215146000, undefined),
    )
  })

  it('appends the subject time when it falls in a different minute', () => {
    const label = clusterCardTimeLabel(1787215197478, 1787215069000)
    // Leftmost is where the tap goes; the subject follows it.
    expect(label.startsWith(clusterCardTimeLabel(1787215069000, undefined))).toBe(true)
    expect(label).toContain(clusterCardTimeLabel(1787215197478, undefined))
    expect(label).toContain('·')
  })
})

describe('wiring: the clip start reaches the card', () => {
  it('the card derives its time label through the shared helper', () => {
    const src = read('components/camera/theater/ClusterCard.tsx')
    // The call now carries a third argument (now + locale, for the day prefix
    // on a card from another day), so this matches the PREFIX. The claim is
    // unchanged: the label comes from the shared helper, never inline.
    expect(src).toContain('clusterCardTimeLabel(activeEvent.timestamp, clipStartMs,')
    // The old rule — the label was the active page, full stop.
    expect(src).not.toContain('const timeLabel = formatHHMM(activeEvent.timestamp)')
  })

  it('the scroller carries the clips-mode start map down to every slot', () => {
    const src = read('components/camera/theater/TimelineScroller.tsx')
    expect(src).toContain('clipStartMs={clipStartByCardId?.get(cluster.id)}')
  })

  it('the theater builds the map from the SAME derived list the tap reads', () => {
    const src = read('components/camera/theater/TheaterTimeline.tsx')
    expect(src).toContain('clipStartByCardId(derivedClips)')
  })
})

describe('clusterCardEndLabel', () => {
  it('is empty in normal mode — no clip to bound', () => {
    expect(clusterCardEndLabel(undefined)).toBe('')
  })

  it('appends the end time after a separator', () => {
    const label = clusterCardEndLabel(1787215197478)
    expect(label.startsWith(' ')).toBe(true)
    expect(label).toContain('–')
    expect(label).toContain(clusterCardTimeLabel(1787215197478, undefined))
  })
})

describe('clusterCardAccessibilityLabel', () => {
  const t = (key: string, options?: Record<string, unknown>): string =>
    `${key}:${JSON.stringify(options)}`

  it('is undefined in normal mode — nothing to disambiguate', () => {
    expect(clusterCardAccessibilityLabel(1787215197478, undefined, undefined, t)).toBeUndefined()
  })

  it('is undefined when the clip start matches the subject and there is no end', () => {
    // Same minute, no end supplied: the visible "10:39" is already the whole
    // truth, so RN should read it as-is rather than repeat it.
    expect(clusterCardAccessibilityLabel(1787215146050, 1787215146000, undefined, t)).toBeUndefined()
  })

  it('spells out start+subject when they diverge, even with no end', () => {
    const label = clusterCardAccessibilityLabel(1787215197478, 1787215069000, undefined, t)
    expect(label).toContain('v2.theater.clipStartsAtSubjectAt')
    expect(label).not.toContain('v2.theater.clipEndsAt')
  })

  it('spells out the end even when start and subject match', () => {
    const label = clusterCardAccessibilityLabel(1787215146050, 1787215146000, 1787215201712, t)
    expect(label).not.toContain('v2.theater.clipStartsAtSubjectAt')
    expect(label).toContain('v2.theater.clipEndsAt')
  })

  it('spells out BOTH when start, subject and end all diverge', () => {
    const label = clusterCardAccessibilityLabel(1787215197478, 1787215069000, 1787215201712, t)
    expect(label).toContain('v2.theater.clipStartsAtSubjectAt')
    expect(label).toContain('v2.theater.clipEndsAt')
  })
})

describe('wiring: the clip end reaches the card', () => {
  it('the card appends the end label after the shared time label', () => {
    const src = read('components/camera/theater/ClusterCard.tsx')
    // Both halves, in order, across the line break the third argument forced.
    const at = src.indexOf('clusterCardTimeLabel(activeEvent.timestamp, clipStartMs,')
    expect(at).toBeGreaterThan(-1)
    expect(src.slice(at, at + 260)).toContain('clusterCardEndLabel(clipEndMs, clipStartMs)')
    // The label can now be three segments long on a clips-mode card — it must
    // stay one line rather than wrap into the pills row under it.
    expect(src).toContain('numberOfLines={1}')
  })

  it('the scroller carries the clips-mode end map down to every slot', () => {
    const src = read('components/camera/theater/TimelineScroller.tsx')
    expect(src).toContain('clipEndMs={clipEndByCardId?.get(cluster.id)}')
  })

  it('the theater builds the end map from the SAME derived list the start map uses', () => {
    const src = read('components/camera/theater/TheaterTimeline.tsx')
    expect(src).toContain('clipEndByCardId(derivedClips)')
  })
})

describe('a sub-minute clip says its DURATION, not the same time twice', () => {
  // v1.0.396 shipped `05:57 – 05:57` on the operator's own camera and they
  // reported the times as broken. They were not: real clips here last seconds,
  // and two HH:MM labels a few seconds apart are the same string. A repeated
  // clock reading is noise; the duration answers the question the end time was
  // standing in for.
  const START = new Date('2026-08-24T05:57:12').getTime()

  it('collapses to a seconds duration when start and end share a minute', () => {
    expect(clusterCardEndLabel(START + 31_000, START)).toBe(' · 31s')
  })

  it('still shows the end time when the clip crosses into another minute', () => {
    const label = clusterCardEndLabel(START + 3 * 60_000, START)
    expect(label.startsWith(' – ')).toBe(true)
    expect(label).not.toContain('s')
  })

  it('says nothing rather than a wrong duration when it has no start to measure from', () => {
    expect(clusterCardEndLabel(START + 31_000, undefined)).toContain('–')
    expect(clusterCardEndLabel(undefined, START)).toBe('')
  })
})
