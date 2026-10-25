import { describe, it, expect } from 'vitest'
import {
  groupEventsByFrame,
  toDetailDetection,
  summarizeCluster,
  containRect,
  bboxToScreen,
} from '../cluster-detail.js'
import type { DetailDetection } from '../cluster-detail.js'

function det(o: Partial<DetailDetection> & { id: string; timestamp: number }): DetailDetection {
  return { className: 'person', zones: [], ...o }
}

describe('groupEventsByFrame', () => {
  it('groups detections that share a timestamp into one frame', () => {
    const frames = groupEventsByFrame([
      det({ id: 'a', timestamp: 1000, className: 'person' }),
      det({ id: 'b', timestamp: 1000, className: 'car' }),
      det({ id: 'c', timestamp: 2000, className: 'dog' }),
    ])
    expect(frames).toHaveLength(2)
    // newest first
    expect(frames[0].timestamp).toBe(2000)
    expect(frames[1].timestamp).toBe(1000)
    expect(frames[1].detections.map((d) => d.id)).toEqual(['a', 'b'])
  })

  it('picks the first detection WITH media as the frame image', () => {
    const frames = groupEventsByFrame([
      det({ id: 'a', timestamp: 1000 }), // no media
      det({ id: 'b', timestamp: 1000, mediaUrl: 'https://x/b.jpg' }),
    ])
    expect(frames[0].imageDetectionId).toBe('b')
    expect(frames[0].imageMediaUrl).toBe('https://x/b.jpg')
  })

  it('falls back to the first detection id (no mediaUrl) so base64 can be fetched', () => {
    const frames = groupEventsByFrame([
      det({ id: 'a', timestamp: 1000 }),
      det({ id: 'b', timestamp: 1000 }),
    ])
    // imageDetectionId is set (for getEventMedia by id) even with no mediaUrl
    expect(frames[0].imageDetectionId).toBe('a')
    expect(frames[0].imageMediaUrl).toBeUndefined()
  })

  it('returns [] for empty input', () => {
    expect(groupEventsByFrame([])).toEqual([])
  })
})

describe('toDetailDetection', () => {
  it('parses a full-projection row', () => {
    const d = toDetailDetection({
      id: 'e1', timestamp: 1000, className: 'person', label: 'mario',
      confidence: 0.83, zones: ['driveway', 'gate'], state: 'entered',
      trackId: 't1', mediaUrl: 'https://x/e1.jpg',
    })
    expect(d).not.toBeNull()
    expect(d).toEqual({
      id: 'e1', timestamp: 1000, className: 'person', label: 'mario',
      confidence: 0.83, zones: ['driveway', 'gate'], state: 'entered',
      trackId: 't1', mediaUrl: 'https://x/e1.jpg',
    })
  })

  it('defaults zones to [] and drops non-string zone entries', () => {
    const d = toDetailDetection({ id: 'e2', timestamp: 1, className: 'car', zones: ['a', 5, null] })
    expect(d?.zones).toEqual(['a'])
  })

  it('returns null for malformed rows', () => {
    expect(toDetailDetection({ timestamp: 1, className: 'x' })).toBeNull()
    expect(toDetailDetection(null)).toBeNull()
    expect(toDetailDetection({ id: 'e', timestamp: 'no', className: 'x' })).toBeNull()
  })

  it('parses bbox + frame dimensions (full projection)', () => {
    const d = toDetailDetection({
      id: 'e3', timestamp: 1, className: 'person',
      bbox: { x: 10, y: 20, w: 30, h: 40 }, frameWidth: 1920, frameHeight: 1080,
    })
    expect(d?.bbox).toEqual({ x: 10, y: 20, w: 30, h: 40 })
    expect(d?.frameWidth).toBe(1920)
    expect(d?.frameHeight).toBe(1080)
  })

  it('drops a malformed bbox to undefined', () => {
    expect(toDetailDetection({ id: 'e4', timestamp: 1, className: 'car', bbox: { x: 1, y: 2 } })?.bbox).toBeUndefined()
    expect(toDetailDetection({ id: 'e5', timestamp: 1, className: 'car', bbox: null })?.bbox).toBeUndefined()
  })
})

describe('containRect', () => {
  it('letterboxes a 16:9 frame in a square container (pillarbox top/bottom)', () => {
    // 1920x1080 into 400x400 → scale 0.2083, rendered 400x225, centered.
    const r = containRect(1920, 1080, 400, 400)
    expect(r.width).toBeCloseTo(400, 5)
    expect(r.height).toBeCloseTo(225, 5)
    expect(r.left).toBeCloseTo(0, 5)
    expect(r.top).toBeCloseTo(87.5, 5)
  })

  it('falls back to the full container on degenerate inputs', () => {
    expect(containRect(0, 1080, 400, 300)).toEqual({ left: 0, top: 0, width: 400, height: 300 })
  })
})

describe('bboxToScreen', () => {
  it('scales + offsets a pixel-space bbox onto the rendered image rect', () => {
    const image = { left: 0, top: 87.5, width: 400, height: 225 } // 1920x1080 contained
    // A box at frame (960,540,192,108) → half-frame origin, 10% size.
    const r = bboxToScreen({ x: 960, y: 540, w: 192, h: 108 }, 1920, 1080, image)
    expect(r.left).toBeCloseTo(200, 5)
    expect(r.top).toBeCloseTo(87.5 + 112.5, 5)
    expect(r.width).toBeCloseTo(40, 5)
    expect(r.height).toBeCloseTo(22.5, 5)
  })
})

describe('summarizeCluster', () => {
  it('summarizes distinct classes, count, and span', () => {
    const frames = groupEventsByFrame([
      det({ id: 'a', timestamp: 1000, className: 'person' }),
      det({ id: 'b', timestamp: 1000, className: 'car' }),
      det({ id: 'c', timestamp: 3000, className: 'person' }),
    ])
    const s = summarizeCluster(frames)
    expect(s.classes).toEqual(['person', 'car'])
    expect(s.detectionCount).toBe(3)
    expect(s.startMs).toBe(1000)
    expect(s.endMs).toBe(3000)
  })

  it('handles empty frames', () => {
    expect(summarizeCluster([])).toEqual({ classes: [], detectionCount: 0, startMs: 0, endMs: 0 })
  })
})
