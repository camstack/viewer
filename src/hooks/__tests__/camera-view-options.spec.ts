import { describe, it, expect } from 'vitest'
import { mergeHighlightPatch, resolveCameraHighlight } from '../use-camera-view-options.js'
import { GRID_HIGHLIGHT_DEFAULTS } from '../../store/grid-store.js'

/**
 * The per-camera configuration READ by both hosts of the view-options surface:
 * the single-camera screen and a grid cell. One resolution, so a camera
 * configured from the wall and the same camera opened alone can never show
 * different values.
 */
describe('resolveCameraHighlight', () => {
  it('resolves an unconfigured camera to the defaults (never undefined)', () => {
    expect(resolveCameraHighlight(undefined)).toEqual(GRID_HIGHLIGHT_DEFAULTS)
  })

  it('fills missing highlight members from the defaults', () => {
    const resolved = resolveCameraHighlight({
      highlight: { ...GRID_HIGHLIGHT_DEFAULTS, motion: true },
    })
    expect(resolved.motion).toBe(true)
    expect(resolved.audioDb).toBe(GRID_HIGHLIGHT_DEFAULTS.audioDb)
  })

  it('the overlay is NOT per camera: a camera pref carries no overlay document', () => {
    expect(Object.keys(resolveCameraHighlight(undefined))).not.toContain('overlay')
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
