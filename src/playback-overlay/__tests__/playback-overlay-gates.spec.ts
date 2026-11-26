import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolvePlaybackGates } from '../playback-overlay-source'

describe('which source an overlay draws from', () => {
  it('live edge, playing: the live feeds', () => {
    const g = resolvePlaybackGates({ isLive: true, paused: false, availability: 'unknown', audioDbfs: null })
    expect(g).toMatchObject({ liveOverlays: true, fromPlayback: false, boxes: true, border: true, occupancy: true, audioMeter: true })
  })
  it('live edge, paused on a poster: nothing', () => {
    const g = resolvePlaybackGates({ isLive: true, paused: true, availability: 'known', audioDbfs: null })
    expect(g).toMatchObject({ liveOverlays: false, fromPlayback: false, boxes: false, occupancy: false, audioMeter: false })
  })
  it('recorded, range known: stored boxes, border and occupancy; no meter without a level', () => {
    const g = resolvePlaybackGates({ isLive: false, paused: false, availability: 'known', audioDbfs: null })
    expect(g).toMatchObject({ fromPlayback: true, boxes: true, border: true, occupancy: true, audioMeter: false })
    expect(resolvePlaybackGates({ isLive: false, paused: false, availability: 'known', audioDbfs: -30 }).audioMeter).toBe(true)
  })
  it('recorded, range unknown: every overlay hidden', () => {
    const g = resolvePlaybackGates({ isLive: false, paused: false, availability: 'unknown', audioDbfs: null })
    expect(g).toMatchObject({ liveOverlays: false, fromPlayback: false, boxes: false, border: false, occupancy: false, audioMeter: false })
  })
})

describe('the screen keeps the layers it has no stored data for live-only', () => {
  const screen = readFileSync(join(__dirname, '../../screens/CameraDetailScreen.tsx'), 'utf8')
  it('regions, parked and discarded stay behind the live gate', () => {
    expect(screen).toMatch(/motionRegionsOn && liveOverlaysVisible/)
    expect(screen).toMatch(/stationaryBoxesOn && liveOverlaysVisible/)
    expect(screen).toMatch(/discardedBoxesOn && liveOverlaysVisible/)
  })
})
