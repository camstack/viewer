/**
 * overlay-position — THE position vocabulary for everything drawn on a picture.
 *
 * One nine-value space: the eight anchor points of a 3×3 grid (four corners +
 * four edge midpoints) plus `off` at the centre. Every overlay that sits
 * SOMEWHERE — the audio meter, the occupancy strip, a pinned readout — reads
 * and writes this vocabulary and is edited by ONE picker
 * (`OverlayPositionPicker`).
 *
 * ## Why one vocabulary
 *
 * There used to be two, born on the same day: the audio meter spoke kebab-case
 * with nine members (`bottom-left`), the corner overlays spoke camelCase with
 * four (`bottomLeft`). Two pickers, two type unions, and an occupancy strip
 * that could never sit at `top-center` because its half of the vocabulary had
 * no such word. The kebab-case form won because it was already the persisted
 * shape of `audioMeter` and the i18n key shape of the nine position labels —
 * migrating four camelCase corners is smaller than migrating nine kebab values.
 *
 * ## Legacy migration
 *
 * Cameras persisted before the merge hold camelCase corners (`bottomLeft`) in
 * `occupancy` and in each readout's `corner`. {@link normalisePosition} accepts
 * BOTH forms so a stored document never silently resets to the default — the
 * exact failure a lossy vocabulary change would cause. Unit-tested with the
 * legacy values in `overlay-config.spec.ts`.
 *
 * Pure module — no React, no imports. Safe for stores and tests.
 */

/** The eight anchors, in reading order — also the 3×3 picker's cell order
 *  around the centre. */
export const OVERLAY_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'left-center',
  'right-center',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const

/** A place ON the picture (never hidden). Readouts use this: a pinned value
 *  always sits somewhere — removing the chip is how it goes away. */
export type OverlayAnchor = (typeof OVERLAY_ANCHORS)[number]

/** An anchor, or hidden. Overlays with their own on/off (the meter, the
 *  occupancy strip) use this: `off` IS the switch, so it is one field and not
 *  a boolean plus an anchor that could disagree. */
export type OverlayPosition = OverlayAnchor | 'off'

export function isOverlayAnchor(v: unknown): v is OverlayAnchor {
  return typeof v === 'string' && (OVERLAY_ANCHORS as readonly string[]).includes(v)
}

export function isOverlayPosition(v: unknown): v is OverlayPosition {
  return v === 'off' || isOverlayAnchor(v)
}

/** The pre-merge camelCase corner spelling → its canonical anchor. */
const LEGACY_CORNERS: Readonly<Record<string, OverlayAnchor>> = {
  topLeft: 'top-left',
  topRight: 'top-right',
  bottomLeft: 'bottom-left',
  bottomRight: 'bottom-right',
}

/**
 * Narrow a stored value into the canonical vocabulary, migrating the legacy
 * camelCase corner spelling. Returns null for anything else — the CALLER owns
 * the fallback, because "unknown position" defaults differently per field
 * (a readout re-anchors to `top-right`, occupancy to its own default).
 */
export function normalisePosition(v: unknown): OverlayPosition | null {
  if (isOverlayPosition(v)) return v
  if (typeof v === 'string') return LEGACY_CORNERS[v] ?? null
  return null
}

/** {@link normalisePosition} restricted to the anchor space — `off` (in either
 *  era's spelling there was none) and unknowns return null. */
export function normaliseAnchor(v: unknown): OverlayAnchor | null {
  const p = normalisePosition(v)
  return p !== null && p !== 'off' ? p : null
}

/** The 3×3 grid, row-major — cell position mirrors on-screen geometry, with
 *  `off` in the centre (the one cell that is not a place). */
export const OVERLAY_POSITION_GRID: readonly (readonly OverlayPosition[])[] = [
  ['top-left', 'top-center', 'top-right'],
  ['left-center', 'off', 'right-center'],
  ['bottom-left', 'bottom-center', 'bottom-right'],
]

/**
 * Absolute placement for an anchor, in the coordinate space of a
 * `position: 'relative'` player layer.
 *
 * Corners pin to their two edges. An edge MIDPOINT pins one edge and centres
 * along the other by stretching between the opposing pair and centring the
 * content inside — `left: 0, right: 0` plus `alignItems: 'center'` rather than
 * a percentage, so the element centres on its own measured width instead of
 * its top-left corner landing at 50%.
 *
 * Lives here, beside the vocabulary, because more than one overlay needs it:
 * it was private to `OverlayReadouts` until the motion badge became
 * positionable on 2026-08-02, and a second copy would be a second set of
 * numbers to drift.
 */
export const ANCHOR_PLACEMENT: Readonly<Record<OverlayAnchor, object>> = {
  'top-left': { top: 8, left: 8, alignItems: 'flex-start' },
  'top-center': { top: 8, left: 0, right: 0, alignItems: 'center' },
  'top-right': { top: 8, right: 8, alignItems: 'flex-end' },
  'left-center': { left: 8, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'flex-start' },
  'right-center': { right: 8, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'flex-end' },
  'bottom-left': { bottom: 8, left: 8, alignItems: 'flex-start' },
  'bottom-center': { bottom: 8, left: 0, right: 0, alignItems: 'center' },
  'bottom-right': { bottom: 8, right: 8, alignItems: 'flex-end' },
}
