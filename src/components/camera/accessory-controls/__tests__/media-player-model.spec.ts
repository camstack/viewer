import { describe, expect, it } from 'vitest'
import { parseMediaPlayerStatus } from '../../../../data/use-accessory-controls-ext.js'
import {
  isPlaying,
  mediaPlayerFeatureFlags,
  powerCommandFor,
  powerOf,
  titleText,
  volumeLevelText,
  volumeViewOf,
} from '../media-player-model.js'

const infrared = {
  state: 'on',
  stateSource: 'assumed',
  assumedFields: ['state'],
  volumeLevel: null,
  isMuted: null,
  source: '',
  currentMedia: null,
}

describe('parseMediaPlayerStatus', () => {
  it('an unknown state stays unknown — it is never idle', () => {
    expect(parseMediaPlayerStatus({ ...infrared, state: 'wat' })?.state).toBeUndefined()
    expect(parseMediaPlayerStatus({})?.state).toBeUndefined()
    expect(parseMediaPlayerStatus(null)).toBeNull()
  })
  it('a missing volume level is null, not 0', () => {
    expect(parseMediaPlayerStatus(infrared)?.volumeLevel).toBeNull()
    expect(parseMediaPlayerStatus({ ...infrared, volumeLevel: 35 })?.volumeLevel).toBe(35)
  })
})

describe('what is drawn', () => {
  it('step volume only for a player with steps and no level', () => {
    const steps = mediaPlayerFeatureFlags(['media-player-volume-step'])
    expect(volumeViewOf(steps)).toBe('steps')
    expect(volumeViewOf(mediaPlayerFeatureFlags(['media-player-volume-step', 'media-player-volume']))).toBe('none')
    expect(volumeViewOf(mediaPlayerFeatureFlags(['media-player-volume']))).toBe('none')
    expect(volumeViewOf(mediaPlayerFeatureFlags(undefined))).toBe('none')
  })
  it('power follows the state; unknown offers no guess', () => {
    expect(powerOf(undefined)).toBe('unknown')
    expect(powerOf('standby')).toBe('standby')
    expect(powerOf('playing')).toBe('on')
    expect(powerCommandFor('on')).toBe('turnOff')
    expect(powerCommandFor('off')).toBe('turnOn')
    expect(powerCommandFor('unknown')).toBeNull()
  })
  it('only playing and buffering mean "pause"', () => {
    expect(isPlaying(undefined)).toBe(false)
    expect(isPlaying('idle')).toBe(false)
    expect(isPlaying('buffering')).toBe(true)
  })
  it('unknown values draw nothing', () => {
    const s = (over: object) => parseMediaPlayerStatus({ ...infrared, ...over })
    expect(volumeLevelText(s({}))).toBeNull()
    expect(volumeLevelText(s({ volumeLevel: 0 }))).toBe('0%')
    expect(titleText(s({}))).toBeNull()
    expect(titleText(s({ currentMedia: { title: '  ' } }))).toBeNull()
    expect(titleText(s({ currentMedia: { title: 'News' } }))).toBe('News')
  })
})
