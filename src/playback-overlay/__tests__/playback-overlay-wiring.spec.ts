import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const screen = readFileSync(join(__dirname, '../../screens/CameraDetailScreen.tsx'), 'utf8')

describe('recorded playback feeds the existing overlays', () => {
  it('fills the boxes, border, occupancy and meter from the source, only when it is known', () => {
    expect(screen).toContain('usePlaybackOverlay(')
    expect(screen).toContain("playbackFrame.availability === 'known'")
    expect(screen).toContain('playbackBoxes={playbackKnown?.boxes}')
    expect(screen).toContain('occupancy: (status.isLive && !paused) || playbackOverlaysVisible')
    expect(screen).toContain('playbackKnown.audioDbfs !== null')
  })
  it('leaves the live-only layers (regions, parked, discarded) live-only', () => {
    expect(screen).toMatch(/motionRegionsOn && liveOverlaysVisible/)
    expect(screen).toMatch(/stationaryBoxesOn && liveOverlaysVisible/)
    expect(screen).toMatch(/discardedBoxesOn && liveOverlaysVisible/)
  })
})
