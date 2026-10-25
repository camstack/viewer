/**
 * What confirming a selection in the camera panel MEANS, by value.
 *
 * The panel is one control with two meanings, and which one it has is decided
 * per LAYOUT SHAPE (`canBuildViewFromSelection`) — not per device, and no
 * longer by the reel's predicate, which answers a different question since the
 * phone got a wall.
 *
 * The asymmetry asserted here is the whole point and it is worth stating: the
 * SAME phone builds a view in landscape and routes to `/grid/adhoc` in
 * portrait. It is not about space — portrait draws a wall perfectly well — it
 * is about where this control is HOSTED. In `fill` the selector is in the edge
 * drawer, floating over the picture; in `stack` it is inside the timeline body,
 * so building a view would make the surface under the operator's finger
 * disappear. See the module docblock.
 */
import { describe, expect, it } from 'vitest'

import {
  MIN_SELECTION,
  cameraSelectionModeFor,
  canBuildViewFromSelection,
  resolveCameraSelection,
} from '../camera-selection.js'
import { shouldShowCameraShelf } from '../camera-shelf.js'

describe('which meaning the confirm has', () => {
  it('the wide layout builds the view', () => {
    expect(cameraSelectionModeFor('wide')).toBe('buildView')
  })

  it('a phone in LANDSCAPE builds it too — the selector floats over the picture', () => {
    expect(cameraSelectionModeFor('fill')).toBe('buildView')
  })

  it('PORTRAIT keeps the route — the selector is inside the surface it would replace', () => {
    expect(cameraSelectionModeFor('stack')).toBe('openGrid')
  })

  it('the predicate says it in its own name, and every shape answers', () => {
    // The value of the table over `mode === 'wide'`: `fill` changed its answer
    // and nothing forced it to be revisited. Asserted per shape so a future
    // change to one cannot be made by editing a comparison.
    expect(canBuildViewFromSelection('wide')).toBe(true)
    expect(canBuildViewFromSelection('fill')).toBe(true)
    expect(canBuildViewFromSelection('stack')).toBe(false)
  })

  it('and it is NOT the reel\'s predicate — those two disagree on a phone now', () => {
    // The split this file exists on the other side of: one value used to serve
    // "is there a reel", "can a wall be shown" and "does confirming build a
    // view". On `fill` the first is false and this one is true.
    expect(shouldShowCameraShelf('fill')).toBe(false)
    expect(canBuildViewFromSelection('fill')).toBe(true)
  })

  it('how many cameras arm the confirm, per meaning', () => {
    // Two for `openGrid`, because one camera has no grid to open. One for
    // `buildView`, because one camera is a `goTo` and that is a real thing to
    // ask a camera list for.
    expect(MIN_SELECTION.openGrid).toBe(2)
    expect(MIN_SELECTION.buildView).toBe(1)
  })
})

describe('where it builds, the confirm never navigates', () => {
  it('2+ selected BECOME the view, in the order given', () => {
    expect(resolveCameraSelection('buildView', [9, 5, 12])).toEqual({
      kind: 'buildView',
      members: [9, 5, 12],
    })
  })

  it('exactly one selected is a goTo — the same verb a row tap and a card use', () => {
    expect(resolveCameraSelection('buildView', [7])).toEqual({ kind: 'goTo', deviceId: 7 })
  })

  it('nothing selected does nothing', () => {
    expect(resolveCameraSelection('buildView', [])).toEqual({ kind: 'none' })
  })

  it('duplicates collapse — the view is a set with an order, never a bag', () => {
    expect(resolveCameraSelection('buildView', [5, 9, 5])).toEqual({
      kind: 'buildView',
      members: [5, 9],
    })
  })

  it('a duplicate that collapses to ONE is a goTo, not a wall of one', () => {
    expect(resolveCameraSelection('buildView', [5, 5])).toEqual({ kind: 'goTo', deviceId: 5 })
  })
})

describe('where it routes, nothing about it changed', () => {
  it('2+ selected still open the on-the-fly grid route', () => {
    expect(resolveCameraSelection('openGrid', [9, 5])).toEqual({
      kind: 'openGrid',
      deviceIds: [9, 5],
    })
  })

  it('one selected is refused, exactly as the disabled button refuses it today', () => {
    expect(resolveCameraSelection('openGrid', [7])).toEqual({ kind: 'none' })
  })

  it('nothing selected does nothing', () => {
    expect(resolveCameraSelection('openGrid', [])).toEqual({ kind: 'none' })
  })
})
