import { describe, it, expect } from 'vitest'
import {
  colorForEventType,
  filterDetectionsByKind,
  filterDetectionsByClass,
  mergeAudioIntoHeatmapBins,
  mergeMotionIntoHeatmapBins,
  objectEventsToHeatmapHighlights,
  objectEventsToHeatmapBins,
  type DetectionLike,
} from '../event-highlights.js'
import { ALL_BAR_KINDS, HEATMAP_BINS, type HeatmapBin } from '../mock-data.js'

/** Ordinary local day (not a DST boundary): 2026-06-17 @ 12:00. */
function refNoon(): number {
  return new Date(2026, 5, 17, 12, 0, 0, 0).getTime()
}

/** Midnight (day start) for a given ms. */
function dayStart(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function det(className: string, atMs: number, id = `${className}-${atMs}`): DetectionLike {
  return { id, className, timestamp: atMs }
}

describe('colorForEventType', () => {
  it('maps motion/audio to the activity-band colors', () => {
    // Aligned to the server taxonomy (TAXONOMY_COLORS.motion / .audio).
    expect(colorForEventType('motion')).toBe('#16a34a')
    expect(colorForEventType('audio')).toBe('#06b6d4')
    expect(colorForEventType('MOTION')).toBe('#16a34a')
  })

  it('maps object classes via the detection palette deterministically', () => {
    // Aligned to the server taxonomy (person=green, car=amber).
    expect(colorForEventType('person')).toBe('#22c55e')
    expect(colorForEventType('car')).toBe('#f59e0b')
    // Unknown class still yields a stable, non-empty color.
    const a = colorForEventType('unicorn')
    expect(a).toBe(colorForEventType('unicorn'))
    expect(a).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('objectEventsToHeatmapHighlights (shares the timeline cluster source)', () => {
  it('positions a detection by its fraction of the VIEWED day (noon on a 24 h day is 12/24)', () => {
    const noon = refNoon()
    const start = dayStart(noon)
    const [h] = objectEventsToHeatmapHighlights([det('person', noon)], start)
    expect(h.fraction).toBeCloseTo(12 / 24, 5)
    expect(h.color).toBe(colorForEventType('person'))
  })

  it('places noon on 2026-10-25 at 13/25 when that day lasts 25 h', () => {
    const noon = new Date(2026, 9, 25, 12, 0, 0, 0).getTime()
    const start = dayStart(noon)
    const end = new Date(2026, 9, 26).getTime()
    const [h] = objectEventsToHeatmapHighlights([det('person', noon)], start)
    expect(h.fraction).toBeCloseTo((noon - start) / (end - start), 8)
    if (end - start === 25 * 3_600_000) expect(h.fraction).toBeCloseTo(13 / 25, 8)
  })

  it('places noon on 2026-03-29 at 11/23 when that day lasts 23 h', () => {
    const noon = new Date(2026, 2, 29, 12, 0, 0, 0).getTime()
    const start = dayStart(noon)
    const end = new Date(2026, 2, 30).getTime()
    const [h] = objectEventsToHeatmapHighlights([det('person', noon)], start)
    expect(h.fraction).toBeCloseTo((noon - start) / (end - start), 8)
    if (end - start === 23 * 3_600_000) expect(h.fraction).toBeCloseTo(11 / 23, 8)
  })

  it('keeps a detection in the last minute of 2026-10-25 (the extra hour a 24 h span drops)', () => {
    const start = new Date(2026, 9, 25).getTime()
    const end = new Date(2026, 9, 26).getTime()
    const late = end - 60_000
    const out = objectEventsToHeatmapHighlights([det('person', late)], start)
    expect(out).toHaveLength(1)
    expect(out[0].fraction).toBeCloseTo((late - start) / (end - start), 8)
    if (end - start === 25 * 3_600_000) expect(out[0].fraction).toBeGreaterThan(24 / 25)
  })

  it('keeps detections from a PAST viewed day (keyed on dayStart, not now)', () => {
    // Regression: the old markers projected against `nowMs`'s day, so a past-day
    // detection fell outside [0,1] and vanished. Keyed on the viewed day it stays.
    const noon = refNoon()
    const yesterday = new Date(noon)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayNoon = yesterday.getTime()
    const out = objectEventsToHeatmapHighlights([det('car', yesterdayNoon)], dayStart(yesterdayNoon))
    expect(out).toHaveLength(1)
    expect(out[0].fraction).toBeCloseTo(12 / 24, 5)
  })

  it('drops detections outside the viewed day', () => {
    const start = dayStart(refNoon())
    expect(objectEventsToHeatmapHighlights([det('person', start - 1)], start)).toHaveLength(0)
  })
})

describe('objectEventsToHeatmapBins (real detection density)', () => {
  it('buckets detections into the right bins and normalises to the busiest', () => {
    const start = dayStart(refNoon())
    const binMs = (24 * 3600_000) / HEATMAP_BINS
    // 2 detections in bin 1, 1 in bin 3 → bin1 = 1.0 (busiest), bin3 = 0.5.
    const evs = [
      det('person', start + binMs * 1 + 1000),
      det('person', start + binMs * 1 + 2000),
      det('car', start + binMs * 3 + 1000),
    ]
    const bins = objectEventsToHeatmapBins(evs, start)
    expect(bins).toHaveLength(HEATMAP_BINS)
    expect(bins[1].detection).toBeCloseTo(1, 5)
    expect(bins[3].detection).toBeCloseTo(0.5, 5)
    expect(bins[0].detection).toBe(0)
    expect(bins[1].motion).toBe(0)
    expect(bins[1].detectionColor).toBe(colorForEventType('person'))
    expect(bins.every((b) => b.audio === 0 && b.recorded === false && b.motion === 0)).toBe(true)
  })

  it('returns all-zero bins when there are no detections', () => {
    const bins = objectEventsToHeatmapBins([], dayStart(refNoon()))
    expect(bins).toHaveLength(HEATMAP_BINS)
    expect(bins.every((b) => b.detection === 0 && b.motion === 0)).toBe(true)
  })

  it('fuses cameras by counting every detection in the same bin', () => {
    const start = dayStart(refNoon())
    const binMs = (24 * 3600_000) / HEATMAP_BINS
    const evs = [
      det('person', start + binMs * 2 + 100),
      det('person', start + binMs * 2 + 200),
      det('car', start + binMs * 2 + 300),
    ]
    const bins = objectEventsToHeatmapBins(evs, start)
    // Detections populate `detection`, not `motion` — the two were split, and
    // the sibling test above already asserts `motion === 0` on EVERY bin while
    // a person detection is present. This assertion was left behind by that
    // split and had been reading a channel detections no longer write.
    expect(bins[2].detection).toBeCloseTo(1, 5)
    expect(bins[1].detection).toBe(0)
  })
})

describe('filterDetectionsByKind — track-shaped items vs the motion/audio chips', () => {
  interface Item {
    readonly id: string
    readonly audioLabels?: readonly string[]
  }
  const silent: Item = { id: 'silent' }
  const barking: Item = { id: 'barking', audioLabels: ['dog_bark'] }
  const all = [silent, barking]

  it('"all" passes everything (same reference)', () => {
    expect(filterDetectionsByKind(all, new Set(ALL_BAR_KINDS))).toBe(all)
    expect(filterDetectionsByKind(all, new Set())).toBe(all)
  })

  it('any selection including motion passes everything (tracks are motion-kind)', () => {
    expect(filterDetectionsByKind(all, new Set(['motion']))).toBe(all)
  })

  it('audio-only keeps only tracks with audio enrichment', () => {
    const out = filterDetectionsByKind(all, new Set(['audio']))
    expect(out.map((e) => e.id)).toEqual(['barking'])
  })
})

describe('filterDetectionsByClass — detection-class selection', () => {
  interface Item {
    readonly id: string
    readonly className?: string
    readonly classes?: readonly string[]
    readonly audioLabels?: readonly string[]
  }
  const person: Item = { id: 'p', className: 'person' }
  const car: Item = { id: 'c', className: 'car' }
  const multi: Item = { id: 'm', className: 'dog', classes: ['dog', 'animal'] }
  const bare: Item = { id: 'b' } // no class info at all
  const all = [person, car, multi, bare]

  it('an EMPTY selection means "all classes" (same reference)', () => {
    expect(filterDetectionsByClass(all, new Set())).toBe(all)
  })

  it('keeps items whose className is selected', () => {
    const out = filterDetectionsByClass(all, new Set(['person']))
    expect(out.map((e) => e.id)).toEqual(['p'])
  })

  it('a track passes if ANY of its classes[] is selected', () => {
    const out = filterDetectionsByClass(all, new Set(['animal']))
    expect(out.map((e) => e.id)).toEqual(['m'])
  })

  it('items with no class info never pass a non-empty selection', () => {
    expect(filterDetectionsByClass([bare], new Set(['person']))).toHaveLength(0)
  })

  it('composes with the kind filter inside filterDetectionsByKind', () => {
    const barkingDog: Item = { id: 'bd', className: 'dog', audioLabels: ['dog_bark'] }
    const silentPerson: Item = { id: 'sp', className: 'person' }
    const items = [barkingDog, silentPerson]
    // Kinds "all" + class selection → class-only filtering.
    expect(
      filterDetectionsByKind(items, new Set(ALL_BAR_KINDS), new Set(['person'])).map((e) => e.id),
    ).toEqual(['sp'])
    // Audio-only kinds + class selection → both must pass.
    expect(
      filterDetectionsByKind(items, new Set(['audio']), new Set(['dog'])).map((e) => e.id),
    ).toEqual(['bd'])
    expect(
      filterDetectionsByKind(items, new Set(['audio']), new Set(['person'])),
    ).toHaveLength(0)
    // No classes argument → unchanged legacy behaviour (same reference on all).
    expect(filterDetectionsByKind(items, new Set(ALL_BAR_KINDS))).toBe(items)
  })
})

describe('mergeAudioIntoHeatmapBins', () => {
  const DAY_MS = 24 * 3600_000
  const dayStartMs = dayStart(refNoon())
  const binMs = DAY_MS / HEATMAP_BINS
  const emptyBins: readonly HeatmapBin[] = Array.from({ length: HEATMAP_BINS }, (): HeatmapBin => ({
    motion: 0,
    detection: 0,
    audio: 0,
    recorded: false,
  }))

  it('paints every bin a bucket overlaps with its intensity', () => {
    // A bucket spanning exactly bins 4..5.
    const merged = mergeAudioIntoHeatmapBins(
      emptyBins,
      [{ startMs: dayStartMs + 4 * binMs, endMs: dayStartMs + 6 * binMs, intensity: 0.7 }],
      dayStartMs,
    )
    expect(merged[3].audio).toBe(0)
    expect(merged[4].audio).toBe(0.7)
    expect(merged[5].audio).toBe(0.7)
    expect(merged[6].audio).toBe(0) // exclusive end — no bleed into the next bin
  })

  it('max wins where buckets overlap, and motion/recorded are untouched', () => {
    const withMotion: readonly HeatmapBin[] = emptyBins.map((b, i): HeatmapBin =>
      i === 4 ? { motion: 0.9, detection: 0.4, audio: 0.2, recorded: true } : b,
    )
    const merged = mergeAudioIntoHeatmapBins(
      withMotion,
      [
        { startMs: dayStartMs + 4 * binMs, endMs: dayStartMs + 5 * binMs, intensity: 0.3 },
        { startMs: dayStartMs + 4 * binMs, endMs: dayStartMs + 5 * binMs, intensity: 0.8 },
      ],
      dayStartMs,
    )
    expect(merged[4]).toEqual({ motion: 0.9, detection: 0.4, audio: 0.8, recorded: true })
  })

  it('keeps a stronger pre-existing audio level', () => {
    const preset: readonly HeatmapBin[] = emptyBins.map((b, i): HeatmapBin =>
      i === 2 ? { ...b, audio: 0.9 } : b,
    )
    const merged = mergeAudioIntoHeatmapBins(
      preset,
      [{ startMs: dayStartMs + 2 * binMs, endMs: dayStartMs + 3 * binMs, intensity: 0.1 }],
      dayStartMs,
    )
    expect(merged[2].audio).toBe(0.9)
  })

  it('returns the same reference when nothing lands in-day', () => {
    expect(mergeAudioIntoHeatmapBins(emptyBins, [], dayStartMs)).toBe(emptyBins)
    expect(
      mergeAudioIntoHeatmapBins(
        emptyBins,
        [{ startMs: dayStartMs - 2 * binMs, endMs: dayStartMs - binMs, intensity: 1 }],
        dayStartMs,
      ),
    ).toBe(emptyBins)
  })
})

describe('mergeMotionIntoHeatmapBins', () => {
  const DAY_MS = 24 * 3600_000
  const dayStartMs = dayStart(refNoon())
  const binMs = DAY_MS / HEATMAP_BINS
  const emptyBins: readonly HeatmapBin[] = Array.from({ length: HEATMAP_BINS }, (): HeatmapBin => ({
    motion: 0,
    detection: 0,
    audio: 0,
    recorded: false,
  }))

  it('paints motion into its own channel without touching detection or audio', () => {
    const withDet: readonly HeatmapBin[] = emptyBins.map((b, i): HeatmapBin =>
      i === 2 ? { ...b, detection: 0.6, detectionColor: '#22c55e' } : b,
    )
    const merged = mergeMotionIntoHeatmapBins(
      withDet,
      [{ startMs: dayStartMs + 2 * binMs, endMs: dayStartMs + 3 * binMs, intensity: 0.8 }],
      dayStartMs,
    )
    expect(merged[2]).toMatchObject({ motion: 0.8, detection: 0.6, audio: 0 })
    expect(merged[1].motion).toBe(0)
  })
})
