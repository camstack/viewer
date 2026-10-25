/**
 * The gallery's pure geometry and grouping — what a list item is, how tall it
 * is, which day it sits under. The list never measures a tile, so these numbers
 * ARE the layout.
 */
import { describe, expect, it } from 'vitest'
import {
  buildGalleryItems,
  GALLERY_GAP,
  GALLERY_HEADER_HEIGHT,
  galleryItemHeight,
  NO_TILE_DETAILS,
  thumbPxForEdge,
  tileDetailsHeight,
  tileEdgeFor,
} from '../events-gallery-layout.js'
import type { EventsTrackRow } from '../../../../../shared/events/events-track-row.js'

/** 2026-09-01 14:35 local — a mid-afternoon anchor. */
const ANCHOR = new Date(2026, 8, 1, 14, 35, 0, 0).getTime()
const HOUR = 3_600_000
const DAY = 24 * HOUR

function row(id: string, lastSeen: number): EventsTrackRow {
  return {
    trackId: id, deviceId: 1, cameraName: 'Gate', className: 'person', firstSeen: lastSeen - 5_000, lastSeen,
    state: 'idle', active: false, zonesVisited: [], zoneNames: [], classes: ['person'], audioLabels: [], bestEventId: id,
  }
}

describe('tileEdgeFor', () => {
  it('divides the width minus the gaps evenly, rounding DOWN so the last tile never overflows', () => {
    // 390 wide, 4 columns, 3 gaps of 2 → (390 - 6) / 4 = 96
    expect(tileEdgeFor(390, 4)).toBe(96)
    expect(tileEdgeFor(391, 4) * 4 + GALLERY_GAP * 3).toBeLessThanOrEqual(391)
  })

  it('is 0 until there is a width, never NaN or negative', () => {
    expect(tileEdgeFor(0, 4)).toBe(0)
    expect(tileEdgeFor(Number.NaN, 4)).toBe(0)
    expect(tileEdgeFor(300, 0)).toBe(0)
  })
})

describe('tileDetailsHeight — the block under a tile', () => {
  it('is 0 with every detail off: the default grid is pictures only', () => {
    expect(tileDetailsHeight(NO_TILE_DETAILS)).toBe(0)
  })

  it('grows with each enabled line, deterministically', () => {
    const one = tileDetailsHeight({ camera: true, zone: false })
    const two = tileDetailsHeight({ camera: true, zone: true })
    expect(one).toBeGreaterThan(0)
    expect(two).toBeGreaterThan(one)
  })
})

describe('galleryItemHeight', () => {
  it('a header is its own fixed height; a row is the tile, its details and the gap', () => {
    const header = { type: 'header', key: 'h', dayOffset: 0, count: 1 } as const
    const gridRow = { type: 'row', key: 'r', rows: [row('a', ANCHOR)] } as const
    expect(galleryItemHeight(header, 96, 40)).toBe(GALLERY_HEADER_HEIGHT)
    expect(galleryItemHeight(gridRow, 96, 40)).toBe(96 + 40 + GALLERY_GAP)
  })
})

describe('buildGalleryItems', () => {
  /** No day is named by a filter row: every day gets its header. */
  const NO_NAMED_DAY = -1
  const rows = [
    row('a', ANCHOR - 1 * HOUR),
    row('b', ANCHOR - 2 * HOUR),
    row('c', ANCHOR - 3 * HOUR),
    row('d', ANCHOR - DAY - HOUR),
    row('e', ANCHOR - DAY - 2 * HOUR),
  ]

  it('chunks rows into grid rows of `columns` under a header per DAY, newest first', () => {
    const items = buildGalleryItems({ rows, columns: 2, anchorMs: ANCHOR, exhausted: true, namedDayOffset: NO_NAMED_DAY })
    expect(items.map((i) => i.type)).toEqual(['header', 'row', 'row', 'header', 'row'])
    const headers = items.filter((i) => i.type === 'header')
    expect(headers.map((h) => (h.type === 'header' ? h.dayOffset : -1))).toEqual([0, 1])
    const gridRows = items.filter((i) => i.type === 'row')
    expect(gridRows.map((r) => (r.type === 'row' ? r.rows.map((x) => x.trackId) : []))).toEqual([['a', 'b'], ['c'], ['d', 'e']])
  })

  it('gives the day the filter row names NO header of its own — older days keep theirs as separators', () => {
    // The page names "Today" and counts the events under its filter row; a
    // second "Today · 3 events" over the first tiles said it twice.
    const today = buildGalleryItems({ rows, columns: 2, anchorMs: ANCHOR, exhausted: true, namedDayOffset: 0 })
    expect(today.map((i) => i.type)).toEqual(['row', 'row', 'header', 'row'])
    expect(today.filter((i) => i.type === 'header').map((h) => (h.type === 'header' ? h.dayOffset : -1))).toEqual([1])
    // Browsing yesterday: its own header goes, today's (newer, above it) stays.
    const yesterday = buildGalleryItems({ rows, columns: 2, anchorMs: ANCHOR, exhausted: true, namedDayOffset: 1 })
    expect(yesterday.filter((i) => i.type === 'header').map((h) => (h.type === 'header' ? h.dayOffset : -1))).toEqual([0])
  })

  it('a grid row never straddles two days', () => {
    // `c` ends the first day alone even though a second tile would fit.
    const items = buildGalleryItems({ rows, columns: 4, anchorMs: ANCHOR, exhausted: true, namedDayOffset: NO_NAMED_DAY })
    const sizes = items.filter((i) => i.type === 'row').map((r) => (r.type === 'row' ? r.rows.length : 0))
    expect(sizes).toEqual([3, 2])
  })

  it('counts the days that are COMPLETE, and withholds the count of the day still paging in', () => {
    // A count that then grows would read as the day changing under the operator.
    const paging = buildGalleryItems({ rows, columns: 2, anchorMs: ANCHOR, exhausted: false, namedDayOffset: NO_NAMED_DAY })
    const counts = paging.filter((i) => i.type === 'header').map((h) => (h.type === 'header' ? h.count : -1))
    expect(counts).toEqual([3, null])
    const done = buildGalleryItems({ rows, columns: 2, anchorMs: ANCHOR, exhausted: true, namedDayOffset: NO_NAMED_DAY })
    expect(done.filter((i) => i.type === 'header').map((h) => (h.type === 'header' ? h.count : -1))).toEqual([3, 2])
  })

  it('is empty for no rows', () => {
    expect(buildGalleryItems({ rows: [], columns: 4, anchorMs: ANCHOR, exhausted: true, namedDayOffset: NO_NAMED_DAY })).toEqual([])
  })

  it('keys are stable across a prepend: the same track keeps its row key', () => {
    const before = buildGalleryItems({ rows: rows.slice(1), columns: 1, anchorMs: ANCHOR, exhausted: true, namedDayOffset: NO_NAMED_DAY })
    const after = buildGalleryItems({ rows, columns: 1, anchorMs: ANCHOR, exhausted: true, namedDayOffset: NO_NAMED_DAY })
    const keysBefore = before.filter((i) => i.type === 'row').map((i) => i.key)
    const keysAfter = after.filter((i) => i.type === 'row').map((i) => i.key)
    for (const key of keysBefore) expect(keysAfter).toContain(key)
  })
})

describe('thumbPxForEdge', () => {
  it('rounds UP to a 32 px bucket so a tile is never blurry and neighbouring layouts share a cache entry', () => {
    expect(thumbPxForEdge(96, 3)).toBe(288) // 288 exactly
    expect(thumbPxForEdge(97, 3)).toBe(320) // 291 → next bucket
    expect(thumbPxForEdge(96, 2)).toBe(192)
  })

  it('survives a nonsense ratio', () => {
    expect(thumbPxForEdge(96, 0)).toBe(96)
    expect(thumbPxForEdge(96, Number.NaN)).toBe(96)
  })
})
