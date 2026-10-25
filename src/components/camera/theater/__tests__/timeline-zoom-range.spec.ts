/**
 * The timeline's zoom is ONE control, it offers exactly five ranges, and the
 * active one is legible without opening it.
 *
 * One floating pill: `−` · the current range · `+`. The label IS the value (the
 * operator used to infer it from the height of the rows) and opens the menu of
 * Auto plus the presets; the steppers walk the SAME presets and clamp at the
 * ends (`timeline-zoom-step.spec.ts`), so there is still one ladder.
 *
 * The ladder itself is asserted in the operator's units, not in indices: an
 * index is an implementation detail and renumbering it (which is exactly what
 * adding the fifth level did) must not be able to change what the menu offers.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ZOOM_LEVELS,
  DEFAULT_ZOOM_INDEX,
  zoomSpanLabel,
  zoomIndicesByRange,
  type ZoomSpanLabel,
} from '../mock-data.js'
import { formatZoomSpan, type ZoomSpanTranslator } from '../zoom-range-label.js'

const THEATER = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOCALES = join(THEATER, '..', '..', '..', '..', 'locales')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** `v2.theater` out of a shipped locale file, without casting through it. */
function theaterKeys(file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(LOCALES, file), 'utf8'))
  if (!isRecord(parsed)) return {}
  const v2 = parsed.v2
  if (!isRecord(v2)) return {}
  const theater = v2.theater
  return isRecord(theater) ? theater : {}
}

function read(file: string): string {
  return readFileSync(join(THEATER, file), 'utf8')
}

/** A `t` that renders the shipped English patterns, so the assertion is on the
 *  string an operator sees rather than on a key name. */
const t: ZoomSpanTranslator = (key, options) => {
  if (key === 'v2.theater.zoomSpanMinutes') return `${options.count}m`
  if (key === 'v2.theater.zoomSpanHours') return `${options.count}h`
  return key
}

/** The menu's labels, in the order the menu lists them. */
function selectorLabels(): readonly string[] {
  return zoomIndicesByRange().map((index) => formatZoomSpan(zoomSpanLabel(index), t))
}

describe('the range ladder is exactly what the operator asked for', () => {
  it('offers 15m · 30m · 1h · 3h · 6h · 12h, shortest first', () => {
    expect(selectorLabels()).toEqual(['15m', '30m', '1h', '3h', '6h', '12h'])
  })

  it('offers six concrete ranges (Auto is a mode, not a seventh span)', () => {
    expect(ZOOM_LEVELS).toHaveLength(6)
    expect(zoomIndicesByRange()).toHaveLength(6)
  })

  it('lists every level exactly once', () => {
    expect([...zoomIndicesByRange()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('a sub-hour range reads in MINUTES, never as 0.25h / 0.5h', () => {
    const shortest = zoomIndicesByRange()[0]
    const label: ZoomSpanLabel = zoomSpanLabel(shortest)
    expect(label).toEqual({ value: 15, unit: 'minutes' })
  })

  it('orders by RANGE, not by the ladder’s internal index order', () => {
    const byRange = zoomIndicesByRange()
    const spans = byRange.map((index) => ZOOM_LEVELS[index].spanHours)
    expect([...spans]).toEqual([...spans].sort((a, b) => a - b))
  })
})

describe('the ACTIVE range is readable without opening the selector', () => {
  it('every level has a label the chip can show', () => {
    for (const index of zoomIndicesByRange()) {
      expect(formatZoomSpan(zoomSpanLabel(index), t)).toMatch(/^\d+(m|h)$/)
    }
  })

  it('the default level names itself', () => {
    expect(formatZoomSpan(zoomSpanLabel(DEFAULT_ZOOM_INDEX), t)).toBe('30m')
  })

  it('the chip draws the VALUE, not a glyph', () => {
    // The whole point of collapsing the pair: the button IS the current range.
    // While Auto is engaged the value is the Auto label; otherwise the span.
    const bar = read('TimelineFloatingTools.tsx')
    expect(bar).toContain('{rangeLabel}')
    expect(bar).toContain("zoomMode === 'auto'")
  })

  it('Auto is a menu row and exits when a fixed span is picked', () => {
    const bar = read('TimelineFloatingTools.tsx')
    expect(bar).toContain("value: 'auto'")
    expect(bar).toContain("t('v2.theater.zoomAuto')")
    expect(bar).toContain("onZoomModeChange('fixed')")
  })
})

describe('the host exposes zoom handlers for index and Auto mode', () => {
  it('wires them to the floating tools', () => {
    const host = read('TheaterTimeline.tsx')
    expect(host).toContain('onZoomIndexChange: handleZoomIndexChange')
    expect(host).toContain('onZoomModeChange: handleZoomModeChange')
    expect(host).toContain('zoomMode')
  })

  it('the range translations are in both locales, the old stepper words are not', () => {
    for (const file of ['en.json', 'it.json']) {
      const theater = theaterKeys(file)
      expect(theater.zoomIn, file).toBeUndefined()
      expect(theater.zoomOut, file).toBeUndefined()
      expect(theater.zoomShorter, file).toBeDefined()
      expect(theater.zoomLonger, file).toBeDefined()
      expect(theater.zoomRange, file).toBeDefined()
      expect(theater.zoomAuto, file).toBe('Auto')
    }
  })

  it('the range menu opens ABOVE the bar — the bar sits at the bottom of the body', () => {
    const bar = read('TimelineFloatingTools.tsx')
    expect(bar).not.toMatch(/\bAnchoredDropdown\b/)
    expect(bar).not.toMatch(/\.measureInWindow\b/)
    expect(bar).toContain("bottom: '100%'")
    expect(bar).toContain('zoomAnchor')
  })
})
