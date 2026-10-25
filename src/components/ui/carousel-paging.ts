/**
 * carousel-paging — pure index arithmetic for EVERY paged surface in the app.
 *
 * Born as the timeline cluster card's in-box carousel
 * (`components/camera/theater/cluster-carousel.ts`) and promoted here when the
 * face review tab needed the same behaviour for its detail modal and its
 * look-alike groups. It moved rather than being copied: a second carousel with
 * its own idea of what "next" does at the last page is exactly the divergence
 * this module's two commitments exist to prevent.
 *
 * Consumers: `ClusterCard` (bespoke on-card chrome) and `CarouselPager` (the
 * shared arrows/counter shell).
 *
 * Two commitments, both operator-specified:
 *
 *  1. **Clamp, never wrap.** "Next" always means the next page; at either end
 *     the step is a no-op and the arrow disappears ({@link canStepCarousel}).
 *     A wrap would silently teleport "7/7 → 1/7" under a finger expecting to
 *     stop.
 *  2. **Adjacent-only preload.** {@link mountedCarouselIndices} is the ONLY
 *     authority on which pages have their media mounted: the current page ±1,
 *     never the whole cluster — a 12-track cluster must cost 3 thumbnail
 *     fetches, not 12.
 *
 * Stateless and React-free so it unit-tests under the node vitest environment.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single arrow press: -1 = previous (older page), 1 = next. */
export type CarouselDirection = -1 | 1

// ─── Functions ────────────────────────────────────────────────────────────────

/** Clamp `index` into `[0, count)`. An empty (or negative-count) carousel
 *  answers 0 so callers can always use the result as a state value. */
export function clampCarouselIndex(index: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(Math.max(0, index), count - 1)
}

/** One arrow press: clamp the (possibly stale) current index into range, move
 *  one page in `direction`, and clamp again — no wrap at either end. */
export function stepCarouselIndex(
  index: number,
  direction: CarouselDirection,
  count: number,
): number {
  return clampCarouselIndex(clampCarouselIndex(index, count) + direction, count)
}

/** Whether an arrow in `direction` would actually move — i.e. whether that
 *  arrow should render at all. */
export function canStepCarousel(
  index: number,
  direction: CarouselDirection,
  count: number,
): boolean {
  return stepCarouselIndex(index, direction, count) !== clampCarouselIndex(index, count)
}

/** The pages whose media is MOUNTED while the carousel is open: the current
 *  page plus its immediate neighbours, in ascending order. This is the
 *  adjacent-only preload window — at most 3 wide, regardless of cluster size. */
export function mountedCarouselIndices(index: number, count: number): readonly number[] {
  if (count <= 0) return []
  const current = clampCarouselIndex(index, count)
  const indices: number[] = []
  for (let i = current - 1; i <= current + 1; i += 1) {
    if (i >= 0 && i < count) indices.push(i)
  }
  return indices
}
