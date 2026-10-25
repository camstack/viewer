import { describe, it, expect } from 'vitest'
import {
  DEFAULTS,
  resetSettingsEntry,
  setClusterEntry,
  clampCardWidthFraction,
  matchTimelineDensityPreset,
  parseSettings,
  CARD_WIDTH_FRACTION_MIN,
  CARD_WIDTH_FRACTION_MAX,
  TIMELINE_DENSITY_PRESETS,
  TIMELINE_DENSITY_PRESET_ORDER,
  type AppSettings,
} from '../settings-store.js'

describe('ClusterPreferences DEFAULTS', () => {
  it('provides correct out-of-the-box cluster defaults', () => {
    expect(DEFAULTS.clusters.gapPercent).toBe(10)
    expect(DEFAULTS.clusters.cardWidthFraction).toBe(0.6)
    expect(DEFAULTS.clusters.showClass).toBe(true)
    expect('showImportance' in DEFAULTS.clusters).toBe(false)
  })

  it('the retired activityVariant / repPriority / indicatorPositionPct fields are GONE', () => {
    // The ribbon activity style and the detection-priority list were removed —
    // lanes is the only activity bar and the representative order is fixed.
    // The indicator-position stepper was removed too — the timeline indicator
    // is two constants now, switched by whether the timeline is on the live
    // edge (`timeline-indicator.ts`: LIVE 10 % / PLAYBACK 50 %), and neither
    // is an operator setting.
    expect('activityVariant' in DEFAULTS.clusters).toBe(false)
    expect('repPriority' in DEFAULTS.clusters).toBe(false)
    expect('indicatorPositionPct' in DEFAULTS.clusters).toBe(false)
  })

  it('DEFAULTS.clusters is frozen', () => {
    expect(Object.isFrozen(DEFAULTS.clusters)).toBe(true)
  })

  it('resetSettingsEntry includes clusters equal to DEFAULTS.clusters', () => {
    const fresh = resetSettingsEntry()
    expect(fresh.clusters).toEqual(DEFAULTS.clusters)
    expect(fresh.clusters).not.toBe(DEFAULTS.clusters)
  })
})

describe('setClusterEntry (immutable reducer)', () => {
  const base: AppSettings = resetSettingsEntry()

  it('updates gapPercent and does not mutate input', () => {
    const next = setClusterEntry(base, 'gapPercent', 20)
    expect(next.clusters.gapPercent).toBe(20)
    expect(next.clusters).not.toBe(base.clusters)
    expect(next).not.toBe(base)
    expect(base.clusters.gapPercent).toBe(10)
  })

  it('updates showClass immutably', () => {
    expect(setClusterEntry(base, 'showClass', false).clusters.showClass).toBe(false)
    expect(base.clusters.showClass).toBe(true)
  })

  it('clamps cardWidthFraction into [0.4, 0.9] immutably', () => {
    expect(setClusterEntry(base, 'cardWidthFraction', 0.55).clusters.cardWidthFraction).toBe(0.55)
    expect(setClusterEntry(base, 'cardWidthFraction', 1.2).clusters.cardWidthFraction).toBe(
      CARD_WIDTH_FRACTION_MAX,
    )
    expect(setClusterEntry(base, 'cardWidthFraction', 0.1).clusters.cardWidthFraction).toBe(
      CARD_WIDTH_FRACTION_MIN,
    )
    expect(base.clusters.cardWidthFraction).toBe(0.6)
  })

  it('does not affect other settings sections', () => {
    const next = setClusterEntry(base, 'gapPercent', 15)
    expect(next.grid).toBe(base.grid)
    expect(next.stream).toBe(base.stream)
    expect(next.highlight).toBe(base.highlight)
  })
})

describe('clamp helpers', () => {
  it('clampCardWidthFraction bounds, rounds to 2 decimals, degrades non-finite', () => {
    expect(clampCardWidthFraction(0.85)).toBe(0.85)
    expect(clampCardWidthFraction(0.723456)).toBe(0.72)
    expect(clampCardWidthFraction(2)).toBe(CARD_WIDTH_FRACTION_MAX)
    expect(clampCardWidthFraction(0)).toBe(CARD_WIDTH_FRACTION_MIN)
    expect(clampCardWidthFraction(Number.NaN)).toBe(DEFAULTS.clusters.cardWidthFraction)
  })
})

describe('timeline density presets', () => {
  it('every preset pair is within the clamped ranges', () => {
    for (const preset of TIMELINE_DENSITY_PRESET_ORDER) {
      const v = TIMELINE_DENSITY_PRESETS[preset]
      expect(clampCardWidthFraction(v.cardWidthFraction)).toBe(v.cardWidthFraction)
      expect(v.gapPercent).toBeGreaterThanOrEqual(0)
      expect(v.gapPercent).toBeLessThanOrEqual(30)
    }
  })

  it('the default settings match the medium preset', () => {
    expect(matchTimelineDensityPreset(DEFAULTS.clusters)).toBe('medium')
  })

  it('matches each preset after applying its pair (round-trip via the reducer)', () => {
    for (const preset of TIMELINE_DENSITY_PRESET_ORDER) {
      const v = TIMELINE_DENSITY_PRESETS[preset]
      const next = setClusterEntry(
        setClusterEntry(resetSettingsEntry(), 'gapPercent', v.gapPercent),
        'cardWidthFraction',
        v.cardWidthFraction,
      )
      expect(matchTimelineDensityPreset(next.clusters)).toBe(preset)
    }
  })

  it('returns null (custom) for a pair no preset owns', () => {
    expect(matchTimelineDensityPreset({ gapPercent: 10, cardWidthFraction: 0.66 })).toBeNull()
    expect(matchTimelineDensityPreset({ gapPercent: 7, cardWidthFraction: 0.72 })).toBeNull()
  })
})

describe('parseSettings — clusters defensive parse', () => {
  it('returns cluster defaults when clusters section is missing', () => {
    const parsed = parseSettings(JSON.stringify({ grid: {}, stream: {} }))
    expect(parsed.clusters).toEqual(DEFAULTS.clusters)
  })

  it('returns cluster defaults for null / invalid JSON', () => {
    expect(parseSettings(null).clusters).toEqual(DEFAULTS.clusters)
    expect(parseSettings('not json').clusters).toEqual(DEFAULTS.clusters)
  })

  it('round-trips a full clusters document', () => {
    const custom: AppSettings = setClusterEntry(
      setClusterEntry(resetSettingsEntry(), 'gapPercent', 15),
      'cardWidthFraction',
      0.75,
    )
    const parsed = parseSettings(JSON.stringify(custom))
    expect(parsed.clusters.gapPercent).toBe(15)
    expect(parsed.clusters.cardWidthFraction).toBe(0.75)
  })

  it('tolerates OLD blobs still carrying retired fields (ignored)', () => {
    // activityVariant / repPriority / timelineEngine came from earlier versions;
    // the defensive parse must ignore them and never leak them into the value.
    const parsed = parseSettings(
      JSON.stringify({
        clusters: {
          gapPercent: 12,
          activityVariant: 'ribbon',
          repPriority: ['person'],
          timelineEngine: 'list',
        },
      }),
    )
    expect(parsed.clusters.gapPercent).toBe(12)
    expect(parsed.clusters).not.toHaveProperty('activityVariant')
    expect(parsed.clusters).not.toHaveProperty('repPriority')
    expect(parsed.clusters).not.toHaveProperty('timelineEngine')
    expect('showImportance' in parsed.clusters).toBe(false)
  })

  it('degrades wrong-typed values field-by-field', () => {
    const parsed = parseSettings(
      JSON.stringify({ clusters: { gapPercent: 'bad', showImportance: 'yes', cardWidthFraction: 'wide' } }),
    )
    expect(parsed.clusters.gapPercent).toBe(DEFAULTS.clusters.gapPercent)
    expect('showImportance' in parsed.clusters).toBe(false)
    expect(parsed.clusters.cardWidthFraction).toBe(DEFAULTS.clusters.cardWidthFraction)
  })

  it('drops a persisted minImportance (retired filter, never leaks through)', () => {
    expect(parseSettings(JSON.stringify({ clusters: { minImportance: 3 } })).clusters).not.toHaveProperty(
      'minImportance',
    )
  })

  it('drops a persisted indicatorPositionPct (retired field, never leaks through)', () => {
    const parsed = parseSettings(JSON.stringify({ clusters: { indicatorPositionPct: 200 } }))
    expect(parsed.clusters).not.toHaveProperty('indicatorPositionPct')
  })

  it('parses + clamps cardWidthFraction, defaulting when absent or wrong-typed', () => {
    expect(parseSettings(JSON.stringify({ clusters: {} })).clusters.cardWidthFraction).toBe(0.6)
    expect(
      parseSettings(JSON.stringify({ clusters: { cardWidthFraction: 'wide' } })).clusters
        .cardWidthFraction,
    ).toBe(0.6)
    expect(
      parseSettings(JSON.stringify({ clusters: { cardWidthFraction: 0.55 } })).clusters
        .cardWidthFraction,
    ).toBe(0.55)
    expect(
      parseSettings(JSON.stringify({ clusters: { cardWidthFraction: 5 } })).clusters
        .cardWidthFraction,
    ).toBe(CARD_WIDTH_FRACTION_MAX)
  })
})

describe('a retired clusters.carousel key', () => {
  it('is ignored: an old document carrying it parses and the key is gone', () => {
    const parsed = parseSettings(JSON.stringify({ clusters: { showClass: false, carousel: false } }))
    expect(parsed.clusters.showClass).toBe(false)
    expect('carousel' in parsed.clusters).toBe(false)
    expect('carousel' in DEFAULTS.clusters).toBe(false)
  })
})
