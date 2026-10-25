/**
 * The rules that turn the single picture into a WALL.
 *
 * Three guarantees are asserted here rather than argued:
 *
 * 1. **Every SHAPE hosts it, and the camera count is the second condition.**
 *    The threshold was the reel's (`layoutMode === 'wide'`) while the wall was
 *    drawn under the picture. The wall replaces the picture now, so it needs
 *    the space every shape already has, and the operator asked for it on the
 *    phone: `canHostWorkspaceWall` says yes to all three and says it as a
 *    table. What a phone does NOT get is a reel, and what PORTRAIT does not get
 *    is a way to BUILD a view — three questions, three predicates, asserted
 *    here as disagreeing with each other on purpose.
 * 2. **Every camera on screen is listed exactly once, picture first.** The
 *    route camera is a CELL now (2026-09-02), and it is the primary — the head
 *    of the list. A member that IS the route camera contributes one cell, not
 *    two: a duplicate would negotiate a second peer for one camera.
 * 3. **The count includes the picture.** One other camera in the view is two
 *    cameras on screen, and that is a wall. Counting `members` alone made "add
 *    to view" on the operator's second camera a no-op while the timeline —
 *    reading the same store — went to two cameras. There is now one list and
 *    both surfaces count it.
 *
 * The mount-level half is `workspace-grid-mount.spec.ts`.
 */
import { describe, it, expect } from 'vitest'
import {
  canHostWorkspaceWall,
  shouldShowWorkspaceGrid,
  workspaceOnScreenCameras,
  shelfVariantFor,
  WORKSPACE_GRID_MIN_CAMERAS,
} from '../workspace-grid.js'
import { shelfCameras, shouldShowCameraShelf } from '../camera-shelf.js'
import { resolveDetailLayoutMode } from '../detail-layout.js'

describe('the wall needs the space AND a second camera on screen', () => {
  it('ONE other camera is already a view — the picture is the second one', () => {
    // The defect this file shipped with: the operator adds one camera from the
    // reel and expects the wall. `members` is [5] because the reel only ever
    // lists cameras that are NOT on screen, so a `members.length >= 2` gate
    // could never open on the interaction the feature exists for.
    expect(shouldShowWorkspaceGrid('wide', [5], 1)).toBe(true)
  })

  it('two others, the same answer', () => {
    expect(shouldShowWorkspaceGrid('wide', [5, 9], 1)).toBe(true)
  })

  it('no members: the single-camera theater, untouched', () => {
    expect(shouldShowWorkspaceGrid('wide', [], 1)).toBe(false)
  })

  it('the ONE member IS the picture: one camera on screen, so no wall', () => {
    // `goTo` on the only member. A wall of one camera is the single picture
    // with a border round it, and it would have cost a renegotiation to draw.
    expect(shouldShowWorkspaceGrid('wide', [5], 5)).toBe(false)
    expect(workspaceOnScreenCameras([5], 5)).toEqual([5])
  })

  it('the minimum is named once, it is two, and it counts the picture', () => {
    expect(WORKSPACE_GRID_MIN_CAMERAS).toBe(2)
  })
})

describe('every layout shape can host a wall — the phone included', () => {
  /**
   * The gate stopped being the reel's on 2026-09-02. It could be
   * `layoutMode === 'wide'` while the wall was drawn UNDER the picture; the
   * wall now REPLACES the picture, so the space it needs is space every shape
   * already has, and the operator asked for it on the phone.
   *
   * Asserted through `resolveDetailLayoutMode` from real window/screen pairs
   * rather than by passing a mode literal: the claim is about DEVICES, and a
   * literal cannot say that a 932pt-wide phone window is still `fill`.
   */
  const SURFACES = [
    { name: 'iPhone portrait', width: 430, height: 932, screenMinSide: 430, shape: 'stack' },
    { name: 'iPhone landscape', width: 932, height: 430, screenMinSide: 430, shape: 'fill' },
    { name: 'phone-sized browser window', width: 420, height: 800, screenMinSide: undefined, shape: 'stack' },
    { name: 'iPad portrait', width: 834, height: 1194, screenMinSide: 834, shape: 'stack' },
    { name: 'iPad landscape', width: 1194, height: 834, screenMinSide: 834, shape: 'wide' },
  ] as const

  for (const surface of SURFACES) {
    it(`${surface.name} (${surface.shape}) — two cameras on screen is a wall`, () => {
      const mode = resolveDetailLayoutMode({
        width: surface.width,
        height: surface.height,
        screenMinSide: surface.screenMinSide,
        isWeb: surface.screenMinSide === undefined,
        fullscreen: false,
      })
      expect(mode).toBe(surface.shape)
      expect(shouldShowWorkspaceGrid(mode, [5, 9], 1)).toBe(true)
    })
  }

  it('explicit fullscreen too — it resolves to `fill`, and `fill` hosts a wall', () => {
    const mode = resolveDetailLayoutMode({
      width: 1194,
      height: 834,
      screenMinSide: 834,
      isWeb: false,
      fullscreen: true,
    })
    expect(mode).toBe('fill')
    expect(shouldShowWorkspaceGrid(mode, [5, 9], 1)).toBe(true)
  })

  it('the camera count is still the second condition, in every shape', () => {
    // The mode is mode-blind; the COUNT is not. One camera on screen is the
    // single-camera theater on a phone exactly as on a tablet.
    for (const mode of ['fill', 'wide', 'stack'] as const) {
      expect(shouldShowWorkspaceGrid(mode, [], 1)).toBe(false)
      expect(shouldShowWorkspaceGrid(mode, [5], 5)).toBe(false)
      expect(shouldShowWorkspaceGrid(mode, [5], 1)).toBe(true)
    }
  })

  it('every shape answers the host question by NAME, and all three say yes', () => {
    for (const mode of ['fill', 'wide', 'stack'] as const) {
      expect(canHostWorkspaceWall(mode)).toBe(true)
    }
  })

  it('and that is NOT the reel\'s answer — the two predicates were split apart', () => {
    // The whole reason there are two names. A phone hosts a wall in both of its
    // shapes and has a reel in neither; one predicate cannot say that.
    for (const mode of ['fill', 'stack'] as const) {
      expect(canHostWorkspaceWall(mode)).toBe(true)
      expect(shouldShowCameraShelf(mode)).toBe(false)
    }
    expect(canHostWorkspaceWall('wide')).toBe(true)
    expect(shouldShowCameraShelf('wide')).toBe(true)
  })
})

describe('the wall draws every camera on screen, the route camera FIRST', () => {
  it('the route camera leads, then the members in their own order', () => {
    expect(workspaceOnScreenCameras([5, 9], 1)).toEqual([1, 5, 9])
  })

  it('after `goTo` on a member it is the PRIMARY, and it appears once', () => {
    // The head is the cell `resolvePrimaryWallSpan` enlarges. Listing 5 twice
    // would be two peers for one camera.
    expect(workspaceOnScreenCameras([5, 9], 5)).toEqual([5, 9])
  })

  it('keeps the member order after the head — the order IS the geometry', () => {
    expect(workspaceOnScreenCameras([9, 5, 1], 99)).toEqual([99, 9, 5, 1])
  })

  it('never empty, and never shorter than the gate it is counted by', () => {
    for (const current of [5, 9, 1]) {
      expect(workspaceOnScreenCameras([5, 9], current).length).toBeGreaterThanOrEqual(
        WORKSPACE_GRID_MIN_CAMERAS,
      )
    }
  })
})

describe('the snapshots reduce to one scrolling row exactly when the wall is up', () => {
  it('wall up: a strip', () => {
    expect(shelfVariantFor(true)).toBe('strip')
  })

  it('wall down: the rows that ship today', () => {
    expect(shelfVariantFor(false)).toBe('rows')
  })
})

describe('the strip lists what is NOT already on screen', () => {
  const cameras = [{ id: 1 }, { id: 5 }, { id: 9 }, { id: 12 }]

  it('drops the picture AND the cells — a camera is listed once or not at all', () => {
    expect(shelfCameras(cameras, 1, [5, 9]).map((c) => c.id)).toEqual([12])
  })

  it('with no wall the second argument is all there is, exactly as today', () => {
    expect(shelfCameras(cameras, 1).map((c) => c.id)).toEqual([5, 9, 12])
  })

  it('an id in both places is dropped once, not twice', () => {
    expect(shelfCameras(cameras, 5, [5, 9]).map((c) => c.id)).toEqual([1, 12])
  })
})

describe('the timeline reads exactly what the wall draws', () => {
  it('with no view it is the route camera alone, exactly as camera-detail shipped', () => {
    expect(workspaceOnScreenCameras([], 1)).toEqual([1])
  })

  it('the primary comes FIRST — an overflow may never be allowed to drop it', () => {
    // `planScopeAsk` truncates a scope from the END, so the head is the one
    // camera an over-large view can never cost.
    expect(workspaceOnScreenCameras([5, 9], 1)).toEqual([1, 5, 9])
  })

  it('never empty: a scope of nothing would leave the timeline reading no camera', () => {
    expect(workspaceOnScreenCameras([], 42)).toEqual([42])
  })

  it('one list, so the scope and the cells cannot differ by construction', () => {
    // The claim that used to need two functions to be checked, and that the
    // gate got wrong when it read only one of them.
    const members = [5, 9, 12]
    expect(workspaceOnScreenCameras(members, 1)).toEqual([1, 5, 9, 12])
  })
})
