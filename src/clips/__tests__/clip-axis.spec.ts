import { describe, it, expect } from 'vitest'

import {
  buildClipAxis,
  clipAxisEpochToOffset,
  clipAxisOffsetToEpoch,
  clipAxisTicks,
  EMPTY_CLIP_AXIS,
} from '../clip-axis.js'
import type { Clip } from '../clip-model.js'

const T0 = 1_700_000_000_000
const SIZE = 90
const GAP = 24
const MIN_GAP_MS = 2_000

const OPTS = { topMs: T0, sizePx: SIZE, gapPx: GAP, minGapMs: MIN_GAP_MS }

function clip(id: string, startMs: number, endMs: number, thumbnailUrl?: string): Clip {
  return {
    clipId: id,
    deviceId: 101,
    startMs,
    endMs,
    sourceId: 'analytics',
    kind: 'motion',
    playback: { kind: 'recorded', deviceId: 101 },
    ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
  }
}

describe('buildClipAxis', () => {
  it('is empty for no clips', () => {
    expect(buildClipAxis([], OPTS)).toEqual(EMPTY_CLIP_AXIS)
  })

  it('puts the newest clip at the top as a FIXED card, not a duration-scaled bar', () => {
    const axis = buildClipAxis([clip('a', T0 - 10_000, T0)], OPTS)
    const cards = axis.slots.filter((s) => s.kind === 'clip')
    expect(cards).toHaveLength(1)
    expect(cards[0]?.topPx).toBe(0)
    expect(cards[0]?.heightPx).toBe(SIZE)
    expect(axis.contentSpanPx).toBe(SIZE)
  })

  it('orders newest-first — later footage sits above older footage', () => {
    const axis = buildClipAxis(
      [clip('old', T0 - 3_600_000, T0 - 3_590_000), clip('new', T0 - 10_000, T0)],
      OPTS,
    )
    const cards = axis.slots.filter((s) => s.kind === 'clip')
    expect(cards.map((c) => c.clip.clipId)).toEqual(['new', 'old'])
    expect(cards[0]!.topPx).toBeLessThan(cards[1]!.topPx)
  })

  it('collapses a multi-hour hole to gapPx with an ellipsis slot — never hour-pixels', () => {
    const holeMs = 2 * 3_600_000
    const newer = clip('new', T0 - 10_000, T0)
    const older = clip('old', T0 - holeMs - 20_000, T0 - holeMs - 10_000)
    const axis = buildClipAxis([newer, older], OPTS)
    const gaps = axis.slots.filter((s) => s.kind === 'gap')
    expect(gaps).toHaveLength(1)
    expect(gaps[0]?.heightPx).toBe(GAP)
    expect(gaps[0]?.durationMs).toBe(holeMs)
    expect(axis.collapsedMs).toBe(holeMs)
    expect(axis.contentSpanPx).toBe(SIZE + GAP + SIZE)
  })

  it('does NOT merge three consecutive clips — visit grain is the provider’s job', () => {
    // Dispensa 14:xx grain before visit clustering: three heartbeats ~8s apart.
    const a = clip('a', T0 - 40_000, T0 - 28_000)
    const b = clip('b', T0 - 20_000, T0 - 12_000)
    const c = clip('c', T0 - 8_000, T0)
    const axis = buildClipAxis([a, b, c], OPTS)
    expect(axis.slots.filter((s) => s.kind === 'clip')).toHaveLength(3)
  })

  it('never lets two cards overlap', () => {
    const axis = buildClipAxis(
      [clip('a', T0 - 8_000, T0), clip('b', T0 - 16_000, T0 - 8_000)],
      OPTS,
    )
    const cards = axis.slots.filter((s) => s.kind === 'clip')
    expect(cards[1]!.topPx).toBeGreaterThanOrEqual(cards[0]!.topPx + cards[0]!.heightPx)
  })

  it('collapses the live-edge hole above the newest clip', () => {
    const axis = buildClipAxis([clip('a', T0 - 3_600_000 - 10_000, T0 - 3_600_000)], OPTS)
    expect(axis.slots[0]?.kind).toBe('gap')
    expect(axis.slots[0]?.heightPx).toBe(GAP)
    const card = axis.slots.find((s) => s.kind === 'clip')
    expect(card?.topPx).toBe(GAP)
  })
})

describe('clip-axis epoch ↔ offset', () => {
  const newer = clip('new', T0 - 10_000, T0)
  const older = clip('old', T0 - 2 * 3_600_000 - 20_000, T0 - 2 * 3_600_000 - 10_000)
  const axis = buildClipAxis([newer, older], OPTS)

  it('maps a clip’s newest edge to the card top and its start to the card bottom', () => {
    const card = axis.slots.find((s) => s.kind === 'clip' && s.clip.clipId === 'new')!
    expect(clipAxisEpochToOffset(axis, newer.endMs)).toBe(card.topPx)
    expect(clipAxisEpochToOffset(axis, newer.startMs)).toBe(card.topPx + card.heightPx)
  })

  it('interpolates inside a clip', () => {
    const card = axis.slots.find((s) => s.kind === 'clip' && s.clip.clipId === 'new')!
    const mid = T0 - 5_000
    const offset = clipAxisEpochToOffset(axis, mid)
    expect(offset).toBe(card.topPx + SIZE / 2)
    expect(clipAxisOffsetToEpoch(axis, OPTS.topMs, offset)).toBe(mid)
  })

  it('maps a collapsed hole to the gap, not to hour-pixels of empty time', () => {
    const holeEpoch = T0 - 3_600_000
    const offset = clipAxisEpochToOffset(axis, holeEpoch)
    const gap = axis.slots.find((s) => s.kind === 'gap')!
    expect(offset).toBeGreaterThanOrEqual(gap.topPx)
    expect(offset).toBeLessThanOrEqual(gap.topPx + gap.heightPx)
  })

  it('clamps the live edge to offset 0', () => {
    expect(clipAxisEpochToOffset(axis, T0 + 60_000)).toBe(0)
    expect(clipAxisOffsetToEpoch(axis, OPTS.topMs, 0)).toBe(T0)
  })

  it('is empty-safe', () => {
    expect(clipAxisEpochToOffset(EMPTY_CLIP_AXIS, T0)).toBe(0)
    expect(clipAxisOffsetToEpoch(EMPTY_CLIP_AXIS, T0, 40)).toBe(T0)
  })
})

describe('clipAxisTicks', () => {
  const TICK_OPTS = { targetSpacingPx: 30 }

  it('is empty for an empty axis', () => {
    expect(clipAxisTicks(EMPTY_CLIP_AXIS, TICK_OPTS)).toEqual([])
  })

  it('places every tick within its own clip — never on a gap', () => {
    // Two 20-minute clips, hours apart — a big collapsed gap between them.
    const newer = clip('new', T0 - 20 * 60_000, T0)
    const older = clip('old', T0 - 4 * 3_600_000 - 20 * 60_000, T0 - 4 * 3_600_000)
    const axis = buildClipAxis([newer, older], OPTS)
    const gap = axis.slots.find((s) => s.kind === 'gap')!
    expect(gap.kind).toBe('gap')

    const ticks = clipAxisTicks(axis, TICK_OPTS)
    expect(ticks.length).toBeGreaterThan(0)
    for (const t of ticks) {
      // Inclusive of the edges: every clip gets a BOUNDARY tick at its newest
      // instant, which is a moment that exists on the axis (unlike an
      // interpolated interior one) and is what makes the gutter scannable.
      const inNewer = t >= newer.startMs && t <= newer.endMs
      const inOlder = t >= older.startMs && t <= older.endMs
      expect(inNewer || inOlder).toBe(true)
      // Never inside the collapsed hole between the two clips.
      expect(t <= older.endMs || t >= newer.startMs).toBe(true)
    }
  })

  it('still marks a clip too short to subdivide — one boundary tick, not none', () => {
    // 5 seconds: far under the one-minute floor two HH:MM labels would need to
    // differ, so it gets NO interior divisions. It must still get its boundary.
    //
    // This pins the v1.0.396 regression exactly. The first version emitted only
    // interior ticks, and real clips on this fleet last SECONDS — so every clip
    // took the early `continue` and the operator saw no ruler at all. The rule
    // was defensible and produced nothing on real data.
    const tiny = clip('tiny', T0 - 5_000, T0)
    const axis = buildClipAxis([tiny], OPTS)
    expect(clipAxisTicks(axis, TICK_OPTS)).toEqual([tiny.endMs])
  })

  it('spaces ticks evenly across the clip’s own time scale (bigger spacing → fewer ticks)', () => {
    const long = clip('long', T0 - 20 * 60_000, T0)
    const axis = buildClipAxis([long], OPTS)

    const dense = clipAxisTicks(axis, { targetSpacingPx: 10 })
    const sparse = clipAxisTicks(axis, { targetSpacingPx: 60 })
    expect(dense.length).toBeGreaterThan(sparse.length)

    for (const t of dense) {
      expect(t).toBeGreaterThan(long.startMs)
      expect(t).toBeLessThanOrEqual(long.endMs)
    }
  })

  it('gives a too-short clip its boundary only, even alongside a long clip', () => {
    const long = clip('long', T0 - 4 * 3_600_000 - 30 * 60_000, T0 - 4 * 3_600_000)
    const tiny = clip('tiny', T0 - 2_000, T0)
    const axis = buildClipAxis([tiny, long], OPTS)
    const ticks = clipAxisTicks(axis, TICK_OPTS)
    // The tiny clip gets its boundary and NOTHING between: no interior tick can
    // land strictly inside it.
    for (const t of ticks) {
      expect(t > tiny.startMs && t < tiny.endMs).toBe(false)
    }
    expect(ticks).toContain(tiny.endMs)
    expect(ticks.some((t) => t > long.startMs && t < long.endMs)).toBe(true)
  })
})
