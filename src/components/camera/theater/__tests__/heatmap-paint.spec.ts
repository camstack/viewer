import { describe, it, expect } from 'vitest'
import { getClassColor } from '../../detection-colors.js'
import {
  MOTION_COLOR,
  AUDIO_COLOR,
  audioPeakColor,
  audioScaleColors,
  heatmapBinLayers,
  objectEventsToHeatmapBins,
} from '../event-highlights.js'
import { HEATMAP_BINS } from '../mock-data.js'
import type { HeatmapBin } from '../mock-data.js'

function bin(over: Partial<HeatmapBin>): HeatmapBin {
  return {
    motion: 0,
    detection: 0,
    audio: 0,
    recorded: false,
    ...over,
  }
}

describe('theater activity palette', () => {
  it('paints motion green and recording stays the danger red token elsewhere', () => {
    expect(MOTION_COLOR).toBe('#16a34a')
    expect(AUDIO_COLOR).toBe('#06b6d4')
  })
})

const CYAN = '#06b6d4'

describe('audioPeakColor', () => {
  it('is the lane\'s own cyan: pale when quiet, saturated when loud', () => {
    expect(audioPeakColor(0, CYAN)).toBe('#06b6d44d')
    expect(audioPeakColor(0.1, CYAN)).toBe('#06b6d44d')
    expect(audioPeakColor(1, CYAN)).toBe('#06b6d4ff')
  })

  it('every rung is the base hue at a rising opacity — never another hue', () => {
    const rungs = audioScaleColors(CYAN)
    expect(rungs).toHaveLength(6)
    const alphas = rungs.map((c) => {
      expect(c.startsWith(CYAN)).toBe(true)
      return parseInt(c.slice(7), 16)
    })
    expect([...alphas].sort((a, b) => a - b)).toEqual(alphas)
    expect(new Set(alphas).size).toBe(6)
  })
})

describe('heatmapBinLayers', () => {
  it('fills the bottom with motion green when there is no detection', () => {
    const layers = heatmapBinLayers(bin({ motion: 0.8 }), CYAN)
    expect(layers.bottom?.color).toBe(MOTION_COLOR)
    expect(layers.bottom?.heightPct).toBeGreaterThan(0)
    expect(layers.audio).toBeNull()
  })

  it('fills the bottom with the prominent class when detections are present', () => {
    const person = getClassColor('person')
    const layers = heatmapBinLayers(bin({ motion: 0.9, detection: 0.5, detectionColor: person }), CYAN)
    expect(layers.bottom?.color).toBe(person)
  })

  it('hangs audio peaks from the top, colored by intensity', () => {
    const layers = heatmapBinLayers(bin({ audio: 0.7 }), CYAN)
    expect(layers.audio?.heightPct).toBeGreaterThan(0)
    expect(layers.audio?.color).toBe(audioPeakColor(0.7, CYAN))
  })

  it('leaves an empty bin empty', () => {
    expect(heatmapBinLayers(bin({}), CYAN)).toEqual({ bottom: null, audio: null })
  })
})

describe('objectEventsToHeatmapBins — prominent class is the macro', () => {
  it('collapses car/truck into vehicle so the fill uses the macro color', () => {
    const start = new Date('2026-08-01T00:00:00').getTime()
    const binMs = (24 * 3600_000) / HEATMAP_BINS
    const toMacro = new Map([
      ['car', 'vehicle'],
      ['truck', 'vehicle'],
      ['vehicle', 'vehicle'],
      ['person', 'person'],
    ])
    const bins = objectEventsToHeatmapBins(
      [
        { id: 'a', timestamp: start + binMs + 1000, className: 'car' },
        { id: 'b', timestamp: start + binMs + 2000, className: 'truck' },
      ],
      start,
      toMacro,
    )
    expect(bins[1].detectionColor).toBe(getClassColor('vehicle'))
  })
})
