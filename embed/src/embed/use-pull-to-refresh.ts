/**
 * use-pull-to-refresh — overscroll-at-top gesture inside the embed's own
 * scroller.
 *
 * ## Who owns the gesture — this hook, OR a native RefreshControl above
 *
 * A host wrapping the WebView in a `RefreshControl` was originally rejected
 * outright: a `RefreshControl` belongs to a native scroll view, and nested
 * scrolling between a `UIScrollView` and a `WKWebView` is unreliable exactly
 * because the outer view cannot know when the inner scroller is at its top —
 * it either steals the gesture mid-list or never fires at all.
 *
 * That "cannot know" is no longer true: with `nativePullToRefresh` the embed
 * REPORTS its own `scrollTop` at-top transitions over the bridge (`scroll`
 * messages), the native host arms its control only then, and THIS hook stands
 * down entirely ({@link internalPullGestureEnabled}) so there are never two
 * pull gestures on one surface. The operator asked for exactly this: the
 * native spinner, identical to the Cameras page.
 *
 * The embed still OWNS the gesture everywhere else — the web host (`<iframe>`)
 * has no native control to hand it to, and gets this one for free.
 *
 * ## Why it cannot break normal scrolling
 *
 * It never calls `preventDefault` and never touches `touch-action`. On iOS,
 * cancelling a `touchmove` kills momentum scrolling for the whole gesture —
 * that is the classic way a hand-rolled pull-to-refresh ruins a list. This is
 * purely OBSERVATIONAL: it reads `scrollTop` and the finger delta, and the only
 * thing it produces is a number. The caller renders that number as a transform;
 * the browser keeps doing exactly what it would have done anyway (including
 * iOS's own rubber-band, which moves in the same direction).
 *
 * It engages only when the scroller is already AT the top when the finger lands
 * — mid-list drags are not its business — and it disengages the moment the
 * gesture turns into a real scroll.
 *
 * ## Resistance
 *
 * The pull is damped so it reads as elastic rather than as a drag: half the
 * finger distance, capped. The threshold is the point where the indicator is
 * fully formed, so release-to-refresh matches what the user can see.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EventsView } from './events-config'

/** Finger distance is halved — a 1:1 pull feels like the list is stuck to the
 *  thumb, and every native implementation damps it. */
const RESISTANCE = 0.5
/** Pull distance (px, after damping) that triggers a refresh on release. */
export const PULL_THRESHOLD_PX = 56
/** Hard cap so a long drag cannot push the grid off screen. */
const MAX_PULL_PX = 88

/** Damped pull distance for a raw finger delta. Pure — the feel is testable. */
export function pullDistance(rawDeltaY: number): number {
  if (rawDeltaY <= 0) return 0
  return Math.min(rawDeltaY * RESISTANCE, MAX_PULL_PX)
}

/** Does releasing at this distance trigger a refresh? */
export function shouldTriggerRefresh(distance: number): boolean {
  return distance >= PULL_THRESHOLD_PX
}

/**
 * Whether the embed's OWN overscroll gesture runs. Pure — the three gates in
 * one testable place:
 *  - gallery only (the reel scrolls horizontally; a vertical pull there is not
 *    a gesture the user is making on purpose);
 *  - never over semantic results (a complete set, not a feed to refresh);
 *  - never when a NATIVE host took the gesture (`nativePullToRefresh`) — two
 *    overlapping pull gestures is worse than either alone.
 */
export function internalPullGestureEnabled(
  view: EventsView,
  semanticActive: boolean,
  nativePullToRefresh: boolean,
): boolean {
  return view === 'gallery' && !semanticActive && !nativePullToRefresh
}

export interface PullToRefreshOptions {
  /** The scrolling element. Null until mounted. */
  readonly root: HTMLElement | null
  /** Run the refresh. Called once per qualifying gesture. */
  readonly onRefresh: () => void
  /** Turn the gesture off (the reel scrolls horizontally; a vertical pull there
   *  is not a gesture the user is making on purpose). */
  readonly enabled: boolean
}

export interface PullToRefreshState {
  /** Current damped pull distance in px. 0 when not pulling. */
  readonly distance: number
  /** Past the threshold — the indicator should read "release to refresh". */
  readonly armed: boolean
}

export function usePullToRefresh(options: PullToRefreshOptions): PullToRefreshState {
  const { root, onRefresh, enabled } = options
  const [distance, setDistance] = useState(0)
  const startYRef = useRef<number | null>(null)
  const distanceRef = useRef(0)
  distanceRef.current = distance
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  const reset = useCallback((): void => {
    startYRef.current = null
    setDistance(0)
  }, [])

  useEffect(() => {
    if (!enabled || root === null) return

    const onTouchStart = (e: TouchEvent): void => {
      // Only a gesture that BEGINS at the top is a pull. Anything else is a
      // scroll, and treating it as a pull is how a list stops scrolling.
      if (root.scrollTop > 0) {
        startYRef.current = null
        return
      }
      const touch = e.touches[0]
      startYRef.current = touch !== undefined ? touch.clientY : null
    }

    const onTouchMove = (e: TouchEvent): void => {
      const startY = startYRef.current
      if (startY === null) return
      const touch = e.touches[0]
      if (touch === undefined) return
      // The user scrolled away from the top mid-gesture (or started scrolling
      // up): this is a scroll now, not a pull. Let go of it completely.
      if (root.scrollTop > 0) {
        startYRef.current = null
        setDistance(0)
        return
      }
      // NO preventDefault — see the module note. The browser scrolls/rubber-
      // bands exactly as it would; this only measures.
      setDistance(pullDistance(touch.clientY - startY))
    }

    const onTouchEnd = (): void => {
      if (startYRef.current === null) return
      const travelled = distanceRef.current
      reset()
      if (shouldTriggerRefresh(travelled)) onRefreshRef.current()
    }

    // Passive listeners, explicitly: this handler never cancels anything, and
    // saying so lets the compositor keep scrolling on its own thread.
    const passive = { passive: true } as const
    root.addEventListener('touchstart', onTouchStart, passive)
    root.addEventListener('touchmove', onTouchMove, passive)
    root.addEventListener('touchend', onTouchEnd, passive)
    root.addEventListener('touchcancel', reset, passive)
    return () => {
      root.removeEventListener('touchstart', onTouchStart)
      root.removeEventListener('touchmove', onTouchMove)
      root.removeEventListener('touchend', onTouchEnd)
      root.removeEventListener('touchcancel', reset)
    }
  }, [root, enabled, reset])

  return { distance, armed: shouldTriggerRefresh(distance) }
}
