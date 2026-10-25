import { describe, it, expect } from 'vitest'
import {
  DEFAULTS,
  clampColumns,
  clampMotionHoldSec,
  MOTION_HOLD_MIN,
  MOTION_HOLD_MAX,
  setGridDefaultEntry,
  setStreamDefaultEntry,
  setClusterEntry,
  setEventsEntry,
  setHapticsEntry,
  setCameraListEntry,
  resetSettingsEntry,
  parseSettings,
  reelThumbSizePx,
  isReelThumbSize,
  isGridDensity,
  isTileLabelMode,
  migrateTileLabelMode,
  REEL_THUMB_SIZE_REV,
  densityColumns,
  galleryColumns,
  galleryDeviceClass,
  GRID_DENSITY_TILE_PX,
  REEL_THUMB_SIZE_PX,
  COLUMNS_MIN,
  COLUMNS_MAX,
  DEFAULT_COLUMNS,
  type AppSettings,
} from '../settings-store.js'

describe('settings-store DEFAULTS', () => {
  it('provides sane out-of-the-box defaults', () => {
    expect(DEFAULTS.grid.motionHoldSec).toBe(3)
    // `last-selected` since 2026-09-15 (operator). Pinned rather than left
    // implicit: this is the value every fresh install gets, and it decides
    // whether opening a camera makes a sound in a room where somebody may be
    // asleep. With no per-camera history it resolves to MUTED — see
    // `live/__tests__/audio-on-open.spec.ts`.
    expect(DEFAULTS.stream.audioOnOpen).toBe('last-selected')
    expect(DEFAULTS.stream.pinchExpandsHeight).toBe(false)
  })

  it('DEFAULTS is frozen (cannot be mutated)', () => {
    expect(Object.isFrozen(DEFAULTS)).toBe(true)
    expect(Object.isFrozen(DEFAULTS.grid)).toBe(true)
  })

  it('resetSettingsEntry returns a fresh, mutable copy equal to DEFAULTS', () => {
    const fresh = resetSettingsEntry()
    expect(fresh).toEqual(DEFAULTS)
    expect(fresh).not.toBe(DEFAULTS)
    expect(Object.isFrozen(fresh.grid)).toBe(false)
  })
})

describe('clamp helpers', () => {
  it('clampColumns keeps values inside [MIN, MAX] and floors', () => {
    expect(clampColumns(0)).toBe(COLUMNS_MIN)
    expect(clampColumns(99)).toBe(COLUMNS_MAX)
    expect(clampColumns(3.9)).toBe(3)
    expect(clampColumns(Number.NaN)).toBe(DEFAULT_COLUMNS)
  })

  it('clampMotionHoldSec keeps values inside [MIN, MAX] and rounds', () => {
    expect(clampMotionHoldSec(-5)).toBe(MOTION_HOLD_MIN)
    expect(clampMotionHoldSec(999)).toBe(MOTION_HOLD_MAX)
    expect(clampMotionHoldSec(3)).toBe(3)
    expect(clampMotionHoldSec(4.6)).toBe(5)
    expect(clampMotionHoldSec(0)).toBe(0)
    expect(clampMotionHoldSec(Number.NaN)).toBe(DEFAULTS.grid.motionHoldSec)
  })
})

describe('immutable setters', () => {
  const base: AppSettings = resetSettingsEntry()

  it('setGridDefaultEntry updates one field and does not mutate input', () => {
    const next = setGridDefaultEntry(base, 'motionHoldSec', 8)
    expect(next.grid.motionHoldSec).toBe(8)
    expect(next).not.toBe(base)
    expect(next.grid).not.toBe(base.grid)
    // input untouched
    expect(base.grid.motionHoldSec).toBe(DEFAULTS.grid.motionHoldSec)
  })

  it('setGridDefaultEntry clamps motionHoldSec into range', () => {
    expect(setGridDefaultEntry(base, 'motionHoldSec', 5).grid.motionHoldSec).toBe(5)
    expect(setGridDefaultEntry(base, 'motionHoldSec', 999).grid.motionHoldSec).toBe(MOTION_HOLD_MAX)
    expect(setGridDefaultEntry(base, 'motionHoldSec', -1).grid.motionHoldSec).toBe(MOTION_HOLD_MIN)
    // input untouched
    expect(base.grid.motionHoldSec).toBe(DEFAULTS.grid.motionHoldSec)
  })

  it('setStreamDefaultEntry updates one field and does not mutate input', () => {
    // Written AGAINST the default (`last-selected`), so the setter really
    // changes something: asserting a write of the value that is already there
    // proves nothing about immutability or about the setter.
    const next = setStreamDefaultEntry(base, 'audioOnOpen', 'off')
    expect(next.stream.audioOnOpen).toBe('off')
    expect(next.stream).not.toBe(base.stream)
    expect(base.stream.audioOnOpen).toBe('last-selected')
  })

  it('setClusterEntry updates cardWidthFraction immutably and clamps it', () => {
    const next = setClusterEntry(base, 'cardWidthFraction', 0.5)
    expect(next.clusters.cardWidthFraction).toBe(0.5)
    expect(next.clusters).not.toBe(base.clusters)
    expect(base.clusters.cardWidthFraction).toBe(DEFAULTS.clusters.cardWidthFraction)
    // out of range → clamped
    expect(setClusterEntry(base, 'cardWidthFraction', 5).clusters.cardWidthFraction).toBe(0.9)
  })
})

describe('parseSettings', () => {
  it('returns defaults for null / invalid JSON', () => {
    expect(parseSettings(null)).toEqual(DEFAULTS)
    expect(parseSettings('not json')).toEqual(DEFAULTS)
    expect(parseSettings('"a string"')).toEqual(DEFAULTS)
    expect(parseSettings('null')).toEqual(DEFAULTS)
  })

  it('round-trips a full document', () => {
    const custom: AppSettings = setStreamDefaultEntry(
      setGridDefaultEntry(resetSettingsEntry(), 'motionHoldSec', 8),
      'audioOnOpen',
      'on',
    )
    const parsed = parseSettings(JSON.stringify(custom))
    expect(parsed).toEqual(custom)
  })

  it('fills missing fields with defaults (partial document)', () => {
    const parsed = parseSettings(JSON.stringify({ grid: { motionHoldSec: 8 } }))
    expect(parsed.grid.motionHoldSec).toBe(8)
    expect(parsed.stream).toEqual(DEFAULTS.stream)
    expect(parsed.haptics).toEqual(DEFAULTS.haptics)
  })

  /**
   * A field that LEAVES the schema is not carried forward: the sanitizer
   * rebuilds every group key by key. The whole `advanced` group is the live
   * case — its one switch, debug mode, describes the DEVICE and moved to
   * `device-settings-store` (the move itself is `device-local-migration.ts`).
   */
  it('drops a group the schema no longer declares, without disturbing its neighbours', () => {
    const parsed = parseSettings(
      JSON.stringify({ advanced: { debugMode: true, debugNote: 'x' }, grid: { motionHoldSec: 8 } }),
    )
    expect(Object.hasOwn(parsed, 'advanced')).toBe(false)
    expect(parsed.grid.motionHoldSec).toBe(8)
  })

  it('haptics default OFF (opt-in) with every kind pre-armed', () => {
    expect(DEFAULTS.haptics.enabled).toBe(false)
    expect(DEFAULTS.haptics.motion).toBe(true)
    expect(DEFAULTS.haptics.detection).toBe(true)
    expect(DEFAULTS.haptics.person).toBe(true)
  })

  it('press feedback defaults ON — it is opt-OUT, unlike the event pulses', () => {
    expect(DEFAULTS.haptics.uiFeedback).toBe(true)
  })

  it('gives an install persisted BEFORE press feedback shipped the ON default', () => {
    // The real migration path: settings written by an older build carry the
    // four event flags and no `uiFeedback`. Falling back to `false` there would
    // silently ship the feature switched off to every existing user, which is
    // indistinguishable from it not working.
    const legacy = JSON.stringify({
      haptics: { enabled: true, motion: true, detection: true, person: true },
    })
    expect(parseSettings(legacy).haptics.uiFeedback).toBe(true)
  })

  it('keeps press feedback and event pulses INDEPENDENT through a round trip', () => {
    const parsed = parseSettings(
      JSON.stringify({ haptics: { enabled: false, uiFeedback: true } }),
    )
    expect(parsed.haptics.enabled).toBe(false)
    expect(parsed.haptics.uiFeedback).toBe(true)
    const flipped = setHapticsEntry(parsed, 'uiFeedback', false)
    expect(flipped.haptics.uiFeedback).toBe(false)
    expect(flipped.haptics.enabled).toBe(false)
    expect(parsed.haptics.uiFeedback).toBe(true) // original untouched
  })

  it('setHapticsEntry immutably updates one flag', () => {
    const base = resetSettingsEntry()
    const next = setHapticsEntry(base, 'enabled', true)
    expect(next.haptics.enabled).toBe(true)
    expect(base.haptics.enabled).toBe(false) // original untouched
    expect(setHapticsEntry(base, 'person', false).haptics.person).toBe(false)
  })

  it('parses haptics flags and defaults wrong-typed values', () => {
    const parsed = parseSettings(JSON.stringify({ haptics: { enabled: true, motion: 'yes' } }))
    // `enabled` is NOT hydrated any more: the event pulses lost their UI on
    // 2026-09-13 and a stored `true` from before must not switch back on a
    // feature the operator can no longer switch off.
    expect(parsed.haptics.enabled).toBe(false)
    expect(parsed.haptics.motion).toBe(DEFAULTS.haptics.motion) // wrong type → default
    expect(parsed.haptics.detection).toBe(DEFAULTS.haptics.detection)
  })

  it('rejects out-of-range / wrong-typed values', () => {
    const parsed = parseSettings(
      JSON.stringify({
        grid: { motionHoldSec: 999 },
        clusters: { cardWidthFraction: 5 },
      }),
    )
    expect(parsed.grid.motionHoldSec).toBe(MOTION_HOLD_MAX)
    expect(parsed.clusters.cardWidthFraction).toBe(0.9)
  })

  it('parses and clamps grid.motionHoldSec', () => {
    expect(parseSettings(JSON.stringify({ grid: { motionHoldSec: 5 } })).grid.motionHoldSec).toBe(5)
    // Out of range → clamped; wrong type → default.
    expect(parseSettings(JSON.stringify({ grid: { motionHoldSec: 999 } })).grid.motionHoldSec).toBe(
      MOTION_HOLD_MAX,
    )
    expect(parseSettings(JSON.stringify({ grid: { motionHoldSec: 'x' } })).grid.motionHoldSec).toBe(
      DEFAULTS.grid.motionHoldSec,
    )
  })

  it('defaults events.reelThumbSize to small on a wrong-typed value', () => {
    const parsed = parseSettings(JSON.stringify({ events: { reelThumbSize: 'huge' } }))
    expect(parsed.events.reelThumbSize).toBe('small')
  })

  it('round-trips a chosen reel size', () => {
    const custom: AppSettings = setEventsEntry(resetSettingsEntry(), 'reelThumbSize', 'large')
    expect(parseSettings(JSON.stringify(custom)).events.reelThumbSize).toBe('large')
  })
})

describe('events preferences (reel thumbnail size)', () => {
  it('defaults to the compact (small) preset', () => {
    expect(DEFAULTS.events.reelThumbSize).toBe('small')
  })

  it('uses the 60 / 80 / 106 px scale', () => {
    expect(REEL_THUMB_SIZE_PX.small).toBe(60)
    expect(REEL_THUMB_SIZE_PX.medium).toBe(80)
    expect(REEL_THUMB_SIZE_PX.large).toBe(106)
    expect(REEL_THUMB_SIZE_PX.small).toBeLessThan(REEL_THUMB_SIZE_PX.large)
  })

  it('reelThumbSizePx maps every preset to ascending px', () => {
    expect(reelThumbSizePx('small')).toBe(60)
    expect(reelThumbSizePx('medium')).toBe(80)
    expect(reelThumbSizePx('large')).toBe(106)
  })

  it('migrates a pre-rev reel preset one step up so the px edge stays similar', () => {
    const parsed = parseSettings(JSON.stringify({ events: { reelThumbSize: 'small', reelThumbSizeRev: 0 } }))
    expect(parsed.events.reelThumbSize).toBe('medium')
    expect(parsed.events.reelThumbSizeRev).toBe(REEL_THUMB_SIZE_REV)
    const kept = parseSettings(JSON.stringify({ events: { reelThumbSize: 'small', reelThumbSizeRev: REEL_THUMB_SIZE_REV } }))
    expect(kept.events.reelThumbSize).toBe('small')
  })

  it('isReelThumbSize guards the union', () => {
    expect(isReelThumbSize('small')).toBe(true)
    expect(isReelThumbSize('large')).toBe(true)
    expect(isReelThumbSize('xl')).toBe(false)
    expect(isReelThumbSize(80)).toBe(false)
  })

  it('setEventsEntry updates immutably', () => {
    const base = resetSettingsEntry()
    const next = setEventsEntry(base, 'reelThumbSize', 'medium')
    expect(next.events.reelThumbSize).toBe('medium')
    expect(next.events).not.toBe(base.events)
    expect(base.events.reelThumbSize).toBe('small')
  })
})

describe('events reel label mode', () => {
  it('defaults to off on the reel and icon on the gallery', () => {
    expect(DEFAULTS.events.reelLabelMode).toBe('off')
    expect(DEFAULTS.events.tileLabelMode).toBe('icon')
  })

  it('isTileLabelMode guards the union', () => {
    expect(isTileLabelMode('off')).toBe(true)
    expect(isTileLabelMode('icon')).toBe(true)
    expect(isTileLabelMode('label')).toBe(true)
    expect(isTileLabelMode('text')).toBe(false)
  })

  it('migrateTileLabelMode maps legacy show + style', () => {
    expect(migrateTileLabelMode(undefined, false, 'icon', 'icon')).toBe('off')
    expect(migrateTileLabelMode(undefined, true, 'icon', 'off')).toBe('icon')
    expect(migrateTileLabelMode(undefined, true, 'text', 'off')).toBe('label')
    expect(migrateTileLabelMode('label', true, 'icon', 'off')).toBe('label')
  })

  it('parseSettings migrates legacy reel fields and honours reelChromeRev', () => {
    const bare = parseSettings(JSON.stringify({ events: { reelShowLabels: true, reelShowImportance: true } }))
    expect(bare.events.reelLabelMode).toBe('off')
    const kept = parseSettings(
      JSON.stringify({ events: { reelChromeRev: 1, reelShowLabels: true, reelLabelStyle: 'text' } }),
    )
    expect(kept.events.reelLabelMode).toBe('label')
  })

  it('parseSettings migrates legacy tile fields', () => {
    const parsed = parseSettings(JSON.stringify({ events: { tileShowLabels: false, tileLabelStyle: 'text' } }))
    expect(parsed.events.tileLabelMode).toBe('off')
    const icons = parseSettings(JSON.stringify({ events: { tileShowLabels: true, tileLabelStyle: 'icon' } }))
    expect(icons.events.tileLabelMode).toBe('icon')
  })

  it('parseSettings ignores the retired time-detail key an older install stored', () => {
    const parsed = parseSettings(JSON.stringify({ events: { tileDetailTime: true, tileDetailCamera: true } }))
    expect('tileDetailTime' in parsed.events).toBe(false)
    expect(parsed.events.tileDetailCamera).toBe(true)
  })

  it('round-trips label modes', () => {
    const custom: AppSettings = setEventsEntry(
      setEventsEntry(resetSettingsEntry(), 'reelLabelMode', 'icon'),
      'tileLabelMode',
      'label',
    )
    const parsed = parseSettings(JSON.stringify(custom))
    expect(parsed.events.reelLabelMode).toBe('icon')
    expect(parsed.events.tileLabelMode).toBe('label')
  })
})

describe('events-page track card display prefs (details)', () => {
  it('defaults: every tile detail hidden', () => {
    expect(DEFAULTS.events.tileDetailCamera).toBe(false)
    expect('tileDetailTime' in DEFAULTS.events).toBe(false)
    expect(DEFAULTS.events.tileDetailZone).toBe(false)
  })

  it('parseSettings degrades wrong-typed detail fields to the defaults', () => {
    const parsed = parseSettings(JSON.stringify({ events: { tileDetailCamera: 'yes' } }))
    expect(parsed.events.tileDetailCamera).toBe(false)
  })

  it('round-trips custom detail values', () => {
    const custom: AppSettings = setEventsEntry(resetSettingsEntry(), 'tileDetailCamera', true)
    const parsed = parseSettings(JSON.stringify(custom))
    expect(parsed.events.tileDetailCamera).toBe(true)
  })
})

describe('events grid density (page-inline tile-size preset)', () => {
  it('defaults to medium', () => {
    expect(DEFAULTS.events.gridDensity).toBe('medium')
  })

  it('isGridDensity guards the union', () => {
    expect(isGridDensity('compact')).toBe(true)
    expect(isGridDensity('medium')).toBe(true)
    expect(isGridDensity('large')).toBe(true)
    expect(isGridDensity('xl')).toBe(false)
    expect(isGridDensity(2)).toBe(false)
  })

  it('parseSettings degrades a wrong-typed density to the default', () => {
    expect(parseSettings(JSON.stringify({ events: { gridDensity: 'huge' } })).events.gridDensity).toBe('medium')
    expect(parseSettings(JSON.stringify({ events: { gridDensity: 3 } })).events.gridDensity).toBe('medium')
  })

  it('round-trips a chosen density', () => {
    const custom: AppSettings = setEventsEntry(resetSettingsEntry(), 'gridDensity', 'compact')
    expect(parseSettings(JSON.stringify(custom)).events.gridDensity).toBe('compact')
  })

  it('tile targets ascend compact < medium < large', () => {
    expect(GRID_DENSITY_TILE_PX.compact).toBeLessThan(GRID_DENSITY_TILE_PX.medium)
    expect(GRID_DENSITY_TILE_PX.medium).toBeLessThan(GRID_DENSITY_TILE_PX.large)
  })

  it('densityColumns fits more columns at compact than large for one width', () => {
    const width = 800
    expect(densityColumns(width, 'compact')).toBeGreaterThan(densityColumns(width, 'large'))
  })

  it('densityColumns is responsive: wider container → more columns', () => {
    expect(densityColumns(1200, 'medium')).toBeGreaterThan(densityColumns(400, 'medium'))
  })

  it('densityColumns never returns fewer than 1 column (tiny/invalid widths)', () => {
    expect(densityColumns(10, 'large')).toBe(1)
    expect(densityColumns(0, 'medium')).toBe(1)
    expect(densityColumns(Number.NaN, 'compact')).toBe(1)
  })
})

describe('galleryColumns — device class + available width', () => {
  it('phone 390 lands on 4 / 3 / 2', () => {
    expect(galleryDeviceClass(390)).toBe('phone')
    expect(galleryColumns(390, 'compact', 'phone')).toBe(5)
    expect(galleryColumns(390, 'medium', 'phone')).toBe(4)
    expect(galleryColumns(390, 'large', 'phone')).toBe(3)
  })

  it('grows with extra width on the same device', () => {
    expect(galleryColumns(844, 'compact', 'phone')).toBeGreaterThan(
      galleryColumns(390, 'compact', 'phone'),
    )
  })

  it('tablet and desktop pack more than a phone at the same width', () => {
    expect(galleryColumns(1100, 'compact', 'desktop')).toBeGreaterThan(
      galleryColumns(390, 'compact', 'phone'),
    )
    expect(galleryDeviceClass(800)).toBe('tablet')
    expect(galleryDeviceClass(1200)).toBe('desktop')
  })

  it('never returns 0 or more than the embed cap', () => {
    expect(galleryColumns(10, 'large', 'phone')).toBe(1)
    expect(galleryColumns(8_000, 'compact', 'desktop')).toBeLessThanOrEqual(12)
  })
})

describe('camera-list overlay settings (global card overlays)', () => {
  it('defaults: motion ring on, occupancy off until the operator places it', () => {
    expect(DEFAULTS.cameraList.motionBorder).toBe(true)
    expect(DEFAULTS.cameraList.occupancy).toBe('off')
  })

  it('setCameraListEntry is immutable and per-field', () => {
    const base = resetSettingsEntry()
    const next = setCameraListEntry(base, 'occupancy', 'top-center')
    expect(next.cameraList.occupancy).toBe('top-center')
    expect(next.cameraList.motionBorder).toBe(true)
    expect(base.cameraList.occupancy).toBe('off')
    const off = setCameraListEntry(next, 'motionBorder', false)
    expect(off.cameraList.motionBorder).toBe(false)
    expect(off.cameraList.occupancy).toBe('top-center')
  })

  it('parseSettings round-trips a stored value and rejects junk field-by-field', () => {
    const stored = JSON.stringify({ cameraList: { motionBorder: false, occupancy: 'top-right' } })
    const parsed = parseSettings(stored)
    expect(parsed.cameraList.motionBorder).toBe(false)
    expect(parsed.cameraList.occupancy).toBe('top-right')

    const junk = parseSettings(
      JSON.stringify({ cameraList: { motionBorder: 'yes', occupancy: 'centre-ish' } }),
    )
    expect(junk.cameraList.motionBorder).toBe(DEFAULTS.cameraList.motionBorder)
    expect(junk.cameraList.occupancy).toBe(DEFAULTS.cameraList.occupancy)
  })

  it('a pre-cameraList document degrades to the defaults, never a throw', () => {
    const parsed = parseSettings(JSON.stringify({ grid: {}, stream: {} }))
    expect(parsed.cameraList).toEqual(DEFAULTS.cameraList)
  })

  it("'off' is a valid stored occupancy (it is how the strip is hidden)", () => {
    const parsed = parseSettings(JSON.stringify({ cameraList: { occupancy: 'off' } }))
    expect(parsed.cameraList.occupancy).toBe('off')
  })

  it('motionBadge defaults off — the ring is the default motion treatment', () => {
    // The card never drew the pill before 2026-08-02, so adopting the field
    // must change nothing until the operator places it.
    expect(DEFAULTS.cameraList.motionBadge).toBe('off')
  })

  it('parseSettings round-trips a stored motionBadge anchor and rejects junk', () => {
    const parsed = parseSettings(JSON.stringify({ cameraList: { motionBadge: 'bottom-center' } }))
    expect(parsed.cameraList.motionBadge).toBe('bottom-center')

    const junk = parseSettings(JSON.stringify({ cameraList: { motionBadge: true } }))
    expect(junk.cameraList.motionBadge).toBe(DEFAULTS.cameraList.motionBadge)
  })

  it('a pre-motionBadge document degrades that one field, not the rest', () => {
    const parsed = parseSettings(JSON.stringify({ cameraList: { occupancy: 'top-left' } }))
    expect(parsed.cameraList.motionBadge).toBe(DEFAULTS.cameraList.motionBadge)
    expect(parsed.cameraList.occupancy).toBe('top-left')
  })
})

describe('retired importance display toggles', () => {
  it('does not rehydrate legacy importance keys on clusters or events', () => {
    const parsed = parseSettings(
      JSON.stringify({
        clusters: { showImportance: true },
        events: { tileShowImportance: true, reelShowImportance: true, reelChromeRev: 1 },
      }),
    )
    expect('showImportance' in parsed.clusters).toBe(false)
    expect('tileShowImportance' in parsed.events).toBe(false)
    expect('reelShowImportance' in parsed.events).toBe(false)
  })
})
