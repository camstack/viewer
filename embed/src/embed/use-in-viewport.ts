/**
 * use-in-viewport — has this card come near the visible area yet?
 *
 * ## Why this exists, with the number
 *
 * A gallery first-paint mounts `pageSize` cards, and every card used to start
 * its own authenticated thumbnail fetch immediately. Measured against the live
 * hub with 60 rows — the default page:
 *
 * ```
 *   ALL 60 CONCURRENT    13 608 ms   (median single request 11 664 ms)
 *   FIRST 12 ONLY           659 ms
 * ```
 *
 * Total payload is 423 KB, so this is not bandwidth. Each thumbnail is
 * server-rendered (`makeSquareThumb` re-encodes a ~90 KB source), so sixty at
 * once queue on the addon's event loop and every one of them waits for the
 * whole batch. The user sees ten-plus seconds of skeletons for a screen that
 * holds a dozen tiles.
 *
 * Loading only what is near the viewport turns that into ~0.7 s, and the rest
 * arrive as they are scrolled to. Same bytes, twenty times sooner.
 *
 * ## Why an observer per card and not a scroll listener
 *
 * A scroll handler would run on every frame of a momentum scroll and would have
 * to measure each card. `IntersectionObserver` is delivered off the main thread
 * and reports only transitions — and here the transition semantics are exactly
 * right, because "near the viewport" is a state, not an event.
 *
 * **Latching is deliberate**: once a card has been seen it stays seen, so
 * scrolling back does not re-enter the loading state for bytes the blob cache
 * already holds. This hook only ever goes false → true.
 */
import { useEffect, useRef, useState } from 'react'

/**
 * How far outside the scroller a card counts as "coming" — ONE VIEWPORT.
 *
 * Measured from the scroller rather than fixed at 600 px, because 600 is a
 * screen and a half on a phone and a third of one on a tablet: the same
 * constant means two different policies. One viewport ahead is the policy —
 * "everything on screen, plus the next screenful" — on every device.
 *
 * That is the eager half. Everything BELOW it is warmed by
 * `use-image-preloader`, in order and rate-limited, so scrolling past the
 * margin still finds bytes in the cache instead of a fresh request.
 */
function viewportMarginPx(root: Element | null): number {
  const h = root?.clientHeight ?? 0
  // A scroller with no measured height falls back to a sane screenful rather
  // than to 0, which would load nothing until the user scrolled.
  return h > 0 ? h : 600
}

export interface InViewportOptions {
  /** The scrolling element. `null` until the page has mounted its ref. */
  readonly root: Element | null
  /**
   * Skip the observer entirely and report visible immediately.
   *
   * For environments with no layout (jsdom) and for hosts that render the embed
   * off-screen: an unmeasurable card would otherwise never load its image at
   * all, which is a worse failure than loading it early.
   */
  readonly disabled?: boolean
}

/**
 * Returns true once `ref`'s element has come within {@link VIEWPORT_MARGIN_PX}
 * of `root`. Latches — never returns to false.
 */
export function useInViewport(
  ref: React.RefObject<Element | null>,
  options: InViewportOptions,
): boolean {
  const { root, disabled } = options
  const [seen, setSeen] = useState(disabled === true)
  const seenRef = useRef(seen)
  seenRef.current = seen

  useEffect(() => {
    if (seenRef.current) return
    if (disabled === true) {
      setSeen(true)
      return
    }
    const el = ref.current
    // No element yet, or an environment without the API: fail OPEN. A tile that
    // cannot be observed must still get its picture.
    if (!el || typeof IntersectionObserver !== 'function') {
      setSeen(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          observer.disconnect()
        }
      },
      { root, rootMargin: `${viewportMarginPx(root)}px` },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, root, disabled])

  return seen
}
