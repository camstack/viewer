/**
 * ondemand-geometry — the on-demand player's BOX and where it sits (D483).
 *
 * The operator asked for "un overlay mobile ovunque sulla pagina corrente" that
 * is also "ridimensionabile": movable and resizable. Both are gestures, and
 * both commit on RELEASE, which is the one thing this module exists to make
 * unavoidable.
 *
 * ## Why discrete snaps and a release commit, not a live layout
 *
 * The picture inside this overlay is a WKWebView (native) or an iframe (web).
 * A transform is composited and costs nothing per frame; a gesture-driven
 * LAYOUT prop — a width, a height, a `left`/`top` — relayouts WebKit on every
 * frame of the drag, and this codebase has already paid for that once. So the
 * drag moves a GHOST outline (a plain View, transformed) and the panel's real
 * box changes exactly once, at the release. Three snap sizes rather than a
 * continuous width for the same reason: a committed value that can only be one
 * of three is a value that cannot be nudged into a relayout storm.
 *
 * ## Why the position is re-clamped on every read
 *
 * A stored position is a measurement of a window that may be gone — the
 * `container-width.ts` lesson, which this screen's history documents three
 * times over. A panel placed at the right edge of a 1400pt web window is off
 * screen in a 1000pt one, and the app's own tab layout runs `freezeOnBlur:
 * false`, so nothing re-seeds a latched value. {@link clampOnDemandPosition} is
 * therefore applied against the LIVE container on every render rather than at
 * the moment of the drop: a stale position self-corrects instead of stranding
 * the player somewhere the operator cannot reach it.
 *
 * Pure — no React, no `Dimensions`.
 */

/** The three committed sizes. */
export type OnDemandSize = 'compact' | 'medium' | 'large'

/** In growing order — the order a cycle control steps through. */
export const ONDEMAND_SIZES: readonly OnDemandSize[] = ['compact', 'medium', 'large']

/**
 * ABSENT ⇒ this. Stored state must never have to spell the default out: a
 * persisted `'compact'` standing in for "never chosen" would hand every
 * install the smallest player forever, and nobody would look.
 */
export const DEFAULT_ONDEMAND_SIZE: OnDemandSize = 'medium'

/** Fraction of the container WIDTH each snap asks for. */
const SIZE_FRACTION: Readonly<Record<OnDemandSize, number>> = {
  compact: 0.26,
  medium: 0.4,
  large: 0.56,
}

/**
 * Narrowest the panel may be committed to. Sized against the compact
 * timeline's own content — the transport row plus the day tape — rather than
 * against the picture: below this the bar's controls start dropping, and a
 * player whose controls do not fit is not a smaller player, it is a broken one.
 *
 * 256 since 2026-09-13, down from 280, and the number is DERIVED rather than
 * taste: `playback-bar-fit.ts` prices the complete bar — as THIS surface draws
 * it, with no record control and no frame-step — within 222pt once the scale
 * tokens hit their 0.66 floor, {@link ONDEMAND_CHROME_PADDING} takes 2pt a
 * side and {@link ONDEMAND_RESIZE_GRIP} takes the bottom-right corner — so 256
 * is the narrowest panel that still carries every control. The geometry spec
 * asserts that relation against the bar's own estimator rather than restating
 * the number, so moving either side has to be done on both.
 */
export const ONDEMAND_MIN_WIDTH = 256

/**
 * Horizontal padding the chrome puts around the day tape and the playback bar.
 * Exported because the BAR's fit is decided from the width it actually gets,
 * which is the panel minus twice this — a caller that guesses that relation is
 * a second opinion about a layout it does not own.
 */
export const ONDEMAND_CHROME_PADDING = 2

/**
 * The bottom-right resize grip's footprint.
 *
 * It is RESERVED out of the playback bar's row rather than drawn over it. The
 * grip is the last sibling in the panel, so it wins every touch in its square,
 * and the bar's trailing slot (record, speed) sits exactly there — which meant
 * the two controls quietly competed for the same corner. Reserving the width
 * costs the bar 28pt and is the only arrangement in which both are reachable.
 *
 * 28pt of LAYOUT, with the component's `hitSlop` carrying it past the 44pt a
 * finger needs: hit area is not layout, and a 44pt opaque square in this corner
 * would eat a third of the bar on the smallest panel.
 */
export const ONDEMAND_RESIZE_GRIP = 28

/**
 * How wide the panel is allowed to get on a container too narrow for
 * {@link SIZE_FRACTION} to mean anything.
 *
 * On a phone the fractions are all under the floor (0.56 of a 393pt window is
 * 220), so they cannot distinguish the three sizes — see
 * {@link resolveOnDemandBox}. The re-based ladder needs a top end, and this is
 * it: wide enough that `large` is a real step up from the floor, narrow enough
 * that a player does not become a full-screen takeover the operator has to
 * drag back.
 */
export const ONDEMAND_NARROW_CEILING = 360

/**
 * Where each size sits between the floor and the ceiling, when the fraction
 * ladder has collapsed. Ends pinned so `compact` IS the floor and `large` IS
 * the ceiling — the ladder spans everything available rather than hovering
 * inside it.
 */
const NARROW_SHARE: Readonly<Record<OnDemandSize, number>> = {
  compact: 0,
  medium: 0.5,
  large: 1,
}

/**
 * Height the chrome adds under the 16:9 picture: the compact timeline (the day
 * tape) plus the transport row. A constant rather than a measurement because
 * the box must be resolvable BEFORE the panel lays out — an overlay that sized
 * itself from its own content would have no box on its first frame, which is
 * the `stream-slot.ts` defect (a slot that measured 900x0) in miniature.
 */
export const ONDEMAND_CHROME_HEIGHT = 104

/** Clearance kept between the panel and every container edge. */
export const ONDEMAND_EDGE_INSET = 12

/**
 * Stacking order for the overlay's root.
 *
 * ## What this number is, and what it is NOT
 *
 * The overlay is mounted as a sibling of the `<Stack>` navigator in
 * `app/(app)/_layout.tsx`, so it is in a DIFFERENT stacking context from the
 * screen chrome: what puts it over a route is sibling paint order, not an
 * integer. Comparing it to `STREAM_SLOT_Z` (50) or `DRAWER_OVERLAY_Z` (60)
 * would be inventing a relation the tree does not have — the failure mode the
 * `stream-slot.ts` docblock names, where a `zIndex: 50` "only ranks it against
 * its own siblings, of which it has none".
 *
 * It exists for two things that are real. On Android, `elevation` competes more
 * readily than paint order does, so an explicit value is load-bearing there.
 * And `(app)/_layout.tsx` already mounts five non-route siblings beside the
 * navigator, so a sixth that draws pixels needs to say where it ranks among
 * them.
 *
 * The spec asserts it exceeds both screen-level constants anyway. Not because
 * the contexts are shared today, but because the cost of that assertion is one
 * line and the cost of being wrong — an overlay mounted inside a screen by a
 * later refactor and silently painted UNDER the video, which is exactly how
 * `LandscapeTimelineOverlay` once failed — is a bug nobody can see.
 */
export const ONDEMAND_OVERLAY_Z = 70

/** A container the overlay floats in (the app window, minus nothing). */
export interface OnDemandContainer {
  readonly width: number
  readonly height: number
}

/** The panel's committed box. */
export interface OnDemandBox {
  readonly width: number
  readonly height: number
}

/** Top-left of the panel within the container. */
export interface OnDemandPosition {
  readonly x: number
  readonly y: number
}

/**
 * The panel's box for a snap size in a container.
 *
 * 16:9 picture plus {@link ONDEMAND_CHROME_HEIGHT}, clamped by BOTH container
 * dimensions — a container that is wide and short must shrink the width, not
 * grow a panel taller than the window. The clamps win over
 * {@link ONDEMAND_MIN_WIDTH}: a floor that could exceed the container would
 * place the panel's own edge off screen, and "too small to use" is recoverable
 * where "cannot be reached" is not.
 */
export function resolveOnDemandBox(size: OnDemandSize, container: OnDemandContainer): OnDemandBox {
  const usableW = Math.max(0, container.width - 2 * ONDEMAND_EDGE_INSET)
  const usableH = Math.max(0, container.height - 2 * ONDEMAND_EDGE_INSET)
  const widthFromHeight = ((usableH - ONDEMAND_CHROME_HEIGHT) * 16) / 9
  const width = Math.max(0, Math.min(askedWidth(size, container, usableW), usableW, widthFromHeight))
  return { width, height: width > 0 ? (width * 9) / 16 + ONDEMAND_CHROME_HEIGHT : 0 }
}

/**
 * What a size ASKS for, before the container's own limits are applied.
 *
 * ## Why there are two ladders
 *
 * The original rule was `max(ONDEMAND_MIN_WIDTH, container.width * fraction)`,
 * and it is silently degenerate on anything narrower than about 920pt: every
 * fraction lands under the floor, `Math.max` lifts all three to the SAME
 * number, and the three snap sizes become one. On every phone in portrait that
 * made the resize gesture a no-op — the drag fired, the store persisted a new
 * size, and the panel (and its ghost outline, computed the same way) did not
 * move a pixel. The operator read that as "the window is not resizable", and
 * they were right about the symptom.
 *
 * So the fraction ladder is kept for the containers it actually describes, and
 * where it collapses the ladder is RE-BASED onto the room that exists: it
 * spans from the floor to a ceiling, with the three sizes at the ends and the
 * middle. The handover is where the fraction ladder's smallest rung clears the
 * floor, which is also where the two ladders agree at both ends — so crossing
 * it moves only the middle rung, by a few points.
 */
function askedWidth(size: OnDemandSize, container: OnDemandContainer, usableW: number): number {
  const floor = Math.min(ONDEMAND_MIN_WIDTH, usableW)
  const fractionLadderHolds = container.width * SIZE_FRACTION.compact >= floor
  if (fractionLadderHolds) return container.width * SIZE_FRACTION[size]
  const ceiling = Math.max(
    floor,
    Math.min(usableW, Math.max(container.width * SIZE_FRACTION.large, ONDEMAND_NARROW_CEILING)),
  )
  return floor + NARROW_SHARE[size] * (ceiling - floor)
}

/**
 * The snap a released resize drag commits to: whichever size's BOX is nearest
 * the width the operator dragged to, in the container they dragged it in.
 *
 * ## Why this asks the box and not a fraction
 *
 * It used to take a fraction and compare it against {@link SIZE_FRACTION}
 * directly, on the reasoning that a fraction means the same thing in every
 * window. That reasoning depended on the box being a pure fraction of the
 * container, and {@link resolveOnDemandBox} stopped being one the moment the
 * ladder was re-based for narrow containers — so on a phone the panel's own
 * widths (240/300/360 in a 393pt window) are fractions of 0.61/0.76/0.92, all
 * of them past `large`'s 0.56. Every drag, in either direction, answered
 * `large`. That is the SECOND way this gesture was a no-op, and it would have
 * survived the first fix untouched.
 *
 * Asking the same function that draws the panel removes the class of defect
 * rather than this instance of it: the snap and the box can no longer disagree
 * about what a size is, because there is only one answer to that question.
 */
export function snapSizeForWidth(width: number, container: OnDemandContainer): OnDemandSize {
  let best: OnDemandSize = DEFAULT_ONDEMAND_SIZE
  let bestGap = Number.POSITIVE_INFINITY
  for (const size of ONDEMAND_SIZES) {
    const gap = Math.abs(resolveOnDemandBox(size, container).width - width)
    if (gap < bestGap) {
      bestGap = gap
      best = size
    }
  }
  return best
}

/** The next size up, stopping at the largest (a cycle control's step). */
export function nextSnapSize(size: OnDemandSize): OnDemandSize {
  const i = ONDEMAND_SIZES.indexOf(size)
  return ONDEMAND_SIZES[Math.min(i + 1, ONDEMAND_SIZES.length - 1)]
}

/**
 * Where a player opens when the operator has never moved it: the bottom-right
 * corner, inset.
 *
 * Bottom-right because the two entry points are both on the left half of a wide
 * surface — the reel runs under the picture and a track detail's panel opens
 * over the timeline rail — so the overlay lands where it covers neither the
 * thing that opened it nor the picture it is being compared against.
 */
export function defaultOnDemandPosition(
  box: OnDemandBox,
  container: OnDemandContainer,
): OnDemandPosition {
  return clampOnDemandPosition(
    {
      x: container.width - box.width - ONDEMAND_EDGE_INSET,
      y: container.height - box.height - ONDEMAND_EDGE_INSET,
    },
    box,
    container,
  )
}

/**
 * Pull a position inside the container. Applied on every read against the LIVE
 * container, not once at the drop — see the module docblock.
 *
 * A box larger than the container clamps to the inset rather than to a negative
 * coordinate: off the top-left is just as unreachable as off the bottom-right,
 * and `Math.max` after `Math.min` is what keeps the degenerate case on screen.
 */
export function clampOnDemandPosition(
  position: OnDemandPosition,
  box: OnDemandBox,
  container: OnDemandContainer,
): OnDemandPosition {
  const maxX = container.width - box.width - ONDEMAND_EDGE_INSET
  const maxY = container.height - box.height - ONDEMAND_EDGE_INSET
  return {
    x: Math.max(ONDEMAND_EDGE_INSET, Math.min(position.x, maxX)),
    y: Math.max(ONDEMAND_EDGE_INSET, Math.min(position.y, maxY)),
  }
}
