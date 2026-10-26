import { describe, it, expect } from 'vitest'
import { audioScaleColors, getPaletteView, paintKind } from '../../../../../shared/palette.js'
import { audioPeakColor, heatmapBinLayers, objectEventsToHeatmapBins } from '../event-highlights.js'
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

const view = getPaletteView()
const motion = paintKind(view, 'motion')
const audio = paintKind(view, 'audio')

describe('theater activity palette', () => {
  it('paints motion and audio from the palette as different colours', () => {
    expect(motion).toMatch(/^#[0-9a-f]{6}$/i)
    expect(audio).toMatch(/^#[0-9a-f]{6}$/i)
    expect(motion).not.toBe(audio)
  })
})

describe('audioPeakColor', () => {
  it('is the palette audio hex: pale when quiet, saturated when loud', () => {
    const scale = audioScaleColors(view)
    expect(audioPeakColor(0)).toBe(scale[0])
    expect(audioPeakColor(1)).toBe(scale[scale.length - 1])
    expect(scale[0]?.startsWith(audio)).toBe(true)
  })

  it('every rung is the base hue at a rising opacity — never another hue', () => {
    const rungs = audioScaleColors(view)
    expect(rungs).toHaveLength(6)
    const alphas = rungs.map((c) => {
      expect(c.startsWith(audio)).toBe(true)
      return parseInt(c.slice(audio.length), 16)
    })
    expect([...alphas].sort((a, b) => a - b)).toEqual(alphas)
    expect(new Set(alphas).size).toBe(6)
  })
})

describe('heatmapBinLayers', () => {
  it('fills the bottom with motion when there is no detection', () => {
    const layers = heatmapBinLayers(bin({ motion: 0.8 }))
    expect(layers.bottom?.color).toBe(motion)
    expect(layers.bottom?.heightPct).toBeGreaterThan(0)
    expect(layers.audio).toBeNull()
  })

  it('fills the bottom with the prominent class when detections are present', () => {
    const person = paintKind(view, 'person')
    const layers = heatmapBinLayers(bin({ motion: 0.9, detection: 0.5, detectionColor: person }))
    expect(layers.bottom?.color).toBe(person)
  })

  it('hangs audio peaks from the top, colored by intensity', () => {
    const layers = heatmapBinLayers(bin({ audio: 0.7 }))
    expect(layers.audio?.heightPct).toBeGreaterThan(0)
    expect(layers.audio?.color).toBe(audioPeakColor(0.7))
  })

  it('leaves an empty bin empty', () => {
    expect(heatmapBinLayers(bin({}))).toEqual({ bottom: null, audio: null })
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
    expect(bins[1].detectionColor).toBe(paintKind(view, 'vehicle'))
  })
})
