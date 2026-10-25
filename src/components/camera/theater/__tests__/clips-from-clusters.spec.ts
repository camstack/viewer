import { describe, it, expect } from 'vitest'

import {
  clusterFootageVisits,
  clusterSpanMs,
  deriveClipsFromClusters,
  positionDerivedClips,
  stillInstantMs,
  MIN_CLIP_WINDOW_MS,
  VISIT_MERGE_GAP_MS,
  clipForCardId,
  type DerivedClip,
  type FootageRange,
} from '../clips-from-clusters.js'
import { clusterByZoom, type ObjectEvent, type PositionedCluster } from '../event-cluster.js'
import { buildClipAxis } from '../../../../clips/clip-axis.js'
import { stillMediaPath } from '../../../../data/still-media-url.js'

const T0 = 1_700_000_000_000
const DEVICE = 101
const SIZE = 90
const GAP = 24
const ZOOM = 2

function event(
  id: string,
  startMs: number,
  endMs: number,
  className = 'person',
  extra: Partial<ObjectEvent> = {},
): ObjectEvent {
  return {
    id,
    deviceId: DEVICE,
    timestamp: startMs,
    endTimestamp: endMs,
    className,
    trackId: id,
    ...extra,
  }
}

/** Clusters exactly as the NORMAL timeline builds them — same function, same args. */
function clustersOf(events: readonly ObjectEvent[]): readonly PositionedCluster[] {
  return clusterByZoom(events, { topMs: T0, zoomIndex: ZOOM, sizePx: SIZE, gapPx: GAP })
}

function range(startMs: number, endMs: number): FootageRange {
  return { startMs, endMs }
}

// ─── clusterFootageVisits ─────────────────────────────────────────────

describe('clusterFootageVisits', () => {
  it('glues recorder rolls separated by less than the merge gap, recording the holes', () => {
    const visits = clusterFootageVisits([
      range(T0 - 60_000, T0 - 50_000),
      range(T0 - 42_000, T0 - 30_000),
    ])
    expect(visits).toHaveLength(1)
    expect(visits[0]!.startMs).toBe(T0 - 60_000)
    expect(visits[0]!.endMs).toBe(T0 - 30_000)
    expect(visits[0]!.holes).toEqual([{ startMs: T0 - 50_000, endMs: T0 - 42_000 }])
  })

  it('splits when the hole is longer than the merge gap', () => {
    const visits = clusterFootageVisits([
      range(T0 - 600_000, T0 - 104_000),
      range(T0 - 60_000, T0 - 30_000),
    ])
    expect(visits).toHaveLength(2)
    expect(visits.every((v) => v.holes.length === 0)).toBe(true)
  })

  it('is unordered-input safe and never returns an inverted visit', () => {
    const visits = clusterFootageVisits([range(T0 - 30_000, T0), range(T0 - 120_000, T0 - 90_000)])
    expect(visits.map((v) => v.startMs)).toEqual([T0 - 120_000, T0 - 30_000])
    expect(visits.every((v) => v.endMs > v.startMs)).toBe(true)
  })

  it('uses the same 30s grain the hub visit clusterer uses', () => {
    expect(VISIT_MERGE_GAP_MS).toBe(30_000)
  })
})

// ─── stillInstantMs ───────────────────────────────────────────────────

describe('stillInstantMs', () => {
  it('is the midpoint of the LONGEST range, not the midpoint of the visit', () => {
    // A visit spans its holes by construction, so the naive midpoint lands in
    // dead air — the hub learned this when its still route answered 204 for a
    // visit with plenty of footage.
    const ranges = [range(T0, T0 + 2_000), range(T0 + 40_000, T0 + 60_000)]
    expect(stillInstantMs(ranges)).toBe(T0 + 50_000)
  })

  it('is undefined with nothing to decode', () => {
    expect(stillInstantMs([])).toBeUndefined()
  })
})

// ─── clusterSpanMs ────────────────────────────────────────────────────

describe('clusterSpanMs', () => {
  it("spans the subject's whole life, not just its first frames", () => {
    const [cluster] = clustersOf([event('a', T0 - 60_000, T0 - 10_000)])
    expect(clusterSpanMs(cluster!)).toEqual({ startMs: T0 - 60_000, endMs: T0 - 10_000 })
  })
})

// ─── deriveClipsFromClusters ──────────────────────────────────────────

describe('deriveClipsFromClusters', () => {
  it('turns a cluster that INTERSECTS footage into one clip, clamped to the footage', () => {
    const clusters = clustersOf([event('a', T0 - 120_000, T0 - 60_000)])
    const derived = deriveClipsFromClusters({
      clusters,
      // Footage starts after the subject appeared and ends before it left.
      recording: [range(T0 - 100_000, T0 - 80_000)],
      deviceId: DEVICE,
    })
    expect(derived).toHaveLength(1)
    expect(derived[0]!.clip.startMs).toBe(T0 - 100_000)
    expect(derived[0]!.clip.endMs).toBe(T0 - 80_000)
    expect(derived[0]!.cluster).toBe(clusters[0])
  })

  it('EXCLUDES a cluster with no footage under it — the clips list is what can be rewatched', () => {
    const clusters = clustersOf([event('a', T0 - 120_000, T0 - 60_000)])
    const derived = deriveClipsFromClusters({
      clusters,
      recording: [range(T0 - 3_600_000, T0 - 3_000_000)],
      deviceId: DEVICE,
    })
    // The distant footage still shows up (it is rewatchable), but NOTHING was
    // derived from the cluster — no card claims footage it does not have.
    expect(derived.map((d) => d.cluster)).toEqual([null])
  })

  it('carries the cluster CLASSES onto the clip — label parity is free', () => {
    const clusters = clustersOf([
      event('a', T0 - 120_000, T0 - 100_000, 'animal'),
      event('b', T0 - 119_000, T0 - 100_000, 'person'),
    ])
    expect(clusters).toHaveLength(1)
    const [derived] = deriveClipsFromClusters({
      clusters,
      recording: [range(T0 - 200_000, T0 - 50_000)],
      deviceId: DEVICE,
    })
    expect(derived!.clip.labels).toEqual(clusters[0]!.classes)
    expect(derived!.clip.kind).toBe('object')
  })

  it('reports the availability gaps INSIDE the window as holes', () => {
    const clusters = clustersOf([event('a', T0 - 120_000, T0 - 60_000)])
    const [derived] = deriveClipsFromClusters({
      clusters,
      recording: [range(T0 - 130_000, T0 - 100_000), range(T0 - 90_000, T0 - 50_000)],
      deviceId: DEVICE,
    })
    expect(derived!.clip.holes).toEqual([{ startMs: T0 - 100_000, endMs: T0 - 90_000 }])
  })

  it('gives a point-in-time subject a playable window instead of a zero-length one', () => {
    const clusters = clustersOf([
      { id: 'p', deviceId: DEVICE, timestamp: T0 - 60_000, className: 'person' },
    ])
    const [derived] = deriveClipsFromClusters({
      clusters,
      recording: [range(T0 - 120_000, T0 - 10_000)],
      deviceId: DEVICE,
    })
    expect(derived!.clip.endMs - derived!.clip.startMs).toBe(MIN_CLIP_WINDOW_MS)
    expect(derived!.clip.startMs).toBeGreaterThanOrEqual(T0 - 120_000)
    expect(derived!.clip.endMs).toBeLessThanOrEqual(T0 - 10_000)
  })

  it('never widens a window past the footage that carries it', () => {
    const clusters = clustersOf([
      { id: 'p', deviceId: DEVICE, timestamp: T0 - 60_000, className: 'person' },
    ])
    const [derived] = deriveClipsFromClusters({
      clusters,
      // One roll, shorter than the minimum window.
      recording: [range(T0 - 61_000, T0 - 59_000)],
      deviceId: DEVICE,
    })
    expect(derived!.clip.startMs).toBe(T0 - 61_000)
    expect(derived!.clip.endMs).toBe(T0 - 59_000)
  })

  it('plays from the RECORDED transport, never a file of its own', () => {
    const clusters = clustersOf([event('a', T0 - 120_000, T0 - 60_000)])
    const [derived] = deriveClipsFromClusters({
      clusters,
      recording: [range(T0 - 200_000, T0 - 50_000)],
      deviceId: DEVICE,
    })
    expect(derived!.clip.playback).toEqual({ kind: 'recorded', deviceId: DEVICE })
    expect(derived!.clip.sourceId).toBe('analytics')
  })

  it('keeps the cluster thumbnail and a media recovery id', () => {
    const clusters = clustersOf([
      event('a', T0 - 120_000, T0 - 60_000, 'person', { mediaUrl: '/t/a' }),
    ])
    const [derived] = deriveClipsFromClusters({
      clusters,
      recording: [range(T0 - 200_000, T0 - 50_000)],
      deviceId: DEVICE,
    })
    expect(derived!.clip.thumbnailUrl).toBe('/t/a')
    expect(derived!.clip.eventIds).toContain('a')
  })
})

// ─── footage-only visits ──────────────────────────────────────────────

describe('footage-only visits stay visible', () => {
  it('emits a kind-motion card with no classes for footage no cluster claims', () => {
    const derived = deriveClipsFromClusters({
      clusters: [],
      recording: [range(T0 - 60_000, T0 - 30_000)],
      deviceId: DEVICE,
    })
    expect(derived).toHaveLength(1)
    expect(derived[0]!.cluster).toBeNull()
    expect(derived[0]!.clip.kind).toBe('motion')
    expect(derived[0]!.clip.labels).toBeUndefined()
    expect(derived[0]!.clip.startMs).toBe(T0 - 60_000)
    expect(derived[0]!.clip.endMs).toBe(T0 - 30_000)
    expect(derived[0]!.stillAtMs).toBe(T0 - 45_000)
  })

  it('does NOT duplicate a visit a cluster already claimed', () => {
    const clusters = clustersOf([event('a', T0 - 55_000, T0 - 40_000)])
    const derived = deriveClipsFromClusters({
      clusters,
      recording: [range(T0 - 60_000, T0 - 30_000)],
      deviceId: DEVICE,
    })
    expect(derived).toHaveLength(1)
    expect(derived[0]!.cluster).toBe(clusters[0])
  })

  it('mixes claimed and unclaimed footage in one newest-first list', () => {
    const clusters = clustersOf([event('a', T0 - 55_000, T0 - 40_000)])
    const derived = deriveClipsFromClusters({
      clusters,
      recording: [range(T0 - 60_000, T0 - 30_000), range(T0 - 600_000, T0 - 570_000)],
      deviceId: DEVICE,
    })
    expect(derived).toHaveLength(2)
    expect(derived.map((d) => d.cluster !== null)).toEqual([true, false])
  })
})

// ─── positionDerivedClips ─────────────────────────────────────────────

describe('positionDerivedClips', () => {
  it('is the NORMAL cluster card, moved onto the compressed axis', () => {
    const clusters = clustersOf([
      event('a', T0 - 120_000, T0 - 60_000, 'animal', { mediaUrl: '/t/a' }),
    ])
    const derived = deriveClipsFromClusters({
      clusters,
      recording: [range(T0 - 200_000, T0 - 50_000)],
      deviceId: DEVICE,
    })
    const axis = buildClipAxis(
      derived.map((d) => d.clip),
      { topMs: T0, sizePx: SIZE, gapPx: GAP, minGapMs: 2_000 },
    )
    const cards = positionDerivedClips(axis, derived)

    expect(cards).toHaveLength(1)
    const card = cards[0]!
    const source = clusters[0]!
    // Everything semantic is the SAME OBJECT the normal timeline drew.
    expect(card.id).toBe(source.id)
    expect(card.classes).toBe(source.classes)
    expect(card.carouselEvents).toBe(source.carouselEvents)
    expect(card.representative).toBe(source.representative)
    expect(card.anchorEvent).toBe(source.anchorEvent)
    // Only the geometry comes from the axis.
    expect(card.heightPx).toBe(SIZE)
    expect(card.topPx).toBe(axis.slots.find((s) => s.kind === 'clip')!.topPx)
  })

  it('one clip in, one card out — adjacent visits are never absorbed', () => {
    const clusters = clustersOf([
      event('a', T0 - 3_600_000, T0 - 3_595_000),
      event('b', T0 - 120_000, T0 - 115_000),
    ])
    expect(clusters).toHaveLength(2)
    const derived = deriveClipsFromClusters({
      clusters,
      recording: [range(T0 - 3_700_000, T0 - 50_000)],
      deviceId: DEVICE,
    })
    const axis = buildClipAxis(
      derived.map((d) => d.clip),
      { topMs: T0, sizePx: SIZE, gapPx: GAP, minGapMs: 2_000 },
    )
    expect(positionDerivedClips(axis, derived)).toHaveLength(2)
  })

  it('draws a footage-only visit as a motion card anchored at its decodable still', () => {
    const derived = deriveClipsFromClusters({
      clusters: [],
      recording: [range(T0 - 60_000, T0 - 30_000)],
      deviceId: DEVICE,
    })
    const axis = buildClipAxis(
      derived.map((d) => d.clip),
      { topMs: T0, sizePx: SIZE, gapPx: GAP, minGapMs: 2_000 },
    )
    const [card] = positionDerivedClips(axis, derived)
    expect(card!.classes).toEqual(['motion'])
    expect(card!.labels).toEqual([])
    expect(card!.carouselEvents).toHaveLength(1)
    expect(card!.anchorEvent.timestamp).toBe(T0 - 45_000)
    expect(card!.anchorEvent.className).toBe('motion')
    expect(card!.heightPx).toBe(SIZE)
  })

  it('ignores an axis slot whose clip is not in the derivation', () => {
    const derived = deriveClipsFromClusters({
      clusters: [],
      recording: [range(T0 - 60_000, T0 - 30_000)],
      deviceId: DEVICE,
    })
    const axis = buildClipAxis(
      derived.map((d) => d.clip),
      { topMs: T0, sizePx: SIZE, gapPx: GAP, minGapMs: 2_000 },
    )
    expect(positionDerivedClips(axis, [])).toEqual([])
  })
})

// ─── the two lists cannot diverge ─────────────────────────────────────

describe('clips mode and the normal timeline show the SAME cards', () => {
  it('every clip card is a normal-mode cluster, by identity', () => {
    const events = [
      event('a', T0 - 3_600_000, T0 - 3_500_000, 'person'),
      event('b', T0 - 1_200_000, T0 - 1_100_000, 'animal'),
      event('c', T0 - 300_000, T0 - 200_000, 'person'),
    ]
    const clusters = clustersOf(events)
    const derived = deriveClipsFromClusters({
      clusters,
      recording: [range(T0 - 4_000_000, T0 - 100_000)],
      deviceId: DEVICE,
    })
    const axis = buildClipAxis(
      derived.map((d) => d.clip),
      { topMs: T0, sizePx: SIZE, gapPx: GAP, minGapMs: 2_000 },
    )
    const cards = positionDerivedClips(axis, derived)

    expect(cards).toHaveLength(clusters.length)
    // Same set of cards, same ids, same labels — no second clusterer, so the
    // two modes cannot drift apart the way listClips + clusterByZoom did.
    expect([...cards].map((c) => c.id).sort()).toEqual([...clusters].map((c) => c.id).sort())
    for (const card of cards) {
      const twin = clusters.find((c) => c.id === card.id)!
      expect(card.classes).toEqual(twin.classes)
      expect(card.events).toBe(twin.events)
    }
  })
})

// ─── card ⇄ clip identity ─────────────────────────────────────────────

describe('the card the operator taps resolves to the clip it draws', () => {
  it('maps a cluster-backed card id to its clip', () => {
    const events = [event('a', T0 - 600_000, T0 - 104_000, 'person')]
    const clusters = clustersOf(events)
    const derived = deriveClipsFromClusters({
      clusters,
      recording: [range(T0 - 700_000, T0 - 500_000)],
      deviceId: DEVICE,
    })
    const cards = positionDerivedClips(
      buildClipAxis(derived.map((d) => d.clip), { topMs: T0, sizePx: SIZE, gapPx: GAP, minGapMs: 2_000 }),
      derived,
    )
    // The card id is the CLUSTER's, the clip id is `cluster:<id>` — the two are
    // not interchangeable, which is exactly why the lookup exists.
    const clip = clipForCardId(derived, cards[0]!.id)
    expect(clip).not.toBeNull()
    expect(clip!.clipId).toBe(`cluster:${cards[0]!.id}`)
  })

  it('maps a footage-only card id to its clip', () => {
    const derived = deriveClipsFromClusters({
      clusters: [],
      recording: [range(T0 - 700_000, T0 - 500_000)],
      deviceId: DEVICE,
    })
    const cards = positionDerivedClips(
      buildClipAxis(derived.map((d) => d.clip), { topMs: T0, sizePx: SIZE, gapPx: GAP, minGapMs: 2_000 }),
      derived,
    )
    expect(clipForCardId(derived, cards[0]!.id)!.clipId).toBe(cards[0]!.id)
  })

  it('returns null for an id no clip draws', () => {
    expect(clipForCardId([], 'nothing')).toBeNull()
  })
})

// ─── footage-only cards show a recorded still ─────────────────────────

describe('a footage-only card is not a blank card', () => {
  it('stamps the recorder still at the decodable instant as its thumbnail', () => {
    const derived = deriveClipsFromClusters({
      clusters: [],
      // Two rolls: the LONGEST one carries the still, never the visit midpoint
      // (which lands in the hole between them).
      recording: [range(T0 - 700_000, T0 - 690_000), range(T0 - 680_000, T0 - 500_000)],
      deviceId: DEVICE,
    })
    const cards = positionDerivedClips(
      buildClipAxis(derived.map((d) => d.clip), { topMs: T0, sizePx: SIZE, gapPx: GAP, minGapMs: 2_000 }),
      derived,
    )
    const still = stillInstantMs([range(T0 - 680_000, T0 - 500_000)])!
    expect(cards[0]!.anchorEvent.mediaUrl).toBe(stillMediaPath(DEVICE, still))
  })

  it('leaves the thumbnail unset when no instant can be decoded', () => {
    // No footage at all → no visit, no card. The guard is that the derivation
    // never invents a still for an instant it could not name.
    expect(deriveClipsFromClusters({ clusters: [], recording: [], deviceId: DEVICE })).toEqual([])
  })
})

// ─── the operator's rule, verbatim ────────────────────────────────────

describe("va bene mostrare un cluster di eventi se una clip li copre tutti, ma il tap sul cluster deve portare all'inizio della clip, SEMPRE", () => {
  it('one clip covering four subjects is ONE card that still carries all four', () => {
    const events = [
      event('p1', T0 - 600_000, T0 - 580_000, 'person'),
      event('p2', T0 - 596_000, T0 - 570_000, 'person'),
      event('c1', T0 - 575_000, T0 - 560_000, 'car'),
      event('a1', T0 - 566_000, T0 - 550_000, 'animal'),
    ]
    const clusters = clustersOf(events)
    const derived = deriveClipsFromClusters({
      clusters,
      recording: [range(T0 - 700_000, T0 - 500_000)],
      deviceId: DEVICE,
    })
    const cards = positionDerivedClips(
      buildClipAxis(derived.map((d) => d.clip), { topMs: T0, sizePx: SIZE, gapPx: GAP, minGapMs: 2_000 }),
      derived,
    )
    // The clip covers all four, so the operator sees ONE card — and it is the
    // cluster itself, with every subject still on it. Splitting it into four
    // cards, or dropping three subjects to make it "one clip one subject", are
    // both changes this test refuses.
    expect(cards).toHaveLength(1)
    expect(cards[0]!.events).toHaveLength(4)
  })

  it('the tap target is the CLIP START — the same epoch from every subject on the card', () => {
    const events = [
      event('p1', T0 - 600_000, T0 - 580_000, 'person'),
      event('p2', T0 - 596_000, T0 - 570_000, 'person'),
      event('c1', T0 - 575_000, T0 - 560_000, 'car'),
    ]
    const clusters = clustersOf(events)
    const derived = deriveClipsFromClusters({
      clusters,
      recording: [range(T0 - 700_000, T0 - 500_000)],
      deviceId: DEVICE,
    })
    const cards = positionDerivedClips(
      buildClipAxis(derived.map((d) => d.clip), { topMs: T0, sizePx: SIZE, gapPx: GAP, minGapMs: 2_000 }),
      derived,
    )
    const card = cards[0]!
    const clip = clipForCardId(derived, card.id)!

    // SEMPRE: whichever subject the card happens to be showing, the resolution
    // goes through the CARD, so the answer is one epoch and it is the clip's
    // own start — never the subject's timestamp, which for three subjects
    // would be three different places to land.
    for (const subject of card.events) {
      expect(clipForCardId(derived, card.id)!.startMs).toBe(clip.startMs)
      expect(subject.timestamp).toBeGreaterThanOrEqual(clip.startMs)
    }
    expect(clip.startMs).toBe(Math.min(...card.events.map((e) => e.timestamp)))
  })
})

// ─── the window must not re-fetch what it already showed ──────────────

describe('a card that scrolls out and back asks for the same picture', () => {
  it('the still URL is IDENTICAL for an unchanged visit', () => {
    // The mount window unmounts a card that leaves the band and mounts it again
    // on the way back, so the URL it asks for has to be the same string both
    // times or the image cache is bypassed on every pass. It is derived from
    // the footage, so this holds for as long as the footage does.
    const recording = [range(T0 - 700_000, T0 - 500_000)]
    const first = deriveClipsFromClusters({ clusters: [], recording, deviceId: DEVICE })
    const second = deriveClipsFromClusters({ clusters: [], recording, deviceId: DEVICE })
    const url = (d: readonly DerivedClip[]): string | undefined =>
      positionDerivedClips(
        buildClipAxis(d.map((x) => x.clip), { topMs: T0, sizePx: SIZE, gapPx: GAP, minGapMs: 2_000 }),
        d,
      )[0]!.anchorEvent.mediaUrl
    expect(url(first)).toBe(url(second))
    expect(url(first)).toBeDefined()
  })

  it('and it does not drift with the live edge', () => {
    // `topMs` moves once a second. The still is an instant INSIDE the footage,
    // so it must not move with it — a URL that changed every second would miss
    // the cache on every re-render as well as on every remount.
    const recording = [range(T0 - 700_000, T0 - 500_000)]
    const derived = deriveClipsFromClusters({ clusters: [], recording, deviceId: DEVICE })
    const at = (topMs: number): string | undefined =>
      positionDerivedClips(
        buildClipAxis(derived.map((x) => x.clip), { topMs, sizePx: SIZE, gapPx: GAP, minGapMs: 2_000 }),
        derived,
      )[0]!.anchorEvent.mediaUrl
    expect(at(T0)).toBe(at(T0 + 60_000))
  })
})
