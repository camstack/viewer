/**
 * The simulated WINDOW, SCREEN and FRAME, for a mount test whose claim is about
 * layout.
 *
 * `react-native` resolves to `react-native-web` here, whose `Dimensions` reads
 * `document.documentElement.clientWidth/Height` for the window and
 * `window.screen.*` for the device — and jsdom reports **0** for all four. So
 * every mounted screen has been laying out at 0x0, which every viewport rule in
 * this app reads as "degenerate, fall back to the portrait stack". A layout
 * claim asserted at that size proves nothing.
 *
 * Setting the four values and dispatching `resize` is what makes
 * `useWindowDimensions()` and `useScreenMinSide()` answer like a device. The
 * SCREEN is separate from the WINDOW on purpose: `sidebar-rules.ts` asks the
 * device whether it is a tablet and the window only which way up it is, so a
 * harness that cannot set them apart cannot exercise the rule at all.
 *
 * The FRAME is the third measurement, and it is separate for the same reason:
 * on a device `useViewportSize()` reads the safe-area frame (the view tree)
 * ahead of `Dimensions` (a notification), because the two disagreed on the
 * tablet for whole sessions (`hooks/viewport-size.ts`). It defaults to the
 * window — the consistent case — and a spec that pulls them apart is
 * reproducing that report. Unset (no `setTestViewport` call), the stub frame is
 * `null` and the hook falls back to the window exactly as before.
 *
 * Same split as `app-state-control.ts` / `focus-control.ts`: a plain typed
 * module, so a spec never imports the untyped `react-native-web` graph.
 */

export interface TestViewport {
  /** Window width in CSS px — what `useWindowDimensions().width` reports. */
  readonly width: number
  readonly height: number
  /** Device screen; defaults to the window (the web case, where they are one). */
  readonly screenWidth?: number
  readonly screenHeight?: number
  /** The safe-area frame (`useSafeAreaFrame()`); defaults to the window. */
  readonly frameWidth?: number
  readonly frameHeight?: number
}

/** What the safe-area stub reports as its frame. `null` until a viewport is set. */
export interface TestFrame {
  readonly width: number
  readonly height: number
}

/** iPad 11" held in landscape, full screen. */
export const IPAD_LANDSCAPE: TestViewport = { width: 1194, height: 834 }
/** The same iPad, rotated. */
export const IPAD_PORTRAIT: TestViewport = { width: 834, height: 1194 }
/** iPhone 15 Pro Max in landscape — the `fill` path, and the surface every
 *  "tablet only" guarantee has to be proved against. */
export const IPHONE_LANDSCAPE: TestViewport = { width: 932, height: 430 }
/** The same iPhone upright — the `stack` path, and the ONLY window family that
 *  gets a bottom navigation bar (`stream-nav-bar.ts`). */
export const IPHONE_PORTRAIT: TestViewport = { width: 430, height: 932 }

function define(target: object, key: string, value: number): void {
  Object.defineProperty(target, key, { value, configurable: true })
}

let frame: TestFrame | null = null
const frameListeners = new Set<() => void>()

/** The current stub frame — `useSyncExternalStore` snapshot for the stub. */
export function currentTestFrame(): TestFrame | null {
  return frame
}

/** Subscribe the safe-area stub to frame changes. */
export function subscribeTestFrame(listener: () => void): () => void {
  frameListeners.add(listener)
  return () => {
    frameListeners.delete(listener)
  }
}

/**
 * Point the jsdom document, screen and frame at `viewport` and tell
 * react-native-web to re-read them. Wrap the call in `act()` when a tree is
 * already mounted — the resize lands as a `setState` in every
 * `useWindowDimensions()`, and the frame as a store change in every
 * `useSafeAreaFrame()`.
 */
export function setTestViewport(viewport: TestViewport): void {
  const screenWidth = viewport.screenWidth ?? viewport.width
  const screenHeight = viewport.screenHeight ?? viewport.height
  define(document.documentElement, 'clientWidth', viewport.width)
  define(document.documentElement, 'clientHeight', viewport.height)
  define(window.screen, 'width', screenWidth)
  define(window.screen, 'height', screenHeight)
  frame = {
    width: viewport.frameWidth ?? viewport.width,
    height: viewport.frameHeight ?? viewport.height,
  }
  window.dispatchEvent(new Event('resize'))
  for (const listener of frameListeners) listener()
}
