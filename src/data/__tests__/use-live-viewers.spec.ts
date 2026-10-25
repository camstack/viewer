import { describe, it, expect } from 'vitest'
import { parseLiveViewerCounts, viewersFor } from '../use-live-viewers.js'

describe('parseLiveViewerCounts', () => {
  it('turns the hub list into a per-camera record', () => {
    expect(
      parseLiveViewerCounts([
        { deviceId: 4, viewers: 1 },
        { deviceId: 9, viewers: 3 },
      ]),
    ).toEqual({ 4: 1, 9: 3 })
  })

  it('is an EMPTY record for an empty list — a real "nobody watches anything"', () => {
    expect(parseLiveViewerCounts([])).toEqual({})
  })

  it('is null — unknown — for anything that is not a list', () => {
    expect(parseLiveViewerCounts(null)).toBeNull()
    expect(parseLiveViewerCounts(undefined)).toBeNull()
    expect(parseLiveViewerCounts({ deviceId: 4, viewers: 1 })).toBeNull()
    expect(parseLiveViewerCounts('3')).toBeNull()
  })

  it('drops malformed rows and keeps the good ones', () => {
    expect(
      parseLiveViewerCounts([
        { deviceId: 4, viewers: 2 },
        { deviceId: -1, viewers: 2 },
        { deviceId: 5, viewers: 0 },
        { deviceId: 6, viewers: Number.NaN },
        { deviceId: '7', viewers: 2 },
        null,
        'x',
      ]),
    ).toEqual({ 4: 2 })
  })
})

describe('viewersFor', () => {
  it('is the number for a listed camera', () => {
    expect(viewersFor({ 4: 2 }, 4)).toBe(2)
  })

  it('is 0 for a camera missing from a SUCCESSFUL answer', () => {
    expect(viewersFor({ 4: 2 }, 9)).toBe(0)
    expect(viewersFor({}, 9)).toBe(0)
  })

  it('is null — never 0 — when there was no answer', () => {
    expect(viewersFor(null, 9)).toBeNull()
  })
})
