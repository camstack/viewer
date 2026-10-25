import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Source guards for the track-detail PATH image (2026-08-02). The viewer
 * cannot mount components (vitest node env, no renderer), so the wiring is
 * asserted on the source in the style of `overlay-ownership-wiring.spec.ts`.
 * Each assertion names the defect it holds shut.
 */

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('the path image reuses the ONE frame-recovery and projection', () => {
  it('track-trajectory resolves the detection frame via zone-filter, never a second estimator', () => {
    // The zone filter was broken for weeks because two coordinate spaces were
    // compared through a GUESSED frame size (see zone-filter.ts module doc).
    // The trajectory must go through the same exact envelope recovery.
    const src = read('components/camera/theater/detail/track-trajectory.ts')
    expect(src).toMatch(/import\s*\{[^}]*\bresolveFrameSize\b[^}]*\}\s*from\s*'\.\.\/zone-filter\.js'/s)
    expect(src).toContain('resolveFrameSize([')
  })

  it('the overlay projects through cluster-detail containRect, not a re-derived letterbox', () => {
    const src = read('components/camera/theater/detail/TrajectoryOverlay.tsx')
    expect(src).toMatch(/import\s*\{[^}]*\bcontainRect\b[^}]*\}\s*from\s*'\.\/cluster-detail\.js'/s)
    expect(src).toContain('containRect(')
  })
})

describe('the detail actually mounts the path view', () => {
  it('TrackDetailView fetches geometry, builds the model, and renders the overlay', () => {
    const src = read('components/events/track/TrackDetailView.tsx')
    expect(src).toContain('useTrackGeometry(')
    expect(src).toContain('buildTrackTrajectory(')
    expect(src).toContain('<TrajectoryOverlay')
  })

  it('the base frame comes from pickTrajectoryBase — never the crop hero', () => {
    // A crop cannot host frame-normalised points; the pure picker is the only
    // place the "which frame" decision lives.
    const src = read('components/events/track/TrackDetailView.tsx')
    expect(src).toContain('pickTrajectoryBase(groups)')
  })

  it('the path tile is opt-in, alongside the media tiles', () => {
    const src = read('components/events/track/TrackDetailView.tsx')
    expect(src).toContain('<PathTile')
    expect(src).toContain("kind: 'path'")
  })
})

describe('the geometry hook reads the real track row', () => {
  it('use-track-geometry calls pipelineAnalytics.getTrack with deviceId + trackId', () => {
    // listTracks timeline rows carry NO per-position timestamps — the dwell
    // rendering needs the full row.
    const src = read('data/use-track-geometry.ts')
    expect(src).toContain("'pipelineAnalytics'")
    expect(src).toContain("'getTrack'")
    expect(src).toContain('{ deviceId, trackId }')
    expect(src).toContain('parseTrackPositions(')
    expect(src).toContain('parseNormalizedEnvelope(')
  })
})
