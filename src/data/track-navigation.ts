/**
 * track-navigation — pure prev/next planning over an ORDERED track collection.
 *
 * The track detail modal navigates whatever collection its caller opened it
 * from (a cluster's subjects, the events page's embed-ordered gallery) without
 * closing. The caller owns the collection and the selection; this module owns
 * only the neighbour maths, so every surface disables/advances the same way.
 * Stateless and side-effect-free (no React). Unit-tested in
 * `__tests__/track-navigation.spec.ts`.
 */

/** Where the current track sits in its collection, and where it can move. */
export interface TrackNavPlan {
  /** 0-based position of the current track. */
  readonly index: number
  readonly count: number
  readonly hasPrev: boolean
  readonly hasNext: boolean
  readonly prevId: string | null
  readonly nextId: string | null
}

/**
 * The contract a caller hands the detail body to enable prev/next controls.
 * `position` is 1-based (display), the callbacks move the CALLER's selection —
 * the modal never owns the collection.
 */
export interface TrackDetailNavigation {
  readonly position: number
  readonly count: number
  readonly hasPrev: boolean
  readonly hasNext: boolean
  readonly onPrev: () => void
  readonly onNext: () => void
}

/**
 * Plan navigation for `currentId` within the ordered `ids`.
 *
 * Returns null when there is nothing to navigate: the current track is not in
 * the collection (deep link, stale list) or the collection holds fewer than
 * two items — arrows there would be dead weight, not controls. A duplicated id
 * resolves to its FIRST occurrence.
 */
export function planTrackNavigation(
  ids: readonly string[],
  currentId: string | null,
): TrackNavPlan | null {
  if (currentId === null || ids.length < 2) return null
  const index = ids.indexOf(currentId)
  if (index < 0) return null
  const hasPrev = index > 0
  const hasNext = index < ids.length - 1
  return {
    index,
    count: ids.length,
    hasPrev,
    hasNext,
    prevId: hasPrev ? (ids[index - 1] ?? null) : null,
    nextId: hasNext ? (ids[index + 1] ?? null) : null,
  }
}
