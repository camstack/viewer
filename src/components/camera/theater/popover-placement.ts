/**
 * Where a menu anchored to a chip opens — above it or below it, and how far
 * left — in WINDOW coordinates.
 *
 * The playback bar's speed menu used to be an absolutely-positioned child of
 * the bar, opening upward. In the layout with the timeline on the right the
 * bar sits directly under the timeline toolbar, which carries a higher z-rank
 * (it owns its own dropdowns), so the menu opened INTO the toolbar and painted
 * beneath it: the operator saw an empty sliver of menu poking out from under
 * the header. A z-index race between siblings cannot be won from inside one of
 * them, so on web the menu is portalled to the window, and once it is out of
 * the bar's box it needs to know where the room is.
 *
 * Pure: the caller measures the anchor (`measureInWindow`) and the menu
 * (`onLayout`) and draws at the answer.
 */

/** A rectangle in window coordinates. */
export interface WindowRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface PopoverSize {
  readonly width: number
  readonly height: number
}

export interface ViewportSize {
  readonly width: number
  readonly height: number
}

export type PopoverDirection = 'up' | 'down'

export interface PopoverPlacement {
  readonly direction: PopoverDirection
  /** Window x of the menu's left edge. */
  readonly left: number
  /** Window y of the menu's top edge. */
  readonly top: number
}

/** Space kept between the menu and the anchor, and between the menu and the window edge. */
export const POPOVER_GAP = 4

/**
 * Open toward `preferred` when the menu fits there; otherwise toward the side
 * with more room. Right-aligned to the anchor (the chip is at the trailing end
 * of its row), then clamped so the menu never leaves the window. A menu taller
 * than either side is pinned inside the window rather than cut off at the top.
 */
export function placePopover(
  anchor: WindowRect,
  menu: PopoverSize,
  viewport: ViewportSize,
  preferred: PopoverDirection = 'up',
): PopoverPlacement {
  const roomAbove = anchor.y - POPOVER_GAP * 2
  const roomBelow = viewport.height - (anchor.y + anchor.height) - POPOVER_GAP * 2
  const fitsUp = menu.height <= roomAbove
  const fitsDown = menu.height <= roomBelow
  const direction: PopoverDirection =
    preferred === 'up'
      ? fitsUp || (!fitsDown && roomAbove >= roomBelow)
        ? 'up'
        : 'down'
      : fitsDown || (!fitsUp && roomBelow >= roomAbove)
        ? 'down'
        : 'up'

  const rawTop =
    direction === 'up'
      ? anchor.y - POPOVER_GAP - menu.height
      : anchor.y + anchor.height + POPOVER_GAP
  const top = clamp(rawTop, POPOVER_GAP, viewport.height - POPOVER_GAP - menu.height)

  const rawLeft = anchor.x + anchor.width - menu.width
  const left = clamp(rawLeft, POPOVER_GAP, viewport.width - POPOVER_GAP - menu.width)

  return { direction, left, top }
}

/** `value` inside [min, max]; `min` wins when the range is empty (a menu wider than the window). */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}
