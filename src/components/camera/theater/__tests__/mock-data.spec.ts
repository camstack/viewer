import { describe, it, expect } from 'vitest'
import {
  buildHeatmapBins,
  buildTimelineRows,
  buildTimelineRowsAtZoom,
  buildTimelineRowsPage,
  clampZoomIndex,
  DEFAULT_ZOOM_INDEX,
  filterHeatmapBins,
  filterTimelineRows,
  heatmapCursorFraction,
  isFilterAll,
  rowsPerSpan,
  snapTopTickMs,
  ALL_BAR_KINDS,
  HEATMAP_BINS,
  ZOOM_LEVELS,
  type ActivityFilter,
  type HeatmapBin,
  type TimelineBarKind,
  type TimelineRow,
} from '../mock-data.js'

/** Ordinary local day (not a DST boundary): 2026-06-17 @ 19:23. */
function refNow(): number {
  return new Date(2026, 5, 17, 19, 23, 0, 0).getTime()
}

describe('buildHeatmapBins', () => {
  it('returns exactly HEATMAP_BINS normalized bins', () => {
    const bins = buildHeatmapBins(refNow())
    expect(bins).toHaveLength(HEATMAP_BINS)
    for (const bin of bins) {
      expect(bin.motion).toBeGreaterThanOrEqual(0)
      expect(bin.motion).toBeLessThanOrEqual(1)
      expect(bin.audio).toBeGreaterThanOrEqual(0)
      expect(bin.audio).toBeLessThanOrEqual(1)
      expect(typeof bin.recorded).toBe('boolean')
    }
  })

  it('marks the bin containing "now" as recorded and the final bin as not recorded', () => {
    const bins: readonly HeatmapBin[] = buildHeatmapBins(refNow())
    // 19:23 → bin 38 (19:00–19:30). Coverage runs up to "now" only.
    expect(bins[38].recorded).toBe(true)
    expect(bins[HEATMAP_BINS - 1].recorded).toBe(false)
  })

  it('is deterministic for a fixed nowMs', () => {
    const a = buildHeatmapBins(1_700_000_000_000)
    const b = buildHeatmapBins(1_700_000_000_000)
    expect(a).toEqual(b)
  })

  it('on 2026-10-25 the live edge is the calendar bin (39 when the day is 25 h)', () => {
    const t = new Date(2026, 9, 25, 19, 23, 0, 0).getTime()
    const start = new Date(2026, 9, 25).getTime()
    const end = new Date(2026, 9, 26).getTime()
    const nowBin = Math.min(HEATMAP_BINS - 1, Math.floor(((t - start) / (end - start)) * HEATMAP_BINS))
    const bins = buildHeatmapBins(t)
    // 20 h 23 min / 25 h × 48 = 39.136. A flat 24 h span lands in bin 40.
    if (end - start === 25 * 3_600_000) expect(nowBin).toBe(39)
    expect(bins[nowBin].recorded).toBe(true)
    for (let i = nowBin + 1; i < HEATMAP_BINS; i++) {
      expect(bins[i].motion).toBe(0)
      expect(bins[i].audio).toBe(0)
      expect(bins[i].recorded).toBe(false)
    }
  })

  it('shows no activity in FUTURE bins (right of "now")', () => {
    // 19:23 → nowBin 38. Bins after it are the future: no motion/audio bars,
    // no coverage — the bar chart must stop at the live cursor, not overrun it.
    const bins = buildHeatmapBins(refNow())
    for (let i = 39; i < HEATMAP_BINS; i++) {
      expect(bins[i].motion).toBe(0)
      expect(bins[i].audio).toBe(0)
      expect(bins[i].recorded).toBe(false)
    }
  })
})

describe('heatmapCursorFraction', () => {
  it('maps 19:23 on an ordinary day to about 0.808 of the 24 h strip', () => {
    const frac = heatmapCursorFraction(refNow())
    // 19:23 / 24 h ≈ 0.8076.
    expect(frac).toBeGreaterThan(0.8)
    expect(frac).toBeLessThan(0.82)
  })

  it('noon on an ordinary day (2026-06-17) is half the strip (12/24)', () => {
    expect(heatmapCursorFraction(new Date(2026, 5, 17, 12, 0, 0, 0).getTime())).toBeCloseTo(12 / 24, 10)
  })

  it('noon on 2026-10-25 is 13/25 when that day lasts 25 h, else elapsed/span', () => {
    const noon = new Date(2026, 9, 25, 12, 0, 0, 0).getTime()
    const start = new Date(2026, 9, 25).getTime()
    const end = new Date(2026, 9, 26).getTime()
    expect(heatmapCursorFraction(noon)).toBeCloseTo((noon - start) / (end - start), 10)
    if (end - start === 25 * 3_600_000) expect(heatmapCursorFraction(noon)).toBeCloseTo(13 / 25, 10)
  })

  it('19:23 on 2026-10-25 is 20 h 23 min / 25 h when that day lasts 25 h', () => {
    const t = new Date(2026, 9, 25, 19, 23, 0, 0).getTime()
    const start = new Date(2026, 9, 25).getTime()
    const end = new Date(2026, 9, 26).getTime()
    expect(heatmapCursorFraction(t)).toBeCloseTo((t - start) / (end - start), 10)
    if (end - start === 25 * 3_600_000) {
      expect(t - start).toBe(20 * 3_600_000 + 23 * 60_000)
      expect(heatmapCursorFraction(t)).toBeCloseTo((20 * 3_600_000 + 23 * 60_000) / (25 * 3_600_000), 10)
    }
  })

  it('noon on 2026-03-29 is 11/23 when that day lasts 23 h, else elapsed/span', () => {
    const noon = new Date(2026, 2, 29, 12, 0, 0, 0).getTime()
    const start = new Date(2026, 2, 29).getTime()
    const end = new Date(2026, 2, 30).getTime()
    expect(heatmapCursorFraction(noon)).toBeCloseTo((noon - start) / (end - start), 10)
    if (end - start === 23 * 3_600_000) expect(heatmapCursorFraction(noon)).toBeCloseTo(11 / 23, 10)
  })
})

describe('buildTimelineRows', () => {
  it('returns newest-first rows with valid bar geometry', () => {
    const rows: readonly TimelineRow[] = buildTimelineRows(refNow())
    expect(rows.length).toBeGreaterThan(0)
    // Newest first: the first row's label is the live edge SNAPPED DOWN to the
    // default zoom's row granularity. Derived, not spelled: the literal used
    // to be '19:20' and said nothing except that the default row was 5 minutes
    // wide, so changing the default range broke it for no reason a reader
    // could see.
    const rowMs = ZOOM_LEVELS[DEFAULT_ZOOM_INDEX].rowMinutes * 60_000
    const snapped = new Date(Math.floor(refNow() / rowMs) * rowMs)
    const pad = (n: number): string => String(n).padStart(2, '0')
    expect(rows[0].hourLabel).toBe(`${pad(snapped.getHours())}:${pad(snapped.getMinutes())}`)
    for (const row of rows) {
      expect(row.id).toMatch(/^row-\d+$/)
      expect(row.hourLabel).toMatch(/^\d{2}:\d{2}$/)
      for (const bar of row.bars) {
        expect(bar.offsetFrac).toBeGreaterThanOrEqual(0)
        expect(bar.widthFrac).toBeGreaterThan(0)
        expect(['motion', 'audio']).toContain(bar.kind)
      }
    }
  })

  it('has unique row ids', () => {
    const rows = buildTimelineRows(refNow())
    const ids = new Set(rows.map((r) => r.id))
    expect(ids.size).toBe(rows.length)
  })

  it('matches the default zoom level', () => {
    expect(buildTimelineRows(refNow())).toEqual(
      buildTimelineRowsAtZoom(refNow(), DEFAULT_ZOOM_INDEX),
    )
  })
})

describe('clampZoomIndex', () => {
  it('clamps to the valid range and floors fractional input', () => {
    expect(clampZoomIndex(-5)).toBe(0)
    expect(clampZoomIndex(0)).toBe(0)
    expect(clampZoomIndex(99)).toBe(ZOOM_LEVELS.length - 1)
    expect(clampZoomIndex(1.9)).toBe(1)
  })
})

describe('buildTimelineRowsAtZoom', () => {
  it('produces the row count implied by each zoom level spec', () => {
    ZOOM_LEVELS.forEach((spec, index) => {
      const rows = buildTimelineRowsAtZoom(refNow(), index)
      const expected = Math.round((spec.spanHours * 60) / spec.rowMinutes)
      expect(rows).toHaveLength(expected)
    })
  })

  it('zooms IN to a finer scale: smaller time step, narrower span', () => {
    const coarse = buildTimelineRowsAtZoom(refNow(), 0) // 30-min / 12h
    const fine = buildTimelineRowsAtZoom(refNow(), ZOOM_LEVELS.length - 1) // 1-min / 15m
    expect(ZOOM_LEVELS[ZOOM_LEVELS.length - 1].rowMinutes).toBeLessThan(ZOOM_LEVELS[0].rowMinutes)
    expect(ZOOM_LEVELS[ZOOM_LEVELS.length - 1].spanHours).toBeLessThan(ZOOM_LEVELS[0].spanHours)
    expect(fine.length).toBe(rowsPerSpan(ZOOM_LEVELS.length - 1))
    expect(coarse.length).toBe(rowsPerSpan(0))
    // Finest zoom snaps the top row to the exact minute (no 5/15/30 snap).
    expect(fine[0].hourLabel).toBe('19:23')
    // Coarsest zoom snaps down to the half hour.
    expect(coarse[0].hourLabel).toBe('19:00')
  })

  it('is deterministic for a fixed (nowMs, zoomIndex)', () => {
    const a = buildTimelineRowsAtZoom(1_700_000_000_000, 1)
    const b = buildTimelineRowsAtZoom(1_700_000_000_000, 1)
    expect(a).toEqual(b)
  })

  it('clamps out-of-range zoom indices', () => {
    expect(buildTimelineRowsAtZoom(refNow(), -3)).toEqual(buildTimelineRowsAtZoom(refNow(), 0))
    expect(buildTimelineRowsAtZoom(refNow(), 99)).toEqual(
      buildTimelineRowsAtZoom(refNow(), ZOOM_LEVELS.length - 1),
    )
  })
})

describe('snapTopTickMs / rowsPerSpan', () => {
  it('snaps the live edge DOWN to the row granularity', () => {
    // Coarsest = 30-min rows → 19:23 snaps to 19:00.
    expect(new Date(snapTopTickMs(refNow(), 0)).getMinutes()).toBe(0)
    // Finest = 1-min rows → no snap, stays at 19:23.
    expect(new Date(snapTopTickMs(refNow(), ZOOM_LEVELS.length - 1)).getMinutes()).toBe(23)
  })

  it('reports the row count of one visible span per zoom', () => {
    ZOOM_LEVELS.forEach((spec, index) => {
      expect(rowsPerSpan(index)).toBe(Math.round((spec.spanHours * 60) / spec.rowMinutes))
    })
  })
})

describe('buildTimelineRowsPage', () => {
  it('page 0 equals the seed window from buildTimelineRowsAtZoom', () => {
    ZOOM_LEVELS.forEach((_, index) => {
      expect(buildTimelineRowsPage(refNow(), index, 0)).toEqual(
        buildTimelineRowsAtZoom(refNow(), index),
      )
    })
  })

  it('is deterministic for fixed (nowMs, zoomIndex, pageIndex)', () => {
    const a = buildTimelineRowsPage(1_700_000_000_000, 1, 3)
    const b = buildTimelineRowsPage(1_700_000_000_000, 1, 3)
    expect(a).toEqual(b)
  })

  it('returns pageRows rows (defaulting to one span)', () => {
    expect(buildTimelineRowsPage(refNow(), DEFAULT_ZOOM_INDEX, 0)).toHaveLength(
      rowsPerSpan(DEFAULT_ZOOM_INDEX),
    )
    expect(buildTimelineRowsPage(refNow(), DEFAULT_ZOOM_INDEX, 2, 10)).toHaveLength(10)
  })

  it('clamps negative / fractional page indices to page 0', () => {
    const p0 = buildTimelineRowsPage(refNow(), 1, 0)
    expect(buildTimelineRowsPage(refNow(), 1, -4)).toEqual(p0)
    expect(buildTimelineRowsPage(refNow(), 1, 0.9)).toEqual(p0)
  })

  it('produces strictly OLDER, CONTIGUOUS, gap-free consecutive pages', () => {
    const zoom = DEFAULT_ZOOM_INDEX
    const { rowMinutes } = ZOOM_LEVELS[zoom]
    const stepMs = rowMinutes * 60_000
    const pageRows = 20
    const p0 = buildTimelineRowsPage(refNow(), zoom, 0, pageRows)
    const p1 = buildTimelineRowsPage(refNow(), zoom, 1, pageRows)

    // Last tick of page 0 → first tick of page 1 is exactly one step older.
    const lastTick0 = Number(p0[p0.length - 1].id.replace('row-', ''))
    const firstTick1 = Number(p1[0].id.replace('row-', ''))
    expect(firstTick1).toBe(lastTick0 - stepMs)

    // Whole sequence is strictly descending in time with no duplicate ids.
    const merged = [...p0, ...p1]
    const ticks = merged.map((r) => Number(r.id.replace('row-', '')))
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]).toBe(ticks[i - 1] - stepMs)
    }
    expect(new Set(merged.map((r) => r.id)).size).toBe(merged.length)
  })

  it('keeps ids unique across MANY pages spanning multiple days back', () => {
    const zoom = 0 // 30-min rows, 12h span = 24 rows/page → 30+ pages cross days
    const all: TimelineRow[] = []
    for (let p = 0; p < 30; p++) {
      all.push(...buildTimelineRowsPage(refNow(), zoom, p))
    }
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length)
  })
})

describe('isFilterAll', () => {
  it('is true for empty or fully-selected filters', () => {
    expect(isFilterAll(new Set())).toBe(true)
    expect(isFilterAll(new Set(ALL_BAR_KINDS))).toBe(true)
  })

  it('is false for a partial selection', () => {
    expect(isFilterAll(new Set<TimelineBarKind>(['motion']))).toBe(false)
  })
})

describe('filterTimelineRows', () => {
  it('returns the same reference when showing all', () => {
    const rows = buildTimelineRows(refNow())
    expect(filterTimelineRows(rows, new Set(ALL_BAR_KINDS))).toBe(rows)
  })

  it('drops bars whose kind is deselected', () => {
    const rows = buildTimelineRows(refNow())
    const motionOnly: ActivityFilter = new Set<TimelineBarKind>(['motion'])
    const filtered = filterTimelineRows(rows, motionOnly)
    for (const row of filtered) {
      for (const bar of row.bars) {
        expect(bar.kind).toBe('motion')
      }
    }
    // Some original row had an audio bar that is now gone.
    const hadAudio = rows.some((r) => r.bars.some((b) => b.kind === 'audio'))
    const stillAudio = filtered.some((r) => r.bars.some((b) => b.kind === 'audio'))
    expect(hadAudio).toBe(true)
    expect(stillAudio).toBe(false)
  })
})

describe('filterHeatmapBins', () => {
  it('returns the same reference when showing all', () => {
    const bins = buildHeatmapBins(refNow())
    expect(filterHeatmapBins(bins, new Set(ALL_BAR_KINDS))).toBe(bins)
  })

  it('zeroes the deselected channel but preserves recorded coverage', () => {
    const bins: readonly HeatmapBin[] = buildHeatmapBins(refNow())
    const motionOnly: ActivityFilter = new Set<TimelineBarKind>(['motion'])
    const filtered = filterHeatmapBins(bins, motionOnly)
    filtered.forEach((bin, i) => {
      expect(bin.audio).toBe(0)
      expect(bin.motion).toBe(bins[i].motion)
      expect(bin.recorded).toBe(bins[i].recorded)
    })
  })
})

describe('TimelineRow.tickMs', () => {
  it('exposes the absolute tick epoch encoded in the row id', () => {
    const rows = buildTimelineRowsPage(refNow(), 2, 0)
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) {
      expect(typeof r.tickMs).toBe('number')
      expect(r.id).toBe(`row-${r.tickMs}`)
    }
  })
  it('ticks descend (top row is the most recent)', () => {
    const rows = buildTimelineRowsPage(refNow(), 2, 0)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].tickMs).toBeLessThan(rows[i - 1].tickMs)
    }
  })
})
