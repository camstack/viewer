import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MOTION_COLOR, AUDIO_COLOR } from '../event-highlights.js'

/**
 * The right-edge activity column must speak the same language as the 24h tape.
 * It used to paint motion as BAND.motion (info/blue) and audio as
 * BAND.audioGradient[1] (warning/amber) — swapped vs the tape and vs the
 * filter chips, which already use these two constants.
 */

const THEATER = join(process.cwd(), 'src', 'components', 'camera', 'theater')
const read = (f: string): string => readFileSync(join(THEATER, f), 'utf8')

describe('ActivityLanes shares the tape palette', () => {
  const src = read('ActivityLanes.tsx')
  const tape = read('HeatmapBar.tsx')

  it('paints audio in the theme cyan (opacity by level) and motion with the theme token', () => {
    expect(src).toContain("from './event-highlights.js'")
    expect(src).toContain('colors.laneMotion')
    expect(src).toContain('audioPeakColor(b.intensity, colors.laneAudio)')
    expect(tape).toContain("from './event-highlights.js'")
    expect(MOTION_COLOR).toBe('#16a34a')
    expect(AUDIO_COLOR).toBe('#06b6d4')
  })

  it('does not keep the swapped BAND.motion / audioGradient hues', () => {
    expect(src).not.toContain('BAND.motion')
    expect(src).not.toContain('audioGradient')
  })

  it('keeps recording on the danger/red token the tape uses', () => {
    expect(src).toContain('BAND.recording')
  })

  it('paints the audio column without a border that would eat the 2px fill', () => {
    const audio = src.slice(src.indexOf('audioLane:'), src.indexOf('detectionDot:'))
    expect(audio).not.toContain('borderWidth')
    expect(audio).not.toContain('borderColor')
  })

  it('is three vertical lanes: audio, recording, motion+dots (the header icons\' order)', () => {
    expect(src).toContain('audioLane')
    expect(src).toContain('motionLane')
    expect(src).toContain('recordingLane')
    expect(src).toContain('detectionDot')
    expect(src).toContain("laneMarkLeft('audio'")
    expect(src.indexOf("laneMarkLeft('audio'")).toBeLessThan(src.indexOf("laneMarkLeft('recording'"))
    expect(src.indexOf("laneMarkLeft('recording'")).toBeLessThan(src.indexOf("laneMarkLeft('motion'"))
    expect(src).not.toContain('audioHairline')
    expect(src).not.toContain('motionFill')
  })
})

describe('the timeline legend shows the live-meter audio scale', () => {
  it('shows the cyan level scale (the lane\'s hue, rising opacity) for heatmap and timeline audio', () => {
    const legend = read('TimelineLegendPanel.tsx')
    expect(legend).toContain('audioScaleColors(colors.laneAudio)')
    expect(legend).not.toContain('AUDIO_LEVEL_COLORS')
    expect(legend).toContain('shape="scale"')
    expect(legend).not.toContain('AUDIO_COLOR')
  })

  it('labels each swatch with a name only — no explanatory body copy', () => {
    const legend = read('TimelineLegendPanel.tsx')
    expect(legend).not.toContain('Body')
    expect(legend).not.toContain('body={')
    expect(legend).not.toContain('styles.body')
  })
})
