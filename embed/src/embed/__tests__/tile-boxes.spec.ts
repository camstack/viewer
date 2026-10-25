import { describe, it, expect } from 'vitest'
import type { FrameResult, ObjectDetection } from '@camstack/types'
import { normalizeFrameBoxes, tileBoxColor, TILE_BOXES_FADE_MS } from '../tile-boxes'

function det(overrides: Partial<ObjectDetection>): ObjectDetection {
  return {
    id: 'd1',
    kind: 'first-level',
    macroClass: 'person',
    score: 0.9,
    labels: [],
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    ...overrides,
  }
}

function frame(detections: readonly ObjectDetection[], width = 640, height = 360): FrameResult {
  return {
    kind: 'frame',
    frameId: 'f1',
    deviceId: 7,
    timestamp: 1,
    width,
    height,
    detections,
  }
}

describe('normalizeFrameBoxes', () => {
  it('normalizes pixel bboxes to 0..1 edges against the frame size', () => {
    const boxes = normalizeFrameBoxes(
      frame([det({ bbox: { x: 64, y: 36, width: 320, height: 180 } })]),
    )
    expect(boxes).toEqual([{ label: 'person', score: 0.9, x1: 0.1, y1: 0.1, x2: 0.6, y2: 0.6 }])
  })

  it('clamps boxes that overflow the frame to the 0..1 range', () => {
    const boxes = normalizeFrameBoxes(
      frame([det({ bbox: { x: -64, y: 180, width: 1280, height: 999 } })]),
    )
    expect(boxes).toEqual([{ label: 'person', score: 0.9, x1: 0, y1: 0.5, x2: 1, y2: 1 }])
  })

  it('drops degenerate boxes (zero area after clamping)', () => {
    const boxes = normalizeFrameBoxes(
      frame([
        det({ bbox: { x: 10, y: 10, width: 0, height: 50 } }),
        det({ bbox: { x: 700, y: 10, width: 50, height: 50 } }), // fully off-frame
      ]),
    )
    expect(boxes).toEqual([])
  })

  it('returns no boxes for a degenerate frame (zero dimensions)', () => {
    expect(normalizeFrameBoxes(frame([det({})], 0, 0))).toEqual([])
  })

  it('carries the macro class + score of every detection', () => {
    const boxes = normalizeFrameBoxes(
      frame([
        det({ macroClass: 'person', score: 0.9 }),
        det({ macroClass: 'vehicle', score: 0.5, bbox: { x: 320, y: 180, width: 64, height: 36 } }),
      ]),
    )
    expect(boxes.map((b) => [b.label, b.score])).toEqual([
      ['person', 0.9],
      ['vehicle', 0.5],
    ])
  })
})

describe('tileBoxColor', () => {
  it('maps known classes to distinct colors and unknowns to the fallback', () => {
    expect(tileBoxColor('person')).not.toBe(tileBoxColor('vehicle'))
    expect(tileBoxColor('mystery')).toBe(tileBoxColor('other-mystery'))
  })
})

describe('TILE_BOXES_FADE_MS', () => {
  it('is a short positive idle window', () => {
    expect(TILE_BOXES_FADE_MS).toBeGreaterThan(0)
    expect(TILE_BOXES_FADE_MS).toBeLessThanOrEqual(10_000)
  })
})
