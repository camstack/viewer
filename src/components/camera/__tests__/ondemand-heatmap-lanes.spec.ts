/**
 * The on-demand overlay's day tape draws every lane it can afford, not just
 * recordings.
 *
 * The overlay mounts the SAME `HeatmapBar` the theater does, and that strip has
 * four channels: the recording hairline, the motion fill, the detection fill
 * and the audio peaks. The overlay fed it `bins={NO_BINS}` — a module-level
 * empty array — so three of the four had nothing to draw and the tape showed
 * the hairline alone. The operator read that as "the heatmap only loads
 * recordings", which is precisely what it was doing.
 *
 * Motion and audio come from ONE cheap aggregate (`getEventDensity`, via
 * `useTimelineActivity`), on the same device and day window the camera screen
 * has already cached — so the lanes cost this surface a cache hit in the
 * ordinary case. The DETECTION lane is deliberately still absent here: it comes
 * from `useDeviceTracks`, which this repo prices at ~374 KB for a busy camera's
 * day and defers behind `timelineReady` even on the full screen. A floating
 * 256pt panel does not open that. That exclusion is named, not silent.
 *
 * Source text, because the claim is about what this surface FEEDS.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

describe('the on-demand overlay feeds its tape the density lanes', () => {
  const player = read('src/components/camera/OnDemandPlayer.tsx')

  it('no longer hands the strip a constant empty bin array', () => {
    expect(player).not.toContain('NO_BINS')
  })

  it('asks the density aggregate and composes the bins through the shared builder', () => {
    expect(player).toContain('useTimelineActivity')
    expect(player).toContain('composeHeatmapBins')
  })

  it('feeds both density lanes — a half-fed tape is the defect being fixed', () => {
    expect(player).toMatch(/motion:\s*activity\.motion/)
    expect(player).toMatch(/audio:\s*activity\.audio/)
  })
})

describe('and the composition is shared, not copied', () => {
  it('the theater builds its bins through the same one function', () => {
    const theater = read('src/components/camera/theater/TheaterTimeline.tsx')
    expect(theater).toContain('composeHeatmapBins')
    // The inline three-step assembly is gone — two surfaces, one derivation.
    expect(theater).not.toContain('objectEventsToHeatmapBins(')
    expect(theater).not.toContain('mergeMotionIntoHeatmapBins(')
  })
})
