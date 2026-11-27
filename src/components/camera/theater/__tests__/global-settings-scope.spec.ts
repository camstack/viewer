import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Source guards for the 2026-08-02 settings-scope audit: a value that applies
 * to ALL cameras is edited in the settings reached from the camera list, never
 * inside one camera's panel — and the camera-list cards draw only what the
 * global camera-list overlay settings say. The viewer cannot mount components
 * (vitest runs `node`, no renderer), so the wiring is asserted on the source,
 * in the style of `zone-shape-wiring.spec.ts`.
 */

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('global timeline presentation is edited in Settings, not in a camera panel', () => {
  it('the per-camera view-options panel writes NO global cluster settings', () => {
    // Density presets and the importance/class toggles wrote `settings.clusters`
    // — one document read by EVERY camera's timeline — from inside one camera's
    // panel, where the change read as per-camera and was not.
    const src = read('components/camera/CameraViewOptionsSurface.tsx')
    expect(src).not.toContain('setCluster(')
    expect(src).not.toContain('TIMELINE_DENSITY_PRESETS')
    expect(src).not.toContain('showImportance')
    expect(src).not.toContain('showClass')
  })

  it('the menu keeps the per-camera cluster-label mode', () => {
    // `clusterLabel` lives in the PER-CAMERA highlight document — scoped, so it
    // stays where the camera is configured. Read on the SURFACE since
    // 2026-08-13: the menu's content moved there when a grid cell became its
    // second host, and the theater panel is now only the frame around it.
    const src = read('components/camera/CameraViewOptionsSurface.tsx')
    expect(src).toContain('<ClusterLabelRow')
    expect(src).toContain('highlight.clusterLabel')
  })

  it('Settings → Viewing hosts the density presets and the card badges', () => {
    const src = read('screens/settings/ViewingSegment.tsx')
    expect(src).toContain('TIMELINE_DENSITY_PRESETS')
    expect(src).toContain("setCluster('showClass'")
    expect(src).not.toContain("setCluster('showImportance'")
  })
})

describe('the camera-list cards draw what the global camera-list settings say', () => {
  it('CameraCard gates BOTH offered overlays on settings.cameraList', () => {
    // The gate must also stop the QUERY, not merely the pixels — an occupancy
    // strip turned off that keeps polling would be all cost and no picture.
    const src = read('components/CameraCard.tsx')
    expect(src).toContain('settings.cameraList')
    expect(src).toContain("listOverlays.occupancy !== 'off'")
    expect(src).toContain('listOverlays.motionBorder')
  })

  it('the Cameras display sheet edits them with the shared nine-position picker', () => {
    const src = read('components/camera/CamerasDisplaySheet.tsx')
    expect(src).toContain('<OverlayPositionPicker')
    expect(src).toContain("setCameraList('motionBorder'")
    expect(src).toContain("setCameraList('occupancy'")
  })

  it('the card does NOT mount the per-frame detail overlays', () => {
    // Deliberate exclusion, measured 2026-08-02: detection boxes, motion
    // regions, the audio meter and pinned readouts are per-frame event streams
    // or per-device polls, multiplied by every card — the ~8 req/s idle storm
    // the list was just cured of. They join only behind a batched aggregate.
    const src = read('components/CameraCard.tsx')
    for (const name of [
      'MotionBoxesOverlay',
      'MotionRegionsOverlay',
      'DiscardedBoxesOverlay',
      'AudioLevelMeter',
      'OverlayReadouts',
    ]) {
      expect(src).not.toContain(name)
    }
  })
})
