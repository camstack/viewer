import { describe, it, expect } from 'vitest'
import {
  addVertex,
  moveVertex,
  isClosable,
  toNormalizedPolygon,
  fitContain,
  toFrameLocal,
} from '../polygon-draw.js'

describe('polygon-draw', () => {
  it('normalizes pixel vertices against the box into 0..1 MaskPolygonShape', () => {
    const verts = [
      { x: 50, y: 25 },
      { x: 150, y: 25 },
      { x: 100, y: 75 },
    ]
    const poly = toNormalizedPolygon(verts, { width: 200, height: 100 })
    expect(poly).toEqual({
      kind: 'polygon',
      points: [
        { x: 0.25, y: 0.25 },
        { x: 0.75, y: 0.25 },
        { x: 0.5, y: 0.75 },
      ],
    })
  })

  it('is closable only with >= 3 vertices', () => {
    expect(isClosable([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(false)
    expect(isClosable([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }])).toBe(true)
  })

  it('clamps out-of-box vertices into the 0..1 range', () => {
    const poly = toNormalizedPolygon([{ x: -10, y: 250 }], { width: 200, height: 100 })
    expect(poly.points).toEqual([{ x: 0, y: 1 }])
  })

  it('returns an empty polygon for a degenerate box', () => {
    expect(toNormalizedPolygon([{ x: 5, y: 5 }], { width: 0, height: 100 })).toEqual({
      kind: 'polygon',
      points: [],
    })
  })

  it('addVertex appends immutably', () => {
    const verts = [{ x: 1, y: 1 }]
    const next = addVertex(verts, { x: 2, y: 2 })
    expect(next).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }])
    expect(verts).toEqual([{ x: 1, y: 1 }]) // original untouched
  })

  it('moveVertex replaces one vertex immutably; out-of-range index is a no-op', () => {
    const verts = [{ x: 1, y: 1 }, { x: 2, y: 2 }]
    const moved = moveVertex(verts, 1, { x: 9, y: 9 })
    expect(moved).toEqual([{ x: 1, y: 1 }, { x: 9, y: 9 }])
    expect(verts).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }])
    expect(moveVertex(verts, 5, { x: 0, y: 0 })).toEqual(verts)
    expect(moveVertex(verts, -1, { x: 0, y: 0 })).toEqual(verts)
  })
})

describe('fitContain — letterbox math', () => {
  it('landscape frame in a square container is pillar/letterboxed by height', () => {
    // 16:9 frame in a 100x100 container → width-constrained.
    const box = fitContain({ width: 100, height: 100 }, 1600, 900)
    expect(box.width).toBe(100)
    expect(box.height).toBeCloseTo(56.25, 5)
    expect(box.offsetX).toBe(0)
    expect(box.offsetY).toBeCloseTo((100 - 56.25) / 2, 5)
  })

  it('portrait frame in a landscape container is letterboxed by width', () => {
    // 9:16 frame in a 200x100 container → height-constrained.
    const box = fitContain({ width: 200, height: 100 }, 900, 1600)
    expect(box.height).toBe(100)
    expect(box.width).toBeCloseTo(56.25, 5)
    expect(box.offsetY).toBe(0)
    expect(box.offsetX).toBeCloseTo((200 - 56.25) / 2, 5)
  })

  it('a matching aspect fills the whole container with no offset', () => {
    const box = fitContain({ width: 320, height: 180 }, 1920, 1080)
    expect(box).toEqual({ offsetX: 0, offsetY: 0, width: 320, height: 180 })
  })

  it('a degenerate frame falls back to filling the container', () => {
    expect(fitContain({ width: 200, height: 100 }, 0, 0)).toEqual({
      offsetX: 0,
      offsetY: 0,
      width: 200,
      height: 100,
    })
  })
})

describe('toFrameLocal — container touch → letterboxed-image-local px', () => {
  const box = { offsetX: 20, offsetY: 10, width: 160, height: 80 }

  it('subtracts the letterbox offset', () => {
    expect(toFrameLocal({ x: 100, y: 50 }, box)).toEqual({ x: 80, y: 40 })
  })

  it('clamps a touch in the letterbox bars onto the image edge', () => {
    expect(toFrameLocal({ x: 5, y: 5 }, box)).toEqual({ x: 0, y: 0 })
    expect(toFrameLocal({ x: 500, y: 500 }, box)).toEqual({ x: 160, y: 80 })
  })
})
