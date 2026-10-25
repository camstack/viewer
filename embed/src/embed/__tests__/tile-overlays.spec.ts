import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  AUDIO_LEVEL_STEPS,
  anchorStyle,
  dbfsToLevel,
  framesPerSecond,
  isOverlayAnchor,
  meterOrientation,
  meterRenderOrder,
  meterSegmentSize,
  parseMotionRegions,
  parseOccupancyCounts,
  regionAlpha,
  statsLine,
} from '../tile-overlays'

/**
 * The pure half of the tile indicators. Each function is here because it is a
 * place the first implementation of the same overlay got WRONG on the app side,
 * and the embed is a separate bundle that cannot import the fixed version.
 */
describe('anchorStyle', () => {
  it('pins a corner by its two edges', () => {
    expect(anchorStyle('top-left')).toMatchObject({ top: 8, left: 8 })
    expect(anchorStyle('bottom-right')).toMatchObject({ bottom: 8, right: 8 })
  })

  it('centres along an axis by pinning BOTH opposing edges', () => {
    // Pinning one edge and hoping is how a "centered" overlay ends up hugging
    // the left of every tile.
    expect(anchorStyle('top-center')).toMatchObject({ top: 8, left: 0, right: 0, justifyContent: 'center' })
    expect(anchorStyle('left-center')).toMatchObject({ left: 8, top: 0, bottom: 0, alignItems: 'center' })
  })
})

describe('meterOrientation — same adaptive layout as the player', () => {
  it('top-center is a horizontal strip, not a compact corner pill', () => {
    expect(meterOrientation('top-center')).toBe('horizontal')
    expect(meterOrientation('bottom-center')).toBe('horizontal')
    expect(meterSegmentSize('horizontal', 0)).toEqual({ width: 8, height: 16 })
    expect(meterRenderOrder('horizontal')).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('side-centres are a vertical strip that lights bottom → top', () => {
    expect(meterOrientation('left-center')).toBe('vertical')
    expect(meterRenderOrder('vertical')).toEqual([5, 4, 3, 2, 1, 0])
  })

  it('corners stay the compact pill', () => {
    expect(meterOrientation('top-left')).toBe('compact')
    expect(meterSegmentSize('compact', 0).height).toBeLessThan(meterSegmentSize('compact', 5).height)
  })
})

describe('dbfsToLevel', () => {
  it('lights nothing before the first reading', () => {
    expect(dbfsToLevel(null)).toBe(0)
    expect(dbfsToLevel(Number.NaN)).toBe(0)
  })

  it('climbs the ladder and saturates at the top', () => {
    expect(dbfsToLevel(-90)).toBe(0)
    expect(dbfsToLevel(-60)).toBe(1)
    expect(dbfsToLevel(-42)).toBe(3)
    expect(dbfsToLevel(0)).toBe(AUDIO_LEVEL_STEPS)
  })
})

describe('parseMotionRegions', () => {
  const frame = { deviceId: 1, detected: true, frameWidth: 640, frameHeight: 360 }

  it('NORMALISES the pixel bboxes with the frame dimensions', () => {
    // The app's first version treated the numbers as already normalised and
    // expected x1/y1/x2/y2 — every region was rejected and nothing ever drew.
    const regions = parseMotionRegions({
      ...frame,
      regions: [{ bbox: { x: 320, y: 180, w: 64, h: 36 }, pixelCount: 500 }],
    })
    expect(regions).toEqual([{ x: 0.5, y: 0.5, w: 0.1, h: 0.1, pixelCount: 500 }])
  })

  it('draws nothing without frame dimensions to divide by', () => {
    expect(parseMotionRegions({ ...frame, frameWidth: 0, regions: [{ bbox: { x: 1, y: 1, w: 2, h: 2 } }] })).toEqual([])
  })

  it('draws nothing while motion is not detected', () => {
    expect(
      parseMotionRegions({ ...frame, detected: false, regions: [{ bbox: { x: 0, y: 0, w: 8, h: 8 } }] }),
    ).toEqual([])
  })

  it('skips malformed regions instead of dropping the frame', () => {
    const regions = parseMotionRegions({
      ...frame,
      regions: [{ bbox: { x: 0, y: 0, w: 0, h: 10 } }, { nope: true }, { bbox: { x: 64, y: 36, w: 64, h: 36 } }],
    })
    expect(regions).toHaveLength(1)
  })

  it('survives anything at all', () => {
    expect(parseMotionRegions(null)).toEqual([])
    expect(parseMotionRegions('nope')).toEqual([])
  })
})

describe('regionAlpha', () => {
  it('ramps with the changed-pixel count and stays context, never subject', () => {
    expect(regionAlpha(0)).toBeCloseTo(0.08)
    expect(regionAlpha(4000)).toBeLessThanOrEqual(0.28)
    expect(regionAlpha(1_000_000)).toBeCloseTo(0.28)
  })
})

describe('parseOccupancyCounts', () => {
  it('sorts by count, highest first, then by class name', () => {
    const counts = parseOccupancyCounts({ frame: { byClass: { vehicle: 1, person: 3, animal: 1 } } })
    expect(counts).toEqual([
      { className: 'person', count: 3 },
      { className: 'animal', count: 1 },
      { className: 'vehicle', count: 1 },
    ])
  })

  it('treats an absent cap or an unframed camera as an empty strip', () => {
    expect(parseOccupancyCounts(null)).toEqual([])
    expect(parseOccupancyCounts({})).toEqual([])
    expect(parseOccupancyCounts({ frame: { byClass: {} } })).toEqual([])
  })

  it('drops zero and non-numeric counts rather than drawing "person 0"', () => {
    expect(parseOccupancyCounts({ frame: { byClass: { person: 0, cat: 'two' } } })).toEqual([])
  })

  it('accepts an occupancy-changed event payload with byClass at the top level', () => {
    expect(parseOccupancyCounts({ byClass: { person: 2, vehicle: 1 } })).toEqual([
      { className: 'person', count: 2 },
      { className: 'vehicle', count: 1 },
    ])
  })
})

describe('framesPerSecond', () => {
  it('is the frame delta over the elapsed window', () => {
    expect(framesPerSecond(100, 130, 1000)).toBe(30)
    expect(framesPerSecond(100, 115, 2000)).toBe(8)
  })

  it('never divides by zero and never reports a negative rate', () => {
    expect(framesPerSecond(100, 130, 0)).toBe(0)
    expect(framesPerSecond(130, 100, 1000)).toBe(0)
  })
})

describe('statsLine', () => {
  it('reads as one line, and mentions dropped frames only when there are some', () => {
    expect(statsLine({ resolution: '1920x1080', fps: 15, dropped: 0 })).toBe('1920x1080 · 15fps')
    expect(statsLine({ resolution: '1920x1080', fps: 15, dropped: 4 })).toBe('1920x1080 · 15fps · 4 dropped')
  })

  it('says something before the first sample', () => {
    expect(statsLine(null)).toBe('—')
  })
})

describe('isOverlayAnchor', () => {
  it('accepts the eight anchors and rejects off / nonsense', () => {
    expect(isOverlayAnchor('bottom-right')).toBe(true)
    expect(isOverlayAnchor('off')).toBe(false)
    expect(isOverlayAnchor(undefined)).toBe(false)
  })
})

describe('occupancy tile is event-driven', () => {
  it('seeds once and follows occupancy-changed — no interval', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../components/TileIndicators.tsx'),
      'utf8',
    )
    expect(src).toContain('ZoneAnalyticsOccupancyChanged')
    expect(src).not.toContain('OCCUPANCY_POLL_MS')
    expect(src).toContain('queryCurrentSnapshot')
  })
})
