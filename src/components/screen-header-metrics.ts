/**
 * The numbers of the ONE screen header, so no screen re-decides them.
 *
 * Every pushed screen and every tab root wears `ScreenHeader`: a safe-area
 * inset, an optional glass back button, a title, and glass action buttons on
 * the right. The sizes live here (pure, no React) so the header, its specs and
 * the floating back chip over a wall agree by construction.
 */
import { SPACING } from '../theme/tokens.js'

/** Diameter of the back button and of every header action (same as the stream-chrome discs). */
export const HEADER_BUTTON_SIZE = 40

/** Gap between the slots (back | title | actions). */
export const HEADER_SLOT_GAP = SPACING.lg

/** Gap between two action buttons. */
export const HEADER_ACTION_GAP = SPACING.md

export const HEADER_PADDING_TOP = SPACING.sm
export const HEADER_PADDING_X = SPACING.xl
export const HEADER_PADDING_BOTTOM = SPACING.lg

/** Title: one style for every screen. */
export const HEADER_TITLE = { fontSize: 20, fontWeight: '700' } as const
export const HEADER_SUBTITLE = { fontSize: 12, fontWeight: '400' } as const
