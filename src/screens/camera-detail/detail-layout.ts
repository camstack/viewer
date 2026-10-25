/**
 * detail-layout — the camera-detail screen's ONE layout decision, as a pure
 * function.
 *
 * The screen used to derive its shape from two booleans computed inline
 * (`isWideDetail`, then `fill = fullscreen || (isLandscape && !isWideDetail)`),
 * and every consumer re-derived what they meant: the stream box, the video
 * cover style, the zoom fit, the status bar, the safe-area padding and the
 * timeline host each read the pair and drew its own conclusion. That is how a
 * rotation could leave one part of the tree in landscape and another in
 * portrait — a defect this file's history documents twice. Consolidating the
 * question here is the ONLY part of the 2026-08-08 timeline work that survived;
 * see below for what did not.
 *
 * There are exactly THREE shapes, and this returns which one:
 *
 *   fill   — the picture owns the window. Explicit fullscreen, or ANY phone in
 *            landscape. The timeline rides in `LandscapeTimelineOverlay`, the
 *            compact right-edge drawer.
 *   wide   — SIDE BY SIDE: stream column left, timeline rail right. A wide WEB
 *            window (>= 1000pt) or a real tablet in landscape — and nothing
 *            else. See the reverted-behaviour note.
 *   stack  — the portrait column: toolbar, stream, timeline. The layout the
 *            operator is happy with; nothing here may regress it.
 *
 * ## A tablet in landscape is ALWAYS `wide` (2026-08-14)
 *
 * It is `wide` for every window shape the device can be in while it is
 * physically landscape — keyboard open, window resized, chrome grown. The
 * tablet question is asked of `screenMinSide` (the device screen) and only the
 * ORIENTATION is read off the window; `sidebar-rules.ts` carries the full
 * account of the oscillation that made this necessary. Callers that do not pass
 * `screenMinSide` fall back to the window, which is correct on web and merely
 * the old behaviour anywhere else.
 *
 * "The window" here is what `useViewportSize()` resolves — on a device the
 * safe-area FRAME, not `Dimensions`. The fourth round of this report
 * (2026-09-10) was `Dimensions` still saying portrait inside a landscape view
 * tree, for the rest of the session; `hooks/viewport-size.ts` has the numbers.
 *
 * ## Reverted 2026-08-08 (operator feedback on OTA 1.0.263)
 *
 * `shouldUseWideDetail` was briefly widened so a landscape PHONE (>= 700pt) and
 * an unfolded foldable also resolved to `wide`. The operator judged the
 * side-by-side split too invasive on those surfaces and asked for the previous
 * behaviour back: landscape/fill keeps the compact edge drawer. The widening
 * lives only in git history — do not reintroduce it without the operator, and
 * do not "fix" the fact that a landscape phone hides its timeline behind a
 * toggle. That IS the requested design.
 *
 * The toolbar placement follows from the shape rather than being chosen again:
 * only `stack` hoists the timeline's toolbar row ABOVE the stream (operator
 * request, and the one piece of that work that was KEPT — in portrait the
 * toolbar belongs at the top of the screen, not pinned under the picture).
 * `wide` and `fill` keep it inline at the top of the timeline column, which IS
 * the top of its own space.
 */
import {
  isLandscapeViewport,
  isTabletViewport,
  shouldUseWideDetail,
  type ViewportInput,
} from '../../hooks/sidebar-rules.js'

export type DetailLayoutMode = 'fill' | 'wide' | 'stack'

/** Where the timeline's toolbar row renders. */
export type DetailToolbarPlacement = 'top' | 'inline'

export interface DetailLayoutInput extends ViewportInput {
  /** Manual fullscreen (native flag / the web Fullscreen API). Wins over all. */
  readonly fullscreen: boolean
}

/** The screen's shape. See the module docblock for what each one means. */
export function resolveDetailLayoutMode(input: DetailLayoutInput): DetailLayoutMode {
  if (input.fullscreen) return 'fill'
  if (shouldUseWideDetail(input)) return 'wide'
  // Landscape on anything that is not a wide web window or a tablet: the
  // picture takes the window and the timeline stays reachable through the
  // compact edge drawer. Restored 2026-08-08 — see the docblock.
  //
  // `isLandscapeViewport` and not a second `width > height`: one definition of
  // landscape, and it is the one that tolerates a square mid-rotation frame and
  // refuses a degenerate measurement.
  return isLandscapeViewport(input) ? 'fill' : 'stack'
}

/**
 * Toolbar placement for a resolved mode. `top` means the SCREEN hosts the
 * stream INSIDE the timeline column (below its toolbar row) — see
 * `TheaterTimeline`'s `stream` prop — which is the only way a single toolbar
 * can sit above the picture without a second copy of its state.
 */
export function toolbarPlacementFor(mode: DetailLayoutMode): DetailToolbarPlacement {
  return mode === 'stack' ? 'top' : 'inline'
}

/** `true` when the picture fills the window (no stacked/rail timeline). */
export function isFillMode(mode: DetailLayoutMode): boolean {
  return mode === 'fill'
}

/**
 * `testID` for the timeline root, carrying the shape it RESOLVED to.
 *
 * The shape is the whole layout decision of this screen and it is otherwise
 * invisible to a test: `wide` and `stack` differ by a flex direction and by
 * which child index the toolbar occupies, and asserting on either is asserting
 * on styling rather than on the decision. `testID` reaches the web as
 * `data-testid` and is inert on a device (same use as
 * `cameras-reel-placement.ts`).
 *
 * It exists for ONE claim: a sequence of navigations must not change the shape
 * while the screen size holds still. See `detail-navigation-layout.spec.ts`.
 */
export function detailShapeTestId(shape: DetailLayoutMode): string {
  return `theater-shape-${shape}`
}

/**
 * The operator's reported symptom, as a predicate: a TABLET-class device whose
 * theater nonetheless resolved to the portrait stack.
 *
 * It is not a bug by itself — an iPad genuinely held in portrait resolves here,
 * and so does one in a half-width Split View, which `app.config.ts` allows
 * (`supportsTablet: true`, no `requireFullScreen`). It is a bug REPORT: the
 * screen cannot tell those apart, but the line it writes when this is true
 * carries the window next to the device screen, which does tell them apart in
 * the next report.
 *
 * Written at `warn`, deliberately. The existing `theater` geometry line is
 * `debug`, and debug mode is off in every report this defect has produced —
 * so three rounds of "la timeline va sotto" have arrived with no numbers
 * attached. `warn` always ships (`lib/logger.ts`).
 */
export function isUnexpectedPortraitStack(
  input: DetailLayoutInput,
  mode: DetailLayoutMode,
): boolean {
  return mode === 'stack' && isTabletViewport(input)
}
