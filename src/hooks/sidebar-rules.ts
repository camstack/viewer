/**
 * The viewport rules: ONE definition of "tablet", one of "landscape", and the
 * layout gates derived from them. Pure (no react-native import) so vitest covers
 * them in the node env — `use-responsive.ts` is the hook wrapper, and
 * `grid/grid-timeline-surface.ts` reuses {@link TABLET_MIN_SIDE} rather than inventing a
 * second, quietly different, tablet.
 *
 * ## Two different questions, deliberately answered from two different sources
 *
 * "Is this a TABLET?" is a question about the DEVICE, and the answer must not
 * move while the device does not. It is therefore asked of {@link
 * ViewportInput.screenMinSide} — the shortest side of the physical screen —
 * whenever the caller knows it.
 *
 * "Does this WINDOW have room for X?" is a question about the window, and it
 * stays keyed to the window: {@link shouldShowSidebar} asks whether the nav
 * LABELS fit, which is a fit question, not a device question.
 *
 * The distinction is the fix for a reported defect, not decoration. The tablet
 * test used to be `Math.min(windowWidth, windowHeight) >= 768`, and in landscape
 * the shortest side IS the window height — the one dimension that shrinks while
 * the device sits still: the Android soft keyboard (`adjustResize`), browser
 * chrome on the hub's web viewer, a Stage Manager resize. An iPad 11" in
 * landscape is 1194×834, sixty-six points of headroom; one keyboard and the
 * motionless tablet stopped being a tablet, the camera theater dropped out of
 * its side-by-side rail, and the timeline went back under the picture. That is
 * the "spesso cambia la visualizzazione" the operator reported.
 */

/** Shortest side (pt) at/above which a device is a tablet. A phone's shortest
 *  side stays ~390–430, so keying off the SHORTEST side is what stops a phone in
 *  landscape (932×430) reading as a tablet and getting the wide labelled sidebar
 *  whose labels then truncated ("Telecan", "Grigl"…). */
export const TABLET_MIN_SIDE = 768

/** Width (pt) at/above which a web window gets the persistent sidebar even when
 *  its height is short (a landscape laptop browser). */
export const WEB_SIDEBAR_MIN_WIDTH = 900

/** Width (pt) at/above which a web window is wide enough for the camera-detail
 *  WIDE layout: stream column + the fixed 380px vertical timeline rail. Below
 *  it (380 rail + <600 stream) the mobile stack reads better. */
export const DETAIL_WIDE_MIN_WIDTH = 1000

/** A measured window. */
export interface ViewportSize {
  readonly width: number
  readonly height: number
}

export interface SidebarInput extends ViewportSize {
  readonly isWeb: boolean
}

export interface ViewportInput extends SidebarInput {
  /**
   * Shortest side (pt) of the DEVICE screen — `Dimensions.get('screen')`, which
   * no soft keyboard, browser chrome or window resize can shrink.
   *
   * `undefined` means "not known", and the tablet test falls back to the window.
   * It is deliberately NOT supplied on web: there the browser window IS the
   * device, and the monitor behind it says nothing about the surface (a 420pt
   * window on a 27" screen is not a tablet).
   */
  readonly screenMinSide?: number
}

/** A dimension we can reason about: a real, positive number. */
function isMeasured(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

/**
 * Is the window landscape?
 *
 * `>=` and not `>`: a rotation passes through square-ish intermediate frames,
 * and committing the portrait stack on one of those is a visible flicker for a
 * layout that is about to be — or already is — the landscape rail. A genuinely
 * portrait window (820×1180) is nowhere near the boundary.
 *
 * A degenerate measurement is not landscape: callers then fall back to the
 * portrait stack instead of sizing a 380pt rail against nothing.
 */
export function isLandscapeViewport({ width, height }: ViewportSize): boolean {
  if (!isMeasured(width) || !isMeasured(height)) return false
  return width >= height
}

/** Which measurement {@link isTabletViewport} actually read. */
export type TabletSource = 'screen' | 'window'

/**
 * The source the tablet test reads, on its own.
 *
 * Exported for the layout diagnostic (`camera-detail/layout-trace.ts`): a report
 * carrying `screenMinSide: 834` and one carrying `screenMinSide: -1` describe
 * two different defects — a device that IS a tablet and was judged on its
 * screen, versus a native device whose screen was never measured and was
 * silently judged on its window, the dimension a keyboard shrinks. The number
 * alone cannot separate them; this can. {@link isTabletViewport} branches on
 * this function, so the reported source can never disagree with the answer.
 */
export function tabletSourceFor({ isWeb, screenMinSide }: ViewportInput): TabletSource {
  return !isWeb && screenMinSide !== undefined && isMeasured(screenMinSide) ? 'screen' : 'window'
}

/**
 * Is this a tablet-class DEVICE? Keyed off the device screen when the caller
 * knows it (native), the window otherwise (web, and any caller that has not been
 * given the screen). See the module docblock for why the source matters.
 */
export function isTabletViewport(input: ViewportInput): boolean {
  const { width, height, screenMinSide } = input
  if (tabletSourceFor(input) === 'screen') {
    return (screenMinSide ?? 0) >= TABLET_MIN_SIDE
  }
  return Math.min(width, height) >= TABLET_MIN_SIDE
}

/**
 * Side nav shows for: a real tablet (shortest side >= 768), a phone in
 * landscape, OR a wide web window.
 *
 * Still keyed to the WINDOW on purpose: this is the "do the labels fit" question
 * (see the module docblock), and a tablet in a narrow split view genuinely has
 * no room for the labelled rail.
 */
export function shouldShowSidebar({ width, height, isWeb }: SidebarInput): boolean {
  const isTablet = Math.min(width, height) >= TABLET_MIN_SIDE
  const isPhoneLandscape = Math.min(width, height) < TABLET_MIN_SIDE && width > height
  const isWideWeb = isWeb && width >= WEB_SIDEBAR_MIN_WIDTH
  return isTablet || isPhoneLandscape || isWideWeb
}

/**
 * Camera-detail wide layout (stream left + timeline rail right).
 *
 * THE OPERATOR RULE: a tablet in landscape is ALWAYS side by side. It does not
 * matter how short the window has become — the keyboard is open, the window was
 * resized, the browser grew a bar. Orientation comes off the window; tablet-ness
 * comes off the device.
 *
 * Plus a wide web window, which has no device to ask.
 *
 * Phone landscape keeps the full-window stream (`fill`) and tablet portrait
 * keeps the mobile stack — both restored on 2026-08-08 after operator feedback
 * on OTA 1.0.263 and not to be widened again without the operator.
 */
export function shouldUseWideDetail(input: ViewportInput): boolean {
  if (isTabletViewport(input) && isLandscapeViewport(input)) return true
  return input.isWeb && input.width >= DETAIL_WIDE_MIN_WIDTH
}

/** What an immersive screen knows about the device it is leaving. */
export interface PortraitRestoreInput {
  /** Shortest side (pt) of the physical screen; `undefined` on web by design. */
  readonly screenMinSide: number | undefined
  readonly isWeb: boolean
}

/**
 * When an immersive screen (the grid wall) closes, should the app be forced back
 * to PORTRAIT?
 *
 * Only on a phone. `ScreenOrientation.lockAsync` is APP-WIDE, so a grid that
 * restored portrait unconditionally rotated a TABLET out of landscape on its way
 * out — and the adhoc grid is opened from the camera timeline, so the screen
 * that inherited the portrait window was usually the theater: the timeline
 * dropped under the picture on a tablet the operator was holding in landscape.
 *
 * **Never on web**, and this is the second half of the same defect.
 * `useScreenMinSide()` returns `undefined` on web on purpose (the browser window
 * IS the device), and reading that as "phone" made the hub-served viewer take
 * the phone branch on every grid close: `screen.orientation.lock('portrait')`,
 * which the browser rejects outside fullscreen — a swallowed rejection per
 * navigation — and HONOURS inside it, rotating a landscape iPad out of the
 * layout it was using. There is no lock on web that is ours to put back.
 *
 * An unmeasured NATIVE screen still keeps the phone behaviour: forcing portrait
 * on a device we could not size is the conservative half of the old default.
 */
export function shouldRestorePortraitLock({
  screenMinSide,
  isWeb,
}: PortraitRestoreInput): boolean {
  if (isWeb) return false
  if (screenMinSide === undefined || !isMeasured(screenMinSide)) return true
  return screenMinSide < TABLET_MIN_SIDE
}
