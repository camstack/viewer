/**
 * Where the fullscreen PTZ pad sits over the picture. Pure, so it can be
 * asserted without rendering.
 *
 * The pad is anchored to the LEFT edge, above the disc row — the place the
 * robot camera's joystick already takes in fill (`DriveOverlay`): the left
 * cluster (mute · talk · History · PTZ) owns the bottom edge, the timeline
 * drawer opens over the RIGHT of the picture, and the centre is the subject.
 * Its width is capped so a landscape picture keeps its middle, and its height
 * is capped by the window so a long preset list scrolls inside the panel
 * instead of running under the status bar.
 */
import { SPACING } from '../../../theme/tokens.js'

/** Widest the panel grows (the pad is ~232 pt; presets wrap within this). */
export const PTZ_OVERLAY_MAX_WIDTH = 320

export interface PtzOverlayLayoutInput {
  readonly windowWidth: number
  readonly windowHeight: number
  /** The window safe-area the discs use in fill. */
  readonly edgePad: { readonly left: number; readonly right: number; readonly bottom: number }
  readonly topInset: number
  /** The disc row's diameter, `OVERLAY_DISC_SIZE`. */
  readonly discSize: number
}

export interface PtzOverlayLayout {
  readonly left: number
  /** Above the disc row, which owns the bottom edge. */
  readonly bottom: number
  readonly maxWidth: number
  readonly maxHeight: number
}

export function ptzOverlayLayout(input: PtzOverlayLayoutInput): PtzOverlayLayout {
  const { windowWidth, windowHeight, edgePad, topInset, discSize } = input
  const left = edgePad.left + SPACING.md
  // The same offset `DriveOverlay` uses: one gap above the disc row.
  const bottom = edgePad.bottom + SPACING.md + discSize + SPACING.lg
  const maxWidth = Math.max(0, Math.min(PTZ_OVERLAY_MAX_WIDTH, windowWidth - left - edgePad.right - SPACING.md))
  const maxHeight = Math.max(0, windowHeight - bottom - topInset - SPACING.md)
  return { left, bottom, maxWidth, maxHeight }
}
