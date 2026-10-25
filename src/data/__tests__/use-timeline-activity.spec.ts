import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Heatmap audio used to come from `getAudioEvents` (hard cap 1000, newest).
 * A busy day has more than that, so the tape's audio hairline only painted
 * the evening. `getEventDensity.audio` is already fetched for motion and is
 * uncapped — the tape must use that.
 */

const src = readFileSync(
  join(process.cwd(), 'src', 'data', 'use-timeline-activity.ts'),
  'utf8',
)

describe('useTimelineActivity heatmap audio is full-day density', () => {
  it('parses motion and audio from getEventDensity', () => {
    expect(src).toContain('parseDensityRows')
    expect(src).toContain('densityToAudioBuckets')
    expect(src).toContain('densityToMotionBuckets')
  })

  it('does not cap the tape at 1000 getAudioEvents rows', () => {
    expect(src).not.toContain('getAudioEvents')
    expect(src).not.toContain('audioEventsToBuckets')
    expect(src).not.toContain('limit: 1000')
  })
})
