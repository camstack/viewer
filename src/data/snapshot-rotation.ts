/**
 * The opening sweep — how the Cameras list gets one recent frame for every
 * camera when it is first opened, a few at a time.
 *
 * ## The gap this closes
 *
 * After [D108] the hub runs no warm timer: a frame is captured when, and only
 * when, a client NAMES that camera in `getSnapshotLinks`, and
 * `snapshot-viewport.ts` narrows that naming to what is on screen. Correct, and
 * it has a consequence the operator sees — a camera below the fold is captured
 * only when it scrolls INTO view, so the first thing painted is a frame from
 * whenever it was last looked at, which can be hours.
 *
 * So the list sweeps ONCE, on the first opening: a couple of cameras at a time
 * until every one has been named, then it stops. Not "demand everything" —
 * that is the perpetual capture D108 removed — and not a standing rotation
 * either: the point is a fresh set of tiles to open onto, and after that the
 * viewport rule is right again.
 *
 * ## What the numbers mean
 *
 * {@link SWEEP_SLICE_SIZE} cameras per {@link SWEEP_TICK_MS}: twenty cameras
 * finish in about two minutes, and never more than two are under capture at any
 * instant regardless of fleet size. The cost is bounded and it is paid once.
 *
 * ## What it must never do
 *
 * Displace what is on screen. The slice is ADDED to the visible set, never
 * substituted for it — a tile the operator is looking at keeps its five-second
 * cadence, and a sweep that took its turn would make the foreground worse to
 * improve the background. Visible cameras also count as already covered: they
 * are being captured, and naming them again would spend the sweep on the one
 * part of the list that is already fresh.
 */

/** Cameras named per tick. The cost ceiling: `size` concurrent captures. */
export const SWEEP_SLICE_SIZE = 2

/** How often the sweep advances. With the size above, twenty cameras ≈ 2 min. */
export const SWEEP_TICK_MS = 12_000

export interface SweepSliceInput {
  /** Every camera the screen lists, in a stable order. */
  readonly all: readonly number[]
  /** Cameras on screen right now — already being captured, so already covered. */
  readonly visible: readonly number[]
  /** Cameras this sweep has already named. */
  readonly covered: ReadonlySet<number>
  readonly size: number
}

export interface SweepSliceResult {
  /** Cameras to name IN ADDITION to the visible ones, this tick. */
  readonly warm: readonly number[]
  /** `covered` after this tick — pass it to the next one. */
  readonly covered: ReadonlySet<number>
  /** Every camera has had its turn; the caller stops ticking. */
  readonly done: boolean
}

/**
 * The next few cameras to warm, and what remains.
 *
 * A camera list that GROWS mid-sweep (the hub answering late, a camera being
 * adopted) simply extends the sweep — `done` is computed against the list as it
 * stands, so nothing is skipped because it arrived a second after the first
 * tick.
 */
export function nextSweepSlice(input: SweepSliceInput): SweepSliceResult {
  const { all, visible, covered, size } = input
  const nextCovered = new Set(covered)
  for (const id of visible) nextCovered.add(id)
  const warm: number[] = []
  for (const id of all) {
    if (warm.length >= size) break
    if (nextCovered.has(id)) continue
    warm.push(id)
    nextCovered.add(id)
  }
  return { warm, covered: nextCovered, done: all.every((id) => nextCovered.has(id)) }
}
