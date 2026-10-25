/**
 * stream-nav-bar — whether the app's main navigation stays on screen while a
 * single camera is open, and what that costs the column underneath.
 *
 * ## The gap this closes
 *
 * The camera detail is a STACK route pushed OVER the tabs, and it paints
 * opaque, so the tab navigator's bar is simply covered. On a wide window the
 * screen already fixes this by mounting `SideNavRail` itself (2026-08-20) — the
 * rail IS the navigation there and it is always on. On a phone in portrait
 * there was no equivalent, so opening a camera left the operator with no way
 * back to Libreria or Griglie except the back arrow.
 *
 * The setting adds the missing half, and nothing more: `stream.navBarOnStream`
 * mounts the SAME bottom bar the tab navigator would have drawn for this
 * window. Where the rail is already showing, the navigation is already visible
 * and the setting has nothing to add — which is why {@link
 * shouldShowStreamNavBar} refuses on `showSidebar` rather than drawing two
 * navigations at once.
 *
 * `fill` keeps its meaning untouched: an explicit fullscreen, and a phone in
 * landscape, own the whole window. That is the same gate `SideNavRail` is
 * behind on this screen, quoted rather than re-decided.
 *
 * Pure — no React. The bar itself is `navigation/BottomNavBar.tsx` and its
 * height is `navigation/bottom-nav-metrics.ts`.
 */

export interface StreamNavBarInput {
  /** `settings.stream.navBarOnStream`. OFF by default — today's behaviour. */
  readonly enabled: boolean
  /** Is the side rail on screen? Then the navigation already is. */
  readonly showSidebar: boolean
  /** The picture owns the window (explicit fullscreen, or a phone in landscape). */
  readonly fill: boolean
}

/** Does the single-stream screen draw the bottom navigation bar? */
export function shouldShowStreamNavBar({
  enabled,
  showSidebar,
  fill,
}: StreamNavBarInput): boolean {
  return enabled && !showSidebar && !fill
}

export interface StreamColumnHeightInput {
  /** `useViewportSize().height`. */
  readonly windowHeight: number
  /** `bottomNavFootprint(...)` — 0 whenever the bar is not drawn. */
  readonly navBarFootprint: number
}

/**
 * The vertical space the camera-detail COLUMN actually has.
 *
 * This exists because `computeWideDetailSizes` caps the picture at
 * `STREAM_MAX_HEIGHT_FRACTION` of a viewport height, and everything below the
 * picture — today the camera shelf — lives on the remainder. Handing it the raw
 * window height ASSUMES the column owns the whole window; the moment anything
 * else is drawn under it, the shelf is squeezed by exactly the amount nobody
 * subtracted.
 *
 * With today's breakpoints the bar and the shelf cannot appear together (proved
 * by value in `stream-nav-bar.spec.ts`), so this subtracts zero in every shipped
 * state. It is written anyway because "they cannot coexist" is a property of two
 * breakpoint tables that are tuned by the operator, not a law — and the
 * failure it prevents is silent: a shelf that is short by 64pt looks like a
 * shelf.
 *
 * A degenerate result falls back to the window rather than to nothing, the same
 * way `resolveContainerWidth` does: sizing a picture against 0 is worse than
 * sizing it against a slightly generous number.
 */
export function streamColumnHeight({
  windowHeight,
  navBarFootprint,
}: StreamColumnHeightInput): number {
  const left = windowHeight - navBarFootprint
  return left > 0 ? left : Math.max(0, windowHeight)
}
