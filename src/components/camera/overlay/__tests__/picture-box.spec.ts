import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pictureRectIn, placeNormalizedBox } from '../picture-box.js'

/**
 * Live boxes on a panoramic camera (4256×1888, ≈2.25:1) were drawn offset
 * VERTICALLY from their subjects. The player letterboxes (`object-fit:
 * contain`) the picture inside a 16:9 box, and the overlays scaled the
 * normalised box by the whole box — bands included.
 */
const PANORAMIC = 4256 / 1888
const PHONE_16_9: { width: number; height: number } = { width: 390, height: (390 * 9) / 16 }

describe('pictureRectIn — the letterboxed picture', () => {
  it('puts a ≈2.25:1 frame in a 16:9 box with a band above and below', () => {
    const r = pictureRectIn(PHONE_16_9, PANORAMIC)
    expect(r.x).toBe(0)
    expect(r.width).toBe(390)
    expect(r.height).toBeCloseTo(390 / PANORAMIC, 6)
    expect(r.y).toBeCloseTo((PHONE_16_9.height - 390 / PANORAMIC) / 2, 6)
    expect(r.y).toBeGreaterThan(10)
  })

  it('is the whole box for a 16:9 stream', () => {
    const r = pictureRectIn(PHONE_16_9, 16 / 9)
    expect(r.x).toBeCloseTo(0, 9)
    expect(r.y).toBeCloseTo(0, 9)
    expect(r.width).toBeCloseTo(390, 9)
    expect(r.height).toBeCloseTo(PHONE_16_9.height, 9)
  })

  it('puts a 4:3 frame in a 16:9 box with bands left and right', () => {
    const r = pictureRectIn({ width: 1600, height: 900 }, 4 / 3)
    expect(r.y).toBe(0)
    expect(r.height).toBe(900)
    expect(r.width).toBeCloseTo(1200, 9)
    expect(r.x).toBeCloseTo(200, 9)
  })
})

describe('placeNormalizedBox — a detection over the picture, not the bands', () => {
  it('lands a panoramic detection on the picture in a 16:9 box (aspect mismatch)', () => {
    const picture = pictureRectIn(PHONE_16_9, PANORAMIC)
    // A person spanning the lower half of the frame.
    const r = placeNormalizedBox({ x1: 0.4, y1: 0.5, x2: 0.5, y2: 1 }, picture)
    const pictureH = 390 / PANORAMIC
    const band = (PHONE_16_9.height - pictureH) / 2
    expect(r.x).toBeCloseTo(156, 6)
    expect(r.width).toBeCloseTo(39, 6)
    expect(r.y).toBeCloseTo(band + 0.5 * pictureH, 6)
    expect(r.height).toBeCloseTo(0.5 * pictureH, 6)
    // The bottom edge is the picture's bottom edge, never the box's.
    expect(r.y + r.height).toBeCloseTo(band + pictureH, 6)
    expect(r.y + r.height).toBeLessThan(PHONE_16_9.height - 10)
  })

  it('offsets by the side bands of a contain fit', () => {
    const picture = pictureRectIn({ width: 1600, height: 900 }, 4 / 3)
    const r = placeNormalizedBox({ x1: 0, y1: 0, x2: 1, y2: 1 }, picture)
    expect(r).toEqual(picture)
  })

  it('is the plain scale when the picture fills the box', () => {
    const r = placeNormalizedBox(
      { x1: 0.25, y1: 0.25, x2: 0.75, y2: 0.75 },
      { x: 0, y: 0, width: 200, height: 100 },
    )
    expect(r).toEqual({ x: 50, y: 25, width: 100, height: 50 })
  })
})

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('every live box overlay maps onto the picture', () => {
  const overlays = [
    'components/camera/MotionBoxesOverlay.tsx',
    'components/camera/StationaryBoxesOverlay.tsx',
    'components/camera/DiscardedBoxesOverlay.tsx',
    'components/camera/MotionRegionsOverlay.tsx',
  ]
  for (const rel of overlays) {
    it(`${rel} follows the stream aspect and places through the picture`, () => {
      const src = read(rel)
      expect(src).toContain('useStreamAspect(deviceId)')
      expect(src).toContain('pictureRectIn(')
      expect(src).toContain('placeNormalizedBox(')
      // The old mapping: a normalised coordinate times the whole container.
      expect(src).not.toMatch(/\*\s*(size|box)\.(width|height)\b/)
    })
  }
})
