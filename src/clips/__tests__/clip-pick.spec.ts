import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { clipAtEpoch, clipDayCoverage } from '../clip-pick.js'
import type { Clip } from '../clip-model.js'

/**
 * The day strip over a body of FILES.
 *
 * `clips-surface.ts` withdraws everything that MEASURES a body with no time
 * axis — the playhead, the timeline drag. The strip is not one of those: a
 * file carries a wall-clock start, so the day addresses it, and the operator
 * asked for the jump — *"la heatmap rimane con i salti verso le clip dove si è
 * cliccato"*. This pins what the press resolves to, and that the bands drawn
 * and the press's target come from ONE list.
 */

function clip(over: Partial<Clip> = {}): Clip {
  return {
    clipId: 'c1',
    deviceId: 107,
    startMs: 1_000,
    endMs: 31_000,
    sourceId: 'native:reolink:onboard',
    kind: 'motion',
    playback: { kind: 'native', deviceId: 107, clipId: 'c1' },
    ...over,
  }
}

describe('clipAtEpoch — the file under the finger', () => {
  const a = clip({ clipId: 'a', startMs: 10_000, endMs: 20_000 })
  const b = clip({ clipId: 'b', startMs: 50_000, endMs: 60_000 })

  it('returns the clip whose interval CONTAINS the instant', () => {
    expect(clipAtEpoch([a, b], 15_000)?.clipId).toBe('a')
    expect(clipAtEpoch([a, b], 55_000)?.clipId).toBe('b')
  })

  it('counts both edges as inside — a press on a band edge is a press on the band', () => {
    expect(clipAtEpoch([a, b], 10_000)?.clipId).toBe('a')
    expect(clipAtEpoch([a, b], 20_000)?.clipId).toBe('a')
  })

  it('lands on the NEAREST file when the instant is between two', () => {
    // A press on empty tape must not swallow itself: a control that does
    // nothing is indistinguishable from an app that hung (`clip-tap.ts`).
    expect(clipAtEpoch([a, b], 25_000)?.clipId).toBe('a')
    expect(clipAtEpoch([a, b], 45_000)?.clipId).toBe('b')
  })

  it('lands on the nearest file when the instant is outside the whole day of them', () => {
    expect(clipAtEpoch([a, b], 0)?.clipId).toBe('a')
    expect(clipAtEpoch([a, b], 999_000)?.clipId).toBe('b')
  })

  it('never returns a row the provider REFUSED', () => {
    // A press that produces a refusal is a control that fails. The row keeps
    // its card and its reason; the strip simply does not aim at it — the rule
    // `clipStageStep` already follows for prev/next.
    const refused = clip({ clipId: 'x', startMs: 12_000, endMs: 13_000, playable: false })
    expect(clipAtEpoch([refused, a], 12_500)?.clipId).toBe('a')
    expect(clipAtEpoch([refused], 12_500)).toBeNull()
  })

  it('answers null only when there is nothing playable at all', () => {
    expect(clipAtEpoch([], 15_000)).toBeNull()
  })
})

describe('clipDayCoverage — the bands are the FILES', () => {
  it('gives one band per playable file, in epoch ms', () => {
    const a = clip({ clipId: 'a', startMs: 10_000, endMs: 20_000 })
    const b = clip({ clipId: 'b', startMs: 50_000, endMs: 60_000 })
    expect(clipDayCoverage([a, b])).toEqual([
      { startMs: 10_000, endMs: 20_000 },
      { startMs: 50_000, endMs: 60_000 },
    ])
  })

  it('draws nothing for a refused row — the strip and the press aim at one set', () => {
    const refused = clip({ clipId: 'x', startMs: 10_000, endMs: 20_000, playable: false })
    expect(clipDayCoverage([refused])).toEqual([])
    expect(clipAtEpoch([refused], 15_000)).toBeNull()
  })

  it('drops a degenerate span rather than drawing a hairline at the wrong minute', () => {
    expect(clipDayCoverage([clip({ startMs: 10_000, endMs: 10_000 })])).toEqual([])
    expect(clipDayCoverage([clip({ startMs: 10_000, endMs: 9_000 })])).toEqual([])
  })
})

/**
 * …and the timeline really wires it.
 *
 * A pure resolver nothing calls is the failure this directory has already
 * shipped twice (`clips-surface-consumed.spec.ts` exists for it). The three
 * lines below are the whole substitution: the strip is drawn, its bands are
 * the files, and its press opens one.
 */
describe('TheaterTimeline substitutes the strip rather than removing it', () => {
  const timeline = readFileSync(
    join(process.cwd(), 'src/components/camera/theater/TheaterTimeline.tsx'),
    'utf8',
  )
    // Comments stripped: this file EXPLAINS the substitution at length, and a
    // scan that reads prose would pass on the explanation alone.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  it('draws the strip on every surface but the one that has no target', () => {
    expect(timeline).toContain("dayStrip={clipsSurface.heatmap !== 'none'}")
  })

  it('routes the press to the FILE when the body is a list of them', () => {
    expect(timeline).toContain("clipsSurface.heatmap === 'pickClip'")
    expect(timeline).toContain('pickClips ? handlePickFraction : handleSeekFraction')
  })

  it('draws the FILES as the bands, not our recorder tape', () => {
    expect(timeline).toContain('pickClips ? clipBands : coverage')
    expect(timeline).toContain('clipDayCoverage(stripClips)')
    expect(timeline).toContain('clipAtEpoch(stripClips,')
  })
})
