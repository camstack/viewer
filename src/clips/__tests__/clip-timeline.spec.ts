import { describe, it, expect } from 'vitest'

import {
  clipAt,
  decomposeDuration,
  DEFAULT_END_GUARD_MS,
  EMPTY_RIBBON,
  firstClipFrom,
  formatGapLabel,
  normalizeClips,
  pointAtEpoch,
  pointAtPx,
  pxForEpoch,
  resolveClipAdvance,
  DEFAULT_OVERSHOOT_MS,
  scrollOffsetForPx,
  type ClipRibbonLayout,
  type ClipRibbonOptions,
  type RibbonRow,
} from '../clip-timeline.js'
import type { Clip } from '../clip-model.js'

const T0 = 1_700_000_000_000

/** Geometry with round numbers so every assertion below is exact, not "about". */
const OPTS: ClipRibbonOptions = {
  pxPerMs: 1 / 100, // 100ms == 1px  →  10s clip == 100px
  minClipPx: 10,
  maxClipPx: 400,
  gapPx: 30,
  minGapMs: 2_000,
}

function clip(id: string, startMs: number, endMs: number, sourceId = 'analytics'): Clip {
  return {
    clipId: id,
    deviceId: 101,
    startMs,
    endMs,
    sourceId,
    kind: 'motion',
    playback: { kind: 'recorded', deviceId: 101 },
  }
}

/**
 * Builds a {@link ClipRibbonLayout} fixture for the pure-function tests below.
 *
 * Production no longer builds a layout this way: `layoutClipRibbon` was the
 * server-list ribbon's own layout engine and was deleted with it (Task 3.1,
 * `docs/design/plans/fase-3-viewer-timeline-clip.md`) — its only caller was
 * `TimelineClipsPanel.tsx`. `pxForEpoch`, `pointAtPx`, `resolveClipAdvance`,
 * `clipAt` and `firstClipFrom` are still live (compressed-axis geometry and the
 * clips-mode advance sequencer both read a `ClipRibbonLayout`), so their tests
 * still need one to exercise. This mirrors the deleted function's geometry
 * exactly — same rounding, same gap rule — but it is a TEST FIXTURE only, not
 * exercised by any production code path.
 */
function buildLayoutFixture(
  clips: readonly Clip[],
  options: ClipRibbonOptions = OPTS,
): ClipRibbonLayout {
  const ordered = normalizeClips(clips)
  if (ordered.length === 0) return EMPTY_RIBBON

  const rows: RibbonRow[] = []
  let offsetPx = 0
  let collapsedMs = 0
  let coveredToMs = Number.NEGATIVE_INFINITY

  ordered.forEach((c, index) => {
    if (index > 0) {
      const gapMs = c.startMs - coveredToMs
      if (gapMs >= options.minGapMs) {
        rows.push({
          kind: 'gap',
          fromMs: coveredToMs,
          toMs: c.startMs,
          durationMs: gapMs,
          offsetPx,
          heightPx: options.gapPx,
        })
        offsetPx += options.gapPx
        collapsedMs += gapMs
      }
    }
    const durationMs = Math.max(0, c.endMs - c.startMs)
    const heightPx = Math.min(
      options.maxClipPx,
      Math.max(options.minClipPx, Math.round(durationMs * options.pxPerMs)),
    )
    rows.push({ kind: 'clip', clip: c, index, offsetPx, heightPx })
    offsetPx += heightPx
    coveredToMs = Math.max(coveredToMs, c.endMs)
  })

  return { rows, clips: ordered, totalPx: offsetPx, collapsedMs }
}

describe('normalizeClips', () => {
  it('drops clips with a non-positive duration', () => {
    const kept = normalizeClips([clip('a', T0, T0), clip('b', T0, T0 - 1), clip('c', T0, T0 + 1)])
    expect(kept.map((c) => c.clipId)).toEqual(['c'])
  })

  it('orders by start, then end, then id — so a refetch cannot reshuffle', () => {
    const ordered = normalizeClips([
      clip('z', T0 + 5_000, T0 + 6_000),
      clip('b', T0, T0 + 2_000),
      clip('a', T0, T0 + 2_000),
      clip('c', T0, T0 + 1_000),
    ])
    expect(ordered.map((c) => c.clipId)).toEqual(['c', 'a', 'b', 'z'])
  })
})

describe('pointAtEpoch / pxForEpoch', () => {
  const layout = buildLayoutFixture(
    [clip('a', T0, T0 + 10_000), clip('b', T0 + 3_610_000, T0 + 3_620_000)],
    OPTS,
  )

  it('maps an epoch inside a clip proportionally within its segment', () => {
    expect(pxForEpoch(layout, T0 + 5_000)).toBe(50)
    expect(pxForEpoch(layout, T0 + 3_615_000)).toBe(130 + 50)
  })

  it('puts EVERY epoch inside a collapsed gap at the marker centre', () => {
    const early = pxForEpoch(layout, T0 + 11_000)
    const late = pxForEpoch(layout, T0 + 3_600_000)
    expect(early).toBe(100 + 15)
    expect(late).toBe(early)
  })

  it('clamps before the first clip and after the last', () => {
    expect(pxForEpoch(layout, T0 - 60_000)).toBe(0)
    expect(pxForEpoch(layout, T0 + 9_999_999)).toBe(layout.totalPx)
  })

  it('returns null only for an empty ribbon', () => {
    expect(pxForEpoch(EMPTY_RIBBON, T0)).toBeNull()
    expect(pointAtEpoch(EMPTY_RIBBON, T0)).toBeNull()
  })

  it('resolves an instant covered by two clips to the FIRST in ribbon order', () => {
    const overlapping = buildLayoutFixture(
      [clip('a', T0, T0 + 20_000), clip('b', T0 + 5_000, T0 + 25_000, 'native:hik')],
      OPTS,
    )
    const point = pointAtEpoch(overlapping, T0 + 10_000)
    expect(point?.kind).toBe('clip')
    if (point?.kind === 'clip') expect(point.row.clip.clipId).toBe('a')
  })
})

describe('pointAtPx', () => {
  const layout = buildLayoutFixture(
    [clip('a', T0, T0 + 10_000), clip('b', T0 + 3_610_000, T0 + 3_620_000)],
    OPTS,
  )

  it('round-trips an epoch through px and back', () => {
    const px = pxForEpoch(layout, T0 + 7_500)
    expect(px).not.toBeNull()
    const point = pointAtPx(layout, px as number)
    expect(point?.kind).toBe('clip')
    if (point?.kind === 'clip') expect(point.epochMs).toBe(T0 + 7_500)
  })

  it('resolves a point inside a gap to the GAP — never to a seekable time', () => {
    const point = pointAtPx(layout, 115)
    expect(point?.kind).toBe('gap')
  })

  it('clamps out-of-range pixels onto the ribbon', () => {
    expect(pointAtPx(layout, -500)?.kind).toBe('clip')
    expect(pointAtPx(layout, 99_999)?.kind).toBe('clip')
  })

  it('returns null for an empty ribbon', () => {
    expect(pointAtPx(EMPTY_RIBBON, 0)).toBeNull()
  })
})

describe('resolveClipAdvance', () => {
  const layout = buildLayoutFixture(
    [clip('a', T0, T0 + 10_000), clip('b', T0 + 3_610_000, T0 + 3_620_000)],
    OPTS,
  )

  it('holds while the playhead is inside the clip', () => {
    expect(
      resolveClipAdvance({
        layout,
        currentClipId: 'a',
        playheadMs: T0 + 5_000,
        endGuardMs: DEFAULT_END_GUARD_MS,
      }),
    ).toEqual({ kind: 'hold' })
  })

  it('advances to the NEXT clip inside the end guard — this is "no holes"', () => {
    const decision = resolveClipAdvance({
      layout,
      currentClipId: 'a',
      playheadMs: T0 + 9_800,
      endGuardMs: DEFAULT_END_GUARD_MS,
    })
    expect(decision.kind).toBe('advance')
    if (decision.kind === 'advance') {
      expect(decision.clip.clipId).toBe('b')
      expect(decision.index).toBe(1)
    }
  })

  it('does NOT advance early when the guard is zero and the playhead is short of the end', () => {
    expect(
      resolveClipAdvance({ layout, currentClipId: 'a', playheadMs: T0 + 9_800, endGuardMs: 0 }),
    ).toEqual({ kind: 'hold' })
  })

  it('finishes at the last clip', () => {
    expect(
      resolveClipAdvance({
        layout,
        currentClipId: 'b',
        playheadMs: T0 + 3_620_000,
        endGuardMs: DEFAULT_END_GUARD_MS,
      }),
    ).toEqual({ kind: 'finished' })
  })

  it('holds when nothing is playing or the player has not reported yet', () => {
    expect(
      resolveClipAdvance({ layout, currentClipId: null, playheadMs: T0, endGuardMs: 0 }),
    ).toEqual({ kind: 'hold' })
    expect(
      resolveClipAdvance({ layout, currentClipId: 'a', playheadMs: null, endGuardMs: 0 }),
    ).toEqual({ kind: 'hold' })
  })

  it('holds when the playing clip is no longer in the ribbon (source filtered out)', () => {
    expect(
      resolveClipAdvance({ layout, currentClipId: 'gone', playheadMs: T0, endGuardMs: 0 }),
    ).toEqual({ kind: 'hold' })
  })

  // A playhead HOURS past the clip is not "we reached the end" — it is a
  // playhead that belongs to something else. Tapping a clip from live reports
  // LIVE positions until the recorded feeder lands, and the machine ADOPTS the
  // third straggler, so `playheadMs ≈ now`. With only a lower bound that read
  // as "advance", and the ribbon cascaded to its newest clip: the operator
  // tapped one clip and landed on a later one.
  it('holds when the playhead is HOURS past the clip — not "we reached the end"', () => {
    expect(
      resolveClipAdvance({
        layout,
        currentClipId: 'a',
        playheadMs: T0 + 4 * 3_600_000,
        endGuardMs: DEFAULT_END_GUARD_MS,
      }),
    ).toEqual({ kind: 'hold' })
  })

  it('holds on the LAST clip too, rather than declaring the ribbon finished', () => {
    // Same epoch, the other end of the ribbon: `finished` clears the playing
    // clip, so an out-of-range playhead would silently end playback.
    expect(
      resolveClipAdvance({
        layout,
        currentClipId: 'b',
        playheadMs: T0 + 4 * 3_600_000,
        endGuardMs: DEFAULT_END_GUARD_MS,
      }),
    ).toEqual({ kind: 'hold' })
  })

  it('holds when the playhead sits BEFORE the clip started', () => {
    expect(
      resolveClipAdvance({
        layout,
        currentClipId: 'b',
        playheadMs: T0 + 1_000,
        endGuardMs: DEFAULT_END_GUARD_MS,
      }),
    ).toEqual({ kind: 'hold' })
  })

  it('advances on the first report AFTER the end — the reports are ~1 Hz', () => {
    // The server reports the playhead about once a second in playback, so the
    // 800ms window a symmetric guard leaves around `endMs` is MISSED whenever a
    // report happens to straddle it: one clip in five simply ran on into the
    // hole the ribbon exists to skip, with nothing to say why. The overshoot is
    // measured in REPORTS, not in fragments — it is a different quantity from
    // the end guard, which is why it is a different number.
    const decision = resolveClipAdvance({
      layout,
      currentClipId: 'a',
      playheadMs: T0 + 10_000 + 900,
      endGuardMs: DEFAULT_END_GUARD_MS,
    })
    expect(decision.kind).toBe('advance')
  })

  it('still refuses a playhead further past the end than a report can explain', () => {
    expect(
      resolveClipAdvance({
        layout,
        currentClipId: 'a',
        playheadMs: T0 + 10_000 + DEFAULT_OVERSHOOT_MS + 1,
        endGuardMs: DEFAULT_END_GUARD_MS,
      }),
    ).toEqual({ kind: 'hold' })
  })

  it('still advances at the very edge of the end guard, from either side', () => {
    // The bound must not shrink the feature: the guard's whole job is to fire
    // inside the final fragment, and a report landing just after `endMs` is the
    // normal way a clip ends.
    for (const playheadMs of [T0 + 10_000 - DEFAULT_END_GUARD_MS, T0 + 10_000 + DEFAULT_END_GUARD_MS]) {
      const decision = resolveClipAdvance({
        layout,
        currentClipId: 'a',
        playheadMs,
        endGuardMs: DEFAULT_END_GUARD_MS,
      })
      expect(decision.kind, `playheadMs ${playheadMs}`).toBe('advance')
    }
  })
})

describe('clipAt / firstClipFrom', () => {
  const layout = buildLayoutFixture(
    [clip('a', T0, T0 + 10_000), clip('b', T0 + 3_610_000, T0 + 3_620_000)],
    OPTS,
  )

  it('bounds-checks the index', () => {
    expect(clipAt(layout, 0)?.clipId).toBe('a')
    expect(clipAt(layout, 9)).toBeNull()
    expect(clipAt(layout, -1)).toBeNull()
  })

  it('lands a moment inside a hole on the NEXT clip', () => {
    expect(firstClipFrom(layout, T0 + 500_000)?.clipId).toBe('b')
  })

  it('returns the containing clip when the moment has footage', () => {
    expect(firstClipFrom(layout, T0 + 5_000)?.clipId).toBe('a')
  })

  it('returns null past the end', () => {
    expect(firstClipFrom(layout, T0 + 9_999_999)).toBeNull()
  })
})

describe('scrollOffsetForPx', () => {
  it('anchors the playhead above centre', () => {
    expect(scrollOffsetForPx(500, 400, 2_000, 0.4)).toBe(340)
  })

  it('never scrolls past either end', () => {
    expect(scrollOffsetForPx(10, 400, 2_000, 0.4)).toBe(0)
    expect(scrollOffsetForPx(1_990, 400, 2_000, 0.4)).toBe(1_600)
  })

  it('is 0 before the viewport is measured', () => {
    expect(scrollOffsetForPx(500, 0, 2_000)).toBe(0)
  })
})

describe('formatGapLabel / decomposeDuration', () => {
  it('decomposes whole units', () => {
    expect(decomposeDuration(90_061_000)).toEqual({ days: 1, hours: 1, minutes: 1, seconds: 1 })
  })

  it('reads a negative duration as zero', () => {
    expect(decomposeDuration(-5_000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 })
  })

  it('shows the two most significant non-zero units', () => {
    expect(formatGapLabel(2 * 3_600_000 + 14 * 60_000)).toBe('2h 14m')
    expect(formatGapLabel(45 * 60_000 + 12_000)).toBe('45m 12s')
    expect(formatGapLabel(8_000)).toBe('8s')
    expect(formatGapLabel(3 * 86_400_000 + 5 * 3_600_000 + 9 * 60_000)).toBe('3d 5h')
  })

  it('skips a zero middle unit rather than padding it', () => {
    expect(formatGapLabel(3_600_000 + 5_000)).toBe('1h 5s')
  })

  it('never renders blank', () => {
    expect(formatGapLabel(0)).toBe('0s')
    expect(formatGapLabel(400)).toBe('0s')
  })

  it('takes translated unit suffixes', () => {
    expect(formatGapLabel(7_320_000, { d: 'g', h: 'o', m: 'm', s: 's' })).toBe('2o 2m')
  })
})
