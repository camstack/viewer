/**
 * Where the drive overlay's button cluster goes, and how big its discs are,
 * against the landscape timeline drawer. Pure, so it can be asserted without
 * rendering.
 *
 * The drawer is an OVERLAY anchored `right: 0` over the picture
 * (`landscape-drawer-geometry.ts`): while it is open the rightmost
 * `drawer.width` of the window is panel, not video, and a cluster anchored to
 * the safe area sits UNDER it (operator, 2026-09-06, with a screenshot: the
 * buttons showed through the panel's scrim and collided with its toolbar).
 * So the cluster's right edge is the drawer's edge while open, and the discs
 * shrink — never below `DRIVE_DISC_MIN_SIZE` — when the picture still visible
 * cannot hold the joystick and the cluster side by side at full size.
 */
import { SPACING } from '../../../theme/tokens.js'

/** Smaller than this and a thumb cannot hit the disc. */
export const DRIVE_DISC_MIN_SIZE = 28

export interface DriveDrawerState {
  readonly open: boolean
  /** The drawer's panel width — `drawerWidth(windowWidth)`. */
  readonly width: number
}

export interface DriveOverlayLayoutInput {
  readonly windowWidth: number
  readonly edgePad: { readonly left: number; readonly right: number }
  readonly drawer?: DriveDrawerState
  /** The full-size disc, `OVERLAY_DISC_SIZE`. */
  readonly discSize: number
  /** The joystick ring, `DRIVE_JOYSTICK_SIZE`. */
  readonly joystickSize: number
  readonly buttonCount: number
}

export interface DriveOverlayLayout {
  /** Right offset of the cluster: the drawer's edge while open, else the safe area. */
  readonly right: number
  readonly discSize: number
  readonly gap: number
}

export function driveOverlayLayout(input: DriveOverlayLayoutInput): DriveOverlayLayout {
  const { windowWidth, edgePad, drawer, discSize, joystickSize, buttonCount } = input
  // The panel paints over the inset too, so the larger of the two is covered.
  const covered = drawer?.open ? Math.max(drawer.width, edgePad.right) : edgePad.right
  const right = covered + SPACING.md
  const stickEnd = edgePad.left + SPACING.md + joystickSize + SPACING.lg
  const free = windowWidth - right - stickEnd
  const needed = buttonCount * discSize + Math.max(0, buttonCount - 1) * SPACING.md
  if (buttonCount === 0 || needed <= free) {
    return { right, discSize, gap: SPACING.md }
  }
  const gap = SPACING.sm
  const fitted = Math.floor((free - (buttonCount - 1) * gap) / buttonCount)
  return { right, discSize: Math.max(DRIVE_DISC_MIN_SIZE, Math.min(discSize, fitted)), gap }
}
