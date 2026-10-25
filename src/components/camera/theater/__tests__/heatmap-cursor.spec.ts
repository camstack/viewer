import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  heatmapCursorGeometry,
  HEATMAP_BAND_HEIGHT_PX,
  HEATMAP_CURSOR_OVERSHOOT_PX,
  HEATMAP_CURSOR_STEM_WIDTH_PX,
  HEATMAP_HOUR_LABELS_HEIGHT_PX,
  HEATMAP_HOUR_MARKS,
  HEATMAP_TAPE_HEIGHT_PX,
} from '../heatmap-cursor.js'

/**
 * The current-moment marker on the 24h strip, pinned by SHAPE.
 *
 * How it reads is a paint fact and this repo has no renderer, so there is no
 * honest test of "is it visible". What IS testable, and what actually regressed,
 * is the geometric claim underneath: the marker is distinguished from the strip's
 * ticks by leaving the band, not by being a different colour. A later edit that
 * pulls it back inside the band, or drops the caps, restores the complaint
 * exactly — and every such edit has to move a number these lines hold.
 */

const THEATER = join(process.cwd(), 'src', 'components', 'camera', 'theater')
const read = (f: string): string => readFileSync(join(THEATER, f), 'utf8')

describe('heatmap cursor geometry', () => {
  const g = heatmapCursorGeometry()

  it('the activity band is a single NVR tape, not four stacked lanes', () => {
    expect(HEATMAP_TAPE_HEIGHT_PX).toBeGreaterThanOrEqual(28)
    expect(HEATMAP_TAPE_HEIGHT_PX).toBeLessThanOrEqual(36)
    expect(HEATMAP_BAND_HEIGHT_PX).toBe(HEATMAP_TAPE_HEIGHT_PX)
    expect(HEATMAP_HOUR_MARKS).toEqual([0, 6, 12, 18])
    expect(HEATMAP_HOUR_LABELS_HEIGHT_PX).toBeGreaterThanOrEqual(12)
  })

  it('leaves the activity band at BOTH ends', () => {
    // The whole distinction. One-sided would read as a tick with a tail.
    expect(HEATMAP_CURSOR_OVERSHOOT_PX).toBeGreaterThan(0)
    expect(g.markerHeightPx).toBe(HEATMAP_BAND_HEIGHT_PX + 2 * HEATMAP_CURSOR_OVERSHOOT_PX)
    expect(g.stripHeightPx).toBeGreaterThan(HEATMAP_BAND_HEIGHT_PX)
    expect(g.bandInsetPx).toBe(HEATMAP_CURSOR_OVERSHOOT_PX)
  })

  it('the overshoot is paid inside the container, never as a negative inset', () => {
    // Band content inset by the overshoot at each end leaves the band its own
    // height — so the marker's extra pixels live INSIDE the parent and no
    // platform gets to clip them. Hour labels sit BELOW that, so the strip is
    // taller than the marker.
    expect(g.markerHeightPx).toBe(HEATMAP_BAND_HEIGHT_PX + 2 * HEATMAP_CURSOR_OVERSHOOT_PX)
    expect(g.stripHeightPx).toBe(g.markerHeightPx + HEATMAP_HOUR_LABELS_HEIGHT_PX)
    expect(g.stripHeightPx - 2 * g.bandInsetPx - HEATMAP_HOUR_LABELS_HEIGHT_PX).toBe(
      HEATMAP_BAND_HEIGHT_PX,
    )
  })

  it('the caps are wider than the stem and wider than any tick on the strip', () => {
    // The strip's own marks are 2px verticals (event ticks) and %-wide coverage
    // bands. Nothing on it has a wide cap, which is why the cap is the feature
    // the eye finds.
    const EVENT_TICK_WIDTH_PX = 2
    expect(g.capWidthPx).toBeGreaterThan(g.stemWidthPx)
    expect(g.capWidthPx).toBeGreaterThan(EVENT_TICK_WIDTH_PX)
    expect(g.capHeightPx).toBeGreaterThan(0)
    // The caps sit in the overshoot, i.e. outside the band.
    expect(g.capHeightPx).toBeLessThanOrEqual(HEATMAP_CURSOR_OVERSHOOT_PX)
  })

  it('the halo outlines the stem without becoming a second stem', () => {
    expect(g.haloWidthPx).toBeGreaterThan(g.stemWidthPx)
    // An outline, not a widening: a halo as wide as a cap would just add to the
    // noise the marker is currently lost in.
    expect(g.haloWidthPx).toBeLessThan(g.capWidthPx)
  })

  it('does NOT get its distinction from being thicker', () => {
    // Stated so a future "make it more visible" reflex has to argue with it: the
    // stem stays tick-thin. Weight was never the problem — the strip is already
    // full of things this wide.
    expect(g.stemWidthPx).toBe(HEATMAP_CURSOR_STEM_WIDTH_PX)
    expect(g.stemWidthPx).toBeLessThanOrEqual(2)
  })

  it('centres the marker on its fraction', () => {
    // The old cursor had no centering offset while the event ticks did, so it
    // sat half its width to the right of the moment it claimed to mark.
    expect(g.centeringOffsetPx).toBe(-g.capWidthPx / 2)
  })
})

describe('the strip actually draws that marker', () => {
  const src = read('HeatmapBar.tsx')

  it('derives its geometry from the module, not from re-typed numbers', () => {
    expect(src).toContain("from './heatmap-cursor.js'")
    expect(src).toContain('heatmapCursorGeometry()')
  })

  it('draws both caps and the halo', () => {
    expect(src).toContain('cursorCapTop')
    expect(src).toContain('cursorCapBottom')
    expect(src).toContain('cursorHalo')
    expect(src).toContain('cursorStem')
  })

  it('insets the TAPE so the recording hairline can occupy the top overshoot', () => {
    // The tape body is inset by the cursor-cap overshoot; recording is a
    // hairline in that gap, not a translucent body behind the marker.
    expect(src).toContain('bandInsetPx')
    expect(src).toContain('styles.recordingRow')
  })

  it('refuses to yield the responder so a parent ScrollView cannot steal a scrub', () => {
    // Capture-phase handlers do NOT stop an ancestor ScrollView — they only
    // block descendants, and every child here is already pointer-inert.
    // The real hold is: refuse termination, and commit on terminate anyway.
    expect(src).toContain('onResponderTerminationRequest')
    expect(src).toContain('onResponderTerminate')
    expect(src).not.toContain('onStartShouldSetResponderCapture')
    expect(src).not.toContain('onMoveShouldSetResponderCapture')
  })

  it('keeps the marker pointer-inert', () => {
    // The strip is interactive and `locationX` is measured against the touch
    // TARGET — a marker that accepts touches makes a tap on it seek to ~midnight,
    // the bug the surrounding comment in HeatmapBar already records.
    const marker = src.slice(src.indexOf('{/* Current-moment marker'))
    expect(marker).toContain('pointerEvents="none"')
  })

  it('paints recording as a top hairline, audio as shadowed peaks, bottom as motion-or-class fill', () => {
    expect(src).not.toContain('HEATMAP_LANES')
    expect(src).toContain('styles.tape')
    expect(src).toContain('styles.recordingHairline')
    expect(src).toContain('BAND.recording')
    expect(src).toContain('styles.bottomFill')
    expect(src).toContain('styles.audioPeak')
    expect(src).toContain('boxShadow')
    expect(src).not.toContain('styles.audioPeakShadow')
    expect(src).not.toContain('styles.audioHairline')
    expect(src).not.toContain('styles.detectionTick')
    expect(src).toContain('heatmapBinLayers')
    expect(src).toContain('styles.hourLabel')
    expect(src).toContain('HEATMAP_HOUR_MARKS')
  })
})
