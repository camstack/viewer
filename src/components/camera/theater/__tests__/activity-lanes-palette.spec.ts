import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The right-edge activity column must speak the same language as the 24h tape:
 * both read the hub display palette. It used to paint motion as BAND.motion
 * and audio as BAND.audioGradient[1] — swapped vs the tape.
 */

const THEATER = join(process.cwd(), 'src', 'components', 'camera', 'theater')
const read = (f: string): string => readFileSync(join(THEATER, f), 'utf8')

describe('ActivityLanes shares the tape palette', () => {
  const src = read('ActivityLanes.tsx')
  const tape = read('HeatmapBar.tsx')

  it('paints motion, recording and audio from the palette', () => {
    expect(src).toContain("from '../../../../shared/palette.js'")
    expect(src).toContain("paint('motion')")
    expect(src).toContain("paint('recording')")
    expect(src).toContain('audioPeakColor(b.intensity)')
    expect(src).not.toContain('colors.laneMotion')
    expect(src).not.toContain('colors.laneAudio')
    expect(tape).toContain("paint('recording')")
    expect(tape).toContain('heatmapBinLayers(bin)')
  })

  it('does not keep the swapped BAND.motion / audioGradient hues', () => {
    expect(src).not.toContain('BAND.motion')
    expect(src).not.toContain('audioGradient')
    expect(src).not.toContain('BAND.recording')
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
  it('shows the palette audio scale (rising opacity) for heatmap and timeline audio', () => {
    const legend = read('TimelineLegendPanel.tsx')
    expect(legend).toContain('audioScaleColors()')
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
