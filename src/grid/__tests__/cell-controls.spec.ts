import { describe, it, expect } from 'vitest'
import {
  CELL_INLINE_MIN_H,
  CELL_INLINE_MIN_W,
  cellActionRows,
  resolveCellControls,
  resolveCellPanel,
  type GridCellPanel,
} from '../cell-controls.js'

/**
 * The grid cell's SECONDARY controls (linked devices + the per-camera view
 * options menu) and the single host panel they open.
 *
 * Two rules live here and nowhere else:
 *
 *  1. A phone grid cell is ~130pt wide. The tile already carries five discs
 *     (play/pause, listen, talk, PTZ, open); two more make a row that does not
 *     fit and cannot be hit. Below the threshold the two secondary actions
 *     collapse behind ONE "more" button that opens the same panels from a list.
 *  2. The panel is keyed by device id, and the wall's camera set changes under
 *     it (hide, remove, active-only). A panel whose camera left the wall is
 *     closed rather than left floating over cameras it no longer describes.
 */
describe('resolveCellControls', () => {
  it('puts both secondary actions inline on a roomy cell', () => {
    const layout = resolveCellControls(640, 360)
    expect(layout.inline).toEqual(['devices', 'viewOptions'])
    expect(layout.overflow).toBe(false)
  })

  it('collapses them behind one button when the cell is too narrow', () => {
    const layout = resolveCellControls(CELL_INLINE_MIN_W - 1, 400)
    expect(layout.inline).toEqual([])
    expect(layout.overflow).toBe(true)
  })

  it('collapses them when the cell is too short (landscape 3-up strips)', () => {
    const layout = resolveCellControls(800, CELL_INLINE_MIN_H - 1)
    expect(layout.inline).toEqual([])
    expect(layout.overflow).toBe(true)
  })

  it('is inclusive at the threshold — exactly the minimum still fits', () => {
    const layout = resolveCellControls(CELL_INLINE_MIN_W, CELL_INLINE_MIN_H)
    expect(layout.overflow).toBe(false)
  })

  it('treats a not-yet-measured cell as compact (never draws chrome it cannot size)', () => {
    expect(resolveCellControls(0, 0).overflow).toBe(true)
  })
})

describe('cellActionRows', () => {
  it('offers PTZ first when the camera has it, then the two shared surfaces', () => {
    expect(cellActionRows({ hasPtz: true })).toEqual(['ptz', 'devices', 'viewOptions'])
  })

  it('omits PTZ for a fixed camera', () => {
    expect(cellActionRows({ hasPtz: false })).toEqual(['devices', 'viewOptions'])
  })
})

describe('resolveCellPanel', () => {
  const panel: GridCellPanel = { kind: 'devices', deviceId: 7 }

  it('keeps a panel whose camera is still on the wall', () => {
    expect(resolveCellPanel(panel, [3, 7, 9])).toEqual(panel)
  })

  it('closes a panel whose camera left the wall', () => {
    expect(resolveCellPanel(panel, [3, 9])).toBeNull()
  })

  it('passes null through', () => {
    expect(resolveCellPanel(null, [3, 7])).toBeNull()
  })

  it('returns the SAME object when nothing changed (no re-render churn)', () => {
    expect(resolveCellPanel(panel, [7])).toBe(panel)
  })
})
