/**
 * ONE per-camera bar, two surfaces — and the ONE control they differ by.
 *
 * The operator's instruction for the tablet snapshot shelf was to EXTRACT the
 * bar the grid already shows and restyle it — not to write a second one. The
 * failure mode of that instruction is a bar that forks: the wall gains a
 * control the shelf does not, or the two drift on what "too small" means, and
 * nobody notices because each surface looks right on its own.
 *
 * ## Why this file no longer asserts they are identical (2026-09-12, D483)
 *
 * It did, control-for-control and in order, and that was the right guard for as
 * long as the two surfaces were the same KIND of thing. They are not:
 * `viewOptions` configures overlays that are drawn on a live picture, and a reel
 * card is a snapshot thumbnail. The operator asked for it off the reel.
 *
 * So the invariant changes shape rather than being deleted. The parity claim is
 * now stated as a DIFFERENCE with a named membership on each side, which is a
 * strictly stronger guard than the equality was: an accidental drift still
 * fails, and so does a deliberate one that nobody wrote down here. What must
 * never happen is the two lists diverging by something this file does not
 * mention — so the difference is asserted as an exact set, not as "the shelf has
 * fewer".
 */
import { describe, it, expect } from 'vitest'
import {
  CAMERA_NAV_ACTIONS,
  SHELF_CONTROLS,
  cameraActionBarForCell,
  cameraActionBarItems,
  cameraPanelActions,
  isCameraPanelAction,
  type CameraActionKind,
} from '../camera-action-bar.js'
import { CELL_INLINE_MIN_H, CELL_INLINE_MIN_W } from '../cell-controls.js'

/** A wall cell with room for everything. */
const ROOMY_CELL: readonly [number, number] = [CELL_INLINE_MIN_W, CELL_INLINE_MIN_H]

const shelfBar = (hasPtz: boolean) =>
  cameraActionBarItems({ hasPtz, layout: SHELF_CONTROLS, canNavigate: true })
const wallBar = (hasPtz: boolean) =>
  cameraActionBarForCell(ROOMY_CELL[0], ROOMY_CELL[1], hasPtz)

describe('the wall and the shelf differ by exactly one control', () => {
  it('the wall keeps both secondary controls', () => {
    expect(cameraPanelActions(wallBar(true))).toEqual(['ptz', 'devices', 'viewOptions'])
  })

  /**
   * `viewOptions` is the difference, and `devices` is NOT: linked lights are
   * actionable from a card, overlay configuration is not.
   */
  it('the shelf keeps devices and drops viewOptions', () => {
    expect(cameraPanelActions(shelfBar(true))).toEqual(['ptz', 'devices'])
  })

  it('the difference is exactly {viewOptions}, in both PTZ cases', () => {
    for (const hasPtz of [true, false]) {
      const wall = new Set(cameraPanelActions(wallBar(hasPtz)))
      const shelf = new Set(cameraPanelActions(shelfBar(hasPtz)))
      const onlyOnWall = [...wall].filter((k) => !shelf.has(k))
      const onlyOnShelf = [...shelf].filter((k) => !wall.has(k))
      expect(onlyOnWall).toEqual(['viewOptions'])
      // The shelf may never gain a secondary control the wall does not have:
      // that direction is the fork, and no operator has asked for it.
      expect(onlyOnShelf).toEqual([])
    }
  })

  it('they still agree on ORDER for everything they share', () => {
    const wall = cameraPanelActions(wallBar(true)).filter((k) => k !== 'viewOptions')
    expect(cameraPanelActions(shelfBar(true))).toEqual(wall)
  })

  it('they agree when the camera has no PTZ, too', () => {
    expect(cameraPanelActions(wallBar(false))).toEqual(['devices', 'viewOptions'])
    expect(cameraPanelActions(shelfBar(false))).toEqual(['devices'])
  })
})

describe('only a card ABOUT a camera carries the navigation controls', () => {
  it('the shelf leads with goTo, add-to-view and the on-demand player', () => {
    expect(shelfBar(true).map((i) => i.kind).slice(0, 3)).toEqual([
      'goTo',
      'addToView',
      'playback',
    ])
  })

  it("the wall's own picture carries none of them — they would have nothing to do", () => {
    const kinds = wallBar(true).map((i) => i.kind)
    for (const nav of CAMERA_NAV_ACTIONS) expect(kinds).not.toContain(nav)
  })

  it('the add is never greyed — a card that offers it is a camera NOT in the view', () => {
    // The bar used to take an `inWorkspace` flag and disable the add for a
    // member. That state is unreachable now that ONE added camera starts the
    // wall: the member is drawn as a cell and dropped from the reel by the same
    // rule that drops the picture (`camera-shelf.ts`, `alreadyOnScreen`), so
    // the reel never lists a camera whose add would be a no-op. Asserted here
    // so the flag cannot come back without the reel's rule changing first.
    expect(shelfBar(false).find((i) => i.kind === 'addToView')?.disabled).toBeUndefined()
  })

  /**
   * `playback` opens the on-demand player at the instant already on screen —
   * `addToView` is the one that shows the camera LIVE. Two controls that reached
   * the same picture would be the fork this module exists to prevent, so both
   * are present and they are not the same verb.
   */
  it('offers the on-demand player as well as the add, never instead of it', () => {
    const kinds = shelfBar(false).map((i) => i.kind)
    expect(kinds).toContain('addToView')
    expect(kinds).toContain('playback')
  })
})

describe('the compact rule survives the extraction', () => {
  /** A 3x3 wall on a phone. PTZ is the first disc that stops fitting, so it
   *  collapses WITH the rest rather than staying inline. */
  it('a cell below the threshold collapses everything into one control', () => {
    expect(cameraActionBarForCell(CELL_INLINE_MIN_W - 1, 200, true).map((i) => i.kind)).toEqual([
      'actions',
    ])
    expect(cameraActionBarForCell(400, CELL_INLINE_MIN_H - 1, true).map((i) => i.kind)).toEqual([
      'actions',
    ])
  })

  it('an unmeasured cell collapses too, rather than sizing a row from nothing', () => {
    expect(cameraActionBarForCell(0, 0, true).map((i) => i.kind)).toEqual(['actions'])
  })

  it('a compact SHELF card keeps its navigation controls and collapses the rest', () => {
    const items = cameraActionBarItems({
      hasPtz: true,
      layout: { inline: [], overflow: true },
      canNavigate: true,
    })
    expect(items.map((i) => i.kind)).toEqual(['goTo', 'addToView', 'playback', 'actions'])
  })
})

describe('the panel hosts only ever receive an intent they can answer', () => {
  /**
   * The nav list is now ONE constant, and this is what it buys: the guard reads
   * the same list the builder does, so a fourth nav action cannot be narrowed
   * into `GridCellPanelKind` and posted to a panel host that has no case for
   * it. It used to be spelled out in two places.
   */
  it('narrows every navigation intent out, from the one list', () => {
    for (const nav of CAMERA_NAV_ACTIONS) expect(isCameraPanelAction(nav)).toBe(false)
  })

  it('lets every panel intent through', () => {
    const panels: readonly CameraActionKind[] = ['ptz', 'devices', 'viewOptions', 'actions']
    for (const kind of panels) expect(isCameraPanelAction(kind)).toBe(true)
  })

  /** Every kind is on exactly one side of the split — no kind is both, and none
   *  is neither. A new `CameraActionKind` cannot be forgotten by both lists. */
  it('splits the whole vocabulary, with nothing left over', () => {
    const every: readonly CameraActionKind[] = [
      ...CAMERA_NAV_ACTIONS,
      'ptz',
      'devices',
      'viewOptions',
      'actions',
    ]
    const panels = every.filter(isCameraPanelAction)
    const nav = every.filter((k) => !isCameraPanelAction(k))
    expect(panels.length + nav.length).toBe(every.length)
    expect(nav).toEqual([...CAMERA_NAV_ACTIONS])
  })
})
