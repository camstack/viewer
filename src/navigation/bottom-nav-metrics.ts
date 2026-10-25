/**
 * How much window the bottom navigation bar takes, as plain numbers.
 *
 * The exact counterpart of `side-nav-metrics.ts`, and for the exact same
 * reason: a second surface now has to subtract this bar from the window before
 * it can size itself (the camera detail, when the operator asks for the bar to
 * stay visible over a single stream), and importing a `.tsx` component to read
 * a literal drags react-native into modules meant to stay pure.
 *
 * ## Why the bar is given an explicit height instead of growing to its content
 *
 * A metric that GUESSES the height of something laid out by padding is a
 * measurement nobody checks. `side-nav-metrics.ts` already says it: "two copies
 * of a rail width is how one surface ends up laying out against the other's
 * idea of it". So the bar renders at {@link BOTTOM_NAV_ROW_HEIGHT} + its bottom
 * padding, and this module reports the same expression — one number, drawn and
 * subtracted, and no way for the two to disagree.
 *
 * `insets.bottom` is a runtime value the caller already has and is NOT part of
 * the constant; {@link bottomNavPaddingBottom} is the one rule for turning it
 * into the padding under the icons (the home indicator on a modern iPhone, a
 * small constant on a device that has none).
 */

/**
 * Drawn height (pt) of the floating glass capsule — icon, label and its inner
 * padding — EXCLUDING the gap under it.
 *
 * 60 rather than "whatever the content comes to": the natural content is 45pt
 * (4 + 22 + 3 + ~12 + 4) plus the capsule's own 4pt padding either side, i.e.
 * 53, so this leaves slack for a larger text scale.
 */
export const BOTTOM_NAV_ROW_HEIGHT = 60

/** Gap under the capsule when the device reports no bottom inset. */
export const BOTTOM_NAV_FALLBACK_INSET = 12

/** Gap (pt) between the capsule and the sides of the window. */
export const BOTTOM_NAV_SIDE_MARGIN = 12

/**
 * The gap under the capsule: it floats just above the home indicator, so the
 * inset minus the indicator's own breathing room, never less than the fallback.
 * A negative or non-finite inset is not trusted.
 */
export function bottomNavPaddingBottom(insetBottom: number): number {
  return Number.isFinite(insetBottom) && insetBottom > 0
    ? Math.max(insetBottom - 8, BOTTOM_NAV_FALLBACK_INSET)
    : BOTTOM_NAV_FALLBACK_INSET
}

export interface BottomNavFootprintInput {
  /** Is the bar on screen at all? A side rail, `fill` and the default single
   *  stream all hide it. */
  readonly visible: boolean
  /** `useSafeAreaInsets().bottom`. */
  readonly insetBottom: number
}

/** Points the bar takes OUT of the window height (capsule + the gap under it). `0` when it is not shown. */
export function bottomNavFootprint({ visible, insetBottom }: BottomNavFootprintInput): number {
  if (!visible) return 0
  return BOTTOM_NAV_ROW_HEIGHT + bottomNavPaddingBottom(insetBottom)
}
