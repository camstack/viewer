/**
 * `theater:layout` — the camera-detail layout decision, as NUMBERS.
 *
 * ## Why this exists
 *
 * Three rounds of "in landscape la timeline va sotto" have arrived without a
 * single measurement, and the standing diagnosis blames a number that cannot
 * cause it: the container width falling under `RAIL_NARROW_BELOW` (1180).
 * `containerWidth` is not an input to {@link resolveDetailLayoutMode} at all —
 * it selects a 340 vs 380 pt RAIL *inside* the wide layout
 * (`wide-detail-sizes.ts`). The stacked-vs-wide gate reads exactly four things:
 * the viewport's two sides, the DEVICE screen's shortest side, and `isWeb`
 * (`sidebar-rules.ts`). This payload carries all of them next to BOTH
 * thresholds and next to the width machinery, so the next report settles which
 * one moved instead of re-opening the question.
 *
 * ## The fourth round was a stale WINDOW, and the payload said so
 *
 * The report of 2026-09-10 21:52 carried `measuredWidth: 1122` next to
 * `winWidth: 834` — a root 1194−72 wide inside a window that claimed to be
 * 834. `winWidth` came from `useWindowDimensions`, a notification; the root
 * came from a layout pass, the view tree. The gate read the notification. So
 * `winWidth`/`winHeight` are now the RESOLVED viewport (`use-viewport-size.ts`:
 * the safe-area frame on a device, the window on web) and the two raw sources
 * travel beside it — `viewportSource` says which one the gate read, and
 * `dimWidth`/`dimHeight` vs `frameWidth`/`frameHeight` show the disagreement
 * itself, so the next such report is one line, not a correlation.
 *
 * ## It reports, it does not judge
 *
 * Every field is a raw input or the branch that came out; nothing here says
 * "this is wrong". `isUnexpectedPortraitStack` already writes the suspicion at
 * `warn`, and it is blind to the one device this could plausibly be: a tablet
 * whose shortest side is under 768 (an iPad mini is 744) is not a tablet by
 * `TABLET_MIN_SIDE`, so it can stack all day without tripping that warning.
 * A verdict that cannot see the case is worse than none — the numbers below
 * do not need one.
 */
import { sideNavFootprint, type SideNavFootprintInput } from '../../navigation/side-nav-metrics.js'
import {
  DETAIL_WIDE_MIN_WIDTH,
  TABLET_MIN_SIDE,
  isLandscapeViewport,
  isTabletViewport,
  tabletSourceFor,
  type TabletSource,
} from '../../hooks/sidebar-rules.js'
import {
  containerWidthSource,
  type ContainerWidthSource,
  type MeasuredContainerWidth,
} from './container-width.js'
import type { ViewportReadout, ViewportSource } from '../../hooks/viewport-size.js'
import type { DetailLayoutInput, DetailLayoutMode } from './detail-layout.js'
// The rail threshold travels in the payload as a REPORTED constant, so the two
// thresholds are read side by side and never confused for one another again.
import { RAIL_NARROW_BELOW } from './wide-detail-sizes.js'

/**
 * The scope every line here is written under.
 *
 * It is in `ALWAYS_SHIP_SCOPES` (`lib/logger.ts`). It has to be: this is an
 * `info` scope, the operator files reports with debug mode OFF, and an `info`
 * line from an unlisted scope never leaves the device — which is precisely the
 * silence this instrumentation exists to end.
 */
export const DETAIL_LAYOUT_SCOPE = 'theater:layout'

/** How the WINDOW is shaped — the only thing orientation means to this screen. */
export type ViewportOrientation = 'landscape' | 'portrait'

export interface DetailLayoutTraceInput {
  readonly deviceId: number
  /** The exact object `resolveDetailLayoutMode` was called with. */
  readonly layout: DetailLayoutInput
  /** The raw sources `layout.width/height` were resolved from. */
  readonly viewport: ViewportReadout
  /** The exact object `sideNavFootprint` was called with. */
  readonly sideNav: SideNavFootprintInput
  /** The latched layout pass, or `null` before the first one. */
  readonly measured: MeasuredContainerWidth | null
  /** What `resolveContainerWidth` returned for this render. */
  readonly containerWidth: number
  /** What `computeWideDetailSizes` returned for this render. */
  readonly railWidth: number
  /** The branch that came out of `resolveDetailLayoutMode`. */
  readonly mode: DetailLayoutMode
}

/**
 * One layout decision, flattened for the log payload.
 *
 * Deliberately flat and numeric: it is read out of Loki next to the hub's own
 * lines, and `-1` rather than `undefined`/`null` for the two optional numbers
 * so a missing value survives JSON and is still greppable.
 */
export interface DetailLayoutTrace {
  readonly deviceId: number
  // ── the viewport the gate READ (resolved: frame on a device, window on web) ──
  readonly winWidth: number
  readonly winHeight: number
  readonly orientation: ViewportOrientation
  /** Which raw source `winWidth`/`winHeight` came from. */
  readonly viewportSource: ViewportSource
  // ── the two raw sources, so their disagreement is ON the line ──
  /** `useWindowDimensions()` — `Dimensions.window`, a notification. */
  readonly dimWidth: number
  readonly dimHeight: number
  /** `useSafeAreaFrame()` — the provider view's layout pass. `-1` on web. */
  readonly frameWidth: number
  readonly frameHeight: number
  // ── the device, raw ──
  /** `Dimensions.get('screen')`'s shortest side; `-1` when unknown (web). */
  readonly screenMinSide: number
  readonly isWeb: boolean
  // ── the stacked-vs-wide gate, and ONLY it ──
  /** Which input the tablet test read. See `tabletSourceFor`. */
  readonly tabletSource: TabletSource
  /** The threshold `screenMinSide`/`min(win)` was compared against. */
  readonly tabletMinSide: number
  readonly isTablet: boolean
  /** The web-only alternative gate: `width >= DETAIL_WIDE_MIN_WIDTH`. */
  readonly webWideMinWidth: number
  readonly fullscreen: boolean
  /** The branch chosen: `fill` | `wide` | `stack`. */
  readonly mode: DetailLayoutMode
  // ── the width machinery, which decides NOTHING above ──
  readonly sideNavVisible: boolean
  readonly insetLeft: number
  /** Points subtracted from the window for the rail (0 when it is hidden). */
  readonly sideNavWidth: number
  readonly containerWidth: number
  /** `measured` = a live pass for THIS window; `derived` = window minus rail. */
  readonly containerWidthSource: ContainerWidthSource
  /** The latched pass, `-1` when there is none. */
  readonly measuredWidth: number
  /** The window that pass was taken in — its expiry date. `-1` when none. */
  readonly measuredInWindowWidth: number
  readonly railWidth: number
  /** The rail threshold, so it is never again mistaken for the layout gate. */
  readonly railNarrowBelow: number
}

/** Flatten one render's layout inputs and outputs into the log payload. Pure. */
export function buildDetailLayoutTrace({
  deviceId,
  layout,
  viewport,
  sideNav,
  measured,
  containerWidth,
  railWidth,
  mode,
}: DetailLayoutTraceInput): DetailLayoutTrace {
  return {
    deviceId,
    winWidth: layout.width,
    winHeight: layout.height,
    orientation: isLandscapeViewport(layout) ? 'landscape' : 'portrait',
    viewportSource: viewport.source,
    dimWidth: viewport.dimWidth,
    dimHeight: viewport.dimHeight,
    frameWidth: viewport.frameWidth,
    frameHeight: viewport.frameHeight,
    screenMinSide: layout.screenMinSide ?? -1,
    isWeb: layout.isWeb,
    tabletSource: tabletSourceFor(layout),
    tabletMinSide: TABLET_MIN_SIDE,
    isTablet: isTabletViewport(layout),
    webWideMinWidth: DETAIL_WIDE_MIN_WIDTH,
    fullscreen: layout.fullscreen,
    mode,
    sideNavVisible: sideNav.visible,
    insetLeft: sideNav.insetLeft,
    sideNavWidth: sideNavFootprint(sideNav),
    containerWidth,
    containerWidthSource: containerWidthSource({
      measured,
      windowWidth: layout.width,
      sideNav,
    }),
    measuredWidth: measured?.width ?? -1,
    measuredInWindowWidth: measured?.windowWidth ?? -1,
    railWidth,
    railNarrowBelow: RAIL_NARROW_BELOW,
  }
}

/**
 * The identity of a DECISION, as a string.
 *
 * ## Why the line is bounded
 *
 * The emitter writes only when this changes, so the rate is one line per
 * TRANSITION rather than one per render — and a render here is cheap and
 * frequent (every playhead tick, every workspace edit, every panel open passes
 * through this screen). The fields are exactly the ones that can move the
 * layout or the rail: the two window sides, the device screen, the four
 * gate inputs, the branch, the rail footprint and where the column width came
 * from. All of them are quantised by physics — a rotation, a Split View drag, a
 * keyboard, a sidebar appearing — so a stationary tablet emits ONE line and
 * then nothing. `containerWidth` cannot chatter either: `onRootLayout` refuses
 * a non-positive pass and de-duplicates an identical one
 * (`CameraDetailScreen`), and a stale pass is refused wholesale by
 * `acceptsMeasurement`, so it settles within a frame or two of each rotation.
 *
 * The worst case is a live window drag on the hub's web viewer, which is
 * user-driven and self-limiting — the same shape as `theater:scrub`, one line
 * per gesture-ish, which the allowlist docblock already accepts.
 *
 * The two RAW viewport sources are in the signature on purpose: when
 * `Dimensions` catches up with the frame seconds after a rotation, that is a
 * second line for the same rotation — and it is the line that says how late
 * the notification was, which is the one number the 2026-09-10 report could
 * not give. Quantised by the same physics as the rest.
 */
export function detailLayoutTraceSignature(trace: DetailLayoutTrace): string {
  return [
    trace.winWidth,
    trace.winHeight,
    trace.orientation,
    trace.viewportSource,
    trace.dimWidth,
    trace.dimHeight,
    trace.frameWidth,
    trace.frameHeight,
    trace.screenMinSide,
    trace.isWeb ? 'w' : 'n',
    trace.tabletSource,
    trace.isTablet ? 't' : 'p',
    trace.fullscreen ? 'f' : '-',
    trace.mode,
    trace.sideNavWidth,
    trace.containerWidth,
    trace.containerWidthSource,
    trace.railWidth,
  ].join('|')
}
