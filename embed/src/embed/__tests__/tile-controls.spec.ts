import { describe, it, expect } from 'vitest'
import {
  drawsRemoveControl,
  resolveTileControls,
  TILE_INLINE_MIN_H,
  TILE_INLINE_MIN_W,
  TILE_REMOVE_MIN_H,
  TILE_REMOVE_MIN_W,
} from '../tile-controls'

describe('resolveTileControls', () => {
  it('draws both secondary buttons on a roomy tile', () => {
    expect(resolveTileControls(640, 360)).toEqual({
      inline: ['devices', 'viewOptions'],
      overflow: false,
    })
  })

  it('collapses to one "more" button on a phone-sized cell', () => {
    expect(resolveTileControls(130, 74)).toEqual({ inline: [], overflow: true })
  })

  it('is inclusive at the threshold', () => {
    expect(resolveTileControls(TILE_INLINE_MIN_W, TILE_INLINE_MIN_H).overflow).toBe(false)
    expect(resolveTileControls(TILE_INLINE_MIN_W - 1, TILE_INLINE_MIN_H).overflow).toBe(true)
    expect(resolveTileControls(TILE_INLINE_MIN_W, TILE_INLINE_MIN_H - 1).overflow).toBe(true)
  })

  it('treats an unmeasured tile as compact', () => {
    expect(resolveTileControls(0, 0).overflow).toBe(true)
  })

  it('keeps the thresholds equal to the native wall (src/grid/cell-controls.ts)', () => {
    // The two walls must not disagree about when a button disappears. If this
    // fails, the other copy moved — move this one with it.
    expect(TILE_INLINE_MIN_W).toBe(300)
    expect(TILE_INLINE_MIN_H).toBe(130)
  })
})

describe('drawsRemoveControl', () => {
  it('is drawn on an editable wall at a workable cell size', () => {
    expect(drawsRemoveControl(true, 640, 360)).toBe(true)
  })

  it('is never drawn when the host did not say the wall is editable', () => {
    // A saved grid's membership belongs to the grid, not to a tap on a tile —
    // and on a host that does not answer `tileRemove` the button is dead chrome.
    expect(drawsRemoveControl(false, 640, 360)).toBe(false)
  })

  it('is inclusive at the threshold, and gone below it', () => {
    expect(drawsRemoveControl(true, TILE_REMOVE_MIN_W, TILE_REMOVE_MIN_H)).toBe(true)
    expect(drawsRemoveControl(true, TILE_REMOVE_MIN_W - 1, TILE_REMOVE_MIN_H)).toBe(false)
    expect(drawsRemoveControl(true, TILE_REMOVE_MIN_W, TILE_REMOVE_MIN_H - 1)).toBe(false)
  })

  it('survives on a cell too small for the secondary buttons', () => {
    // The one action with no other route out must outlive the ones that have a
    // "more" list to fall back into.
    expect(resolveTileControls(200, 110).overflow).toBe(true)
    expect(drawsRemoveControl(true, 200, 110)).toBe(true)
  })

  it('draws nothing on an unmeasured cell', () => {
    expect(drawsRemoveControl(true, 0, 0)).toBe(false)
  })
})
