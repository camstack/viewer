/**
 * The cell panel must out-rank the picture.
 *
 * On the WALL this overlay had no stacking competition and worked without a
 * zIndex. On the SINGLE-CAMERA player the stream slot carries `STREAM_SLOT_Z`
 * and is an opaque box, so a sibling without one paints UNDER it: the panel
 * mounted, took the press, and was invisible — the operator's report was "the
 * devices button does nothing".
 *
 * `LandscapeTimelineOverlay` already carries a constant and a comment for
 * exactly this, having been covered by the video once before. Asserting the
 * relation is what keeps the two literals in two files from drifting apart.
 */
import { describe, expect, it } from 'vitest'
import { CELL_PANEL_OVERLAY_Z } from '../GridCellPanelOverlay.js'
import { STREAM_SLOT_Z } from '../../camera/theater/stream-slot.js'
import { DRAWER_OVERLAY_Z } from '../../camera/theater/landscape-drawer-geometry.js'

describe('GridCellPanelOverlay stacking', () => {
  it('paints above the stream slot', () => {
    expect(CELL_PANEL_OVERLAY_Z).toBeGreaterThan(STREAM_SLOT_Z)
  })

  it('paints above the landscape drawer too', () => {
    // It is opened FROM the drawer's toolbar, so it has to cover it — a panel
    // behind the bar that opened it is the same invisible-but-mounted defect.
    expect(CELL_PANEL_OVERLAY_Z).toBeGreaterThanOrEqual(DRAWER_OVERLAY_Z)
  })
})
