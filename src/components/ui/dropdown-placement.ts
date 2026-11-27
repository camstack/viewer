/**
 * dropdown-placement — where an anchored select menu sits relative to the
 * control that opened it.
 *
 * Kept DOM/RN-free so the attachment can be unit-tested. The visual menu is
 * a compact card (the occupancy picker), NOT a full-screen bottom sheet and
 * NOT a Modal centered on the window — those two are how "Su audio" and
 * "Occupazione" drifted off the row that invoked them.
 */

export interface AnchorRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

export type DropdownAlign = 'start' | 'end' | 'center'
export type DropdownPlacement = 'below' | 'above'

export interface PlaceAnchoredDropdownInput {
  readonly trigger: AnchorRect
  readonly menuSize: Size
  readonly windowSize: Size
  /** Gap between trigger edge and menu. */
  readonly gap?: number
  /** Minimum inset from the window's top and bottom edges. */
  readonly padding?: number
  /**
   * Minimum inset from the window's left and right edges — the screen gutter
   * by default, so a menu never sits closer to the edge than the page does.
   */
  readonly gutter?: number
  /** Horizontal alignment against the trigger. Default `end` — our
   *  selectors live on the RIGHT of the row. */
  readonly align?: DropdownAlign
  /**
   * Force a side when the caller already knows geometry (a footer chip has
   * nowhere below it). Absent ⟺ pick by available space, as before. A side
   * with no room for the menu is ignored: the other side is used.
   */
  readonly preferredPlacement?: DropdownPlacement
}

export interface PlacedDropdown {
  readonly top: number
  readonly left: number
  readonly maxHeight: number
  readonly placement: DropdownPlacement
}

export const DROPDOWN_GAP = 4
export const DROPDOWN_PADDING = 8
/** The side inset — `SCREEN_GUTTER` (tokens.ts), kept literal so this file stays RN-free. */
export const DROPDOWN_GUTTER = 16
/** Least room (px) a forced side must offer to stand; below it the card would have no height. */
const MIN_FORCED_ROOM = 16

export function placeAnchoredDropdown(input: PlaceAnchoredDropdownInput): PlacedDropdown {
  const gap = input.gap ?? DROPDOWN_GAP
  const padding = input.padding ?? DROPDOWN_PADDING
  const gutter = input.gutter ?? DROPDOWN_GUTTER
  const align = input.align ?? 'end'
  const { trigger, menuSize, windowSize } = input

  const spaceBelow = windowSize.height - (trigger.y + trigger.height) - padding
  const spaceAbove = trigger.y - padding
  const automatic: DropdownPlacement =
    spaceBelow >= Math.min(menuSize.height, 120) || spaceBelow >= spaceAbove ? 'below' : 'above'
  // A forced side is honoured only while it can show the menu: a trigger in
  // the header has no room "above" and would get a zero-height card.
  const preferred = input.preferredPlacement
  const preferredRoom = preferred === 'above' ? spaceAbove - gap : spaceBelow - gap
  const placement: DropdownPlacement =
    preferred !== undefined && preferredRoom >= MIN_FORCED_ROOM ? preferred : automatic

  const maxHeight =
    placement === 'below'
      ? Math.max(0, spaceBelow - gap)
      : Math.max(0, spaceAbove - gap)

  const usedHeight = Math.min(menuSize.height, maxHeight)
  const top =
    placement === 'below' ? trigger.y + trigger.height + gap : trigger.y - gap - usedHeight

  let left: number
  if (align === 'start') left = trigger.x
  else if (align === 'center') left = trigger.x + (trigger.width - menuSize.width) / 2
  else left = trigger.x + trigger.width - menuSize.width

  const minLeft = gutter
  const maxLeft = windowSize.width - menuSize.width - gutter
  if (maxLeft < minLeft) left = minLeft
  else left = Math.min(Math.max(left, minLeft), maxLeft)

  return { top, left, maxHeight, placement }
}
