import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isLiveEdge, shouldRequestSnapshot, type TileCameraState,
} from '../tile-snapshot-gate.js'

const up: TileCameraState = { screenActive: true, online: true, disabled: false, sleeping: false }

describe('isLiveEdge', () => {
  it('is true only for an on-screen, online, enabled, awake camera', () => {
    expect(isLiveEdge(up)).toBe(true)
  })
  it('is false for every non-live state', () => {
    expect(isLiveEdge({ ...up, screenActive: false })).toBe(false)
    expect(isLiveEdge({ ...up, online: false })).toBe(false)
    expect(isLiveEdge({ ...up, disabled: true })).toBe(false)
    expect(isLiveEdge({ ...up, sleeping: true })).toBe(false)
  })
})

describe('shouldRequestSnapshot', () => {
  it('asks for a frame for every camera state — the hub has a tile for each (D190)', () => {
    for (const state of [
      { ...up, disabled: true, online: false },
      { ...up, sleeping: true },
      { ...up, online: false },
    ]) {
      expect(shouldRequestSnapshot(state)).toBe(true)
    }
  })
  it('never asks while the surface is off screen', () => {
    expect(shouldRequestSnapshot({ ...up, screenActive: false })).toBe(false)
    expect(shouldRequestSnapshot({ ...up, screenActive: false, disabled: true })).toBe(false)
  })
  it('is broader than the live edge for every camera that is not live', () => {
    // The live edge is about what may POLL — occupancy, motion, battery. The
    // snapshot gate is about what may be PAINTED, and the hub paints everything.
    for (const state of [
      { ...up, online: false },
      { ...up, disabled: true },
      { ...up, sleeping: true },
    ]) {
      expect(isLiveEdge(state)).toBe(false)
      expect(shouldRequestSnapshot(state)).toBe(true)
    }
  })
})

describe('the camera card lets the courtesy frame speak', () => {
  /**
   * The tile used to paint an opaque "Out of service" panel over the whole
   * media area for a disabled camera, and a "Sleeping" caption for a sleeping
   * one. Both were written when the hub answered those cameras with a 404 and
   * there was nothing else to draw. The hub now sends a frame that says it, so
   * a covering panel hides the answer instead of being one.
   */
  it('renders no covering overlay for a disabled or sleeping camera', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/components/CameraCard.tsx'),
      'utf8',
    )
    for (const retired of ['offOverlay', 'disabledTitle', 'disabledHint', "t('v2.cameras.sleeping'"]) {
      expect(src, `CameraCard must not draw ${retired}`).not.toContain(retired)
    }
    // The gate, not a hand-rolled boolean, decides what is asked for.
    expect(src).toContain('shouldRequestSnapshot(tileState)')
    expect(src).toContain('isLiveEdge(tileState)')
  })
})
