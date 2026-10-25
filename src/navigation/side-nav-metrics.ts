/**
 * How much window the side navigation rail takes, as plain numbers.
 *
 * Split out of `SideNavRail.tsx` because two OTHER surfaces have to subtract
 * this width from the window before they can size themselves, and importing a
 * `.tsx` component to read a literal drags react-native into modules that are
 * meant to stay pure. The rail is the component; these are its metrics.
 *
 * `insets.left` is added on the device (the notch in landscape) and is NOT
 * part of these constants: it is a runtime value the caller already has.
 */

/**
 * The rail's width. ONE number: the rail is icon-only everywhere.
 *
 * There used to be two — a 72pt labelled variant for tablets and wide web, and
 * this one "for phone landscape, where labels would truncate". The threshold
 * was the wrong question: 72pt does not fit `Telecamere` or `Impostazioni` at
 * any window width, so the labelled variant truncated wherever it appeared
 * (*"nascondiamo le labels quando la barra e' di lato"*, 2026-09-21, from a Mac
 * window reading `Teleca…` / `Imposta…`). A rail beside the content has no room
 * for words. The BOTTOM bar, which has the whole width, keeps its labels.
 */
export const SIDE_NAV_WIDTH = 56

export interface SideNavFootprintInput {
  /** Is the rail on screen at all? `fill` and phones in portrait hide it. */
  readonly visible: boolean
  /** `useSafeAreaInsets().left` — the rail widens by it, see `SideNavRail`. */
  readonly insetLeft: number
}

/** Points the rail takes OUT of the window width. `0` when it is not shown. */
export function sideNavFootprint({ visible, insetLeft }: SideNavFootprintInput): number {
  if (!visible) return 0
  return SIDE_NAV_WIDTH + (Number.isFinite(insetLeft) && insetLeft > 0 ? insetLeft : 0)
}
