import { describe, it, expect } from 'vitest'
import {
  mergeHighlightPatch,
  resolveCameraViewOptions,
} from '../use-camera-view-options.js'
import { OVERLAY_DEFAULTS } from '../../components/camera/overlay/overlay-config.js'
import { GRID_HIGHLIGHT_DEFAULTS } from '../../store/grid-store.js'

/**
 * The per-camera configuration READ by both hosts of the view-options surface:
 * the single-camera screen and a grid cell. One resolution, so a camera
 * configured from the wall and the same camera opened alone can never show
 * different values.
 */
describe('resolveCameraViewOptions', () => {
  it('resolves an unconfigured camera to the defaults (never undefined)', () => {
    const resolved = resolveCameraViewOptions(undefined)
    expect(resolved.overlay).toEqual(OVERLAY_DEFAULTS)
    expect(resolved.highlight).toEqual(GRID_HIGHLIGHT_DEFAULTS)
  })

  it('returns the stored overlay document when the camera has one', () => {
    const overlay = { ...OVERLAY_DEFAULTS, boxes: 'all' as const }
    expect(resolveCameraViewOptions({ overlay }).overlay).toEqual(overlay)
  })

  it('fills missing highlight members from the defaults', () => {
    const resolved = resolveCameraViewOptions({
      highlight: { ...GRID_HIGHLIGHT_DEFAULTS, motion: true },
    })
    expect(resolved.highlight.motion).toBe(true)
    expect(resolved.highlight.audioDb).toBe(GRID_HIGHLIGHT_DEFAULTS.audioDb)
  })
})

describe('mergeHighlightPatch', () => {
  it('patch-merges onto the CURRENT resolved value (the panel sends only what changed)', () => {
    const next = mergeHighlightPatch({ ...GRID_HIGHLIGHT_DEFAULTS, motion: true }, { detection: true })
    expect(next.motion).toBe(true)
    expect(next.detection).toBe(true)
  })

  it('never mutates the value it was given', () => {
    const current = { ...GRID_HIGHLIGHT_DEFAULTS }
    mergeHighlightPatch(current, { motion: true })
    expect(current.motion).toBe(GRID_HIGHLIGHT_DEFAULTS.motion)
  })
})
