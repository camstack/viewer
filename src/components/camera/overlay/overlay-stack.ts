/**
 * overlay-stack — how several overlays share ONE anchor of the stream
 * container without overlapping.
 *
 * ## The rules
 *
 * 1. **Anchored to the CONTAINER**, not to the letterboxed picture: an overlay
 *    at `top-left` sits at the container's top-left corner. (Detection and
 *    motion boxes are not part of this — they stay on the picture.)
 * 2. **One stack per anchor.** Every overlay placed at an anchor is a row of
 *    that anchor's stack; nothing is absolutely positioned on its own, so two
 *    overlays in a corner can never overlap.
 * 3. **Order inside a stack:** the operator's order first (the order they were
 *    placed in — `OverlayConfig.order`), then the default order
 *    ({@link DEFAULT_STACK_ORDER}), then pinned readouts in their own order.
 *    The FIRST item is the one nearest the corner.
 * 4. **Direction:** the top anchors and the side midpoints flow DOWN from the
 *    edge, the bottom anchors flow UP from it (`column-reverse`), so the item
 *    nearest the corner is the same one whichever corner it is in and the stack
 *    grows into the picture.
 * 5. **It must fit.** A corner shares its band with the other stacks of that
 *    band: two corners on one edge get half of its width each (a third stack
 *    in the middle takes 20%), and a corner with a stack on the opposite edge
 *    of its side gets half of the height, and with a side-centre stack a quarter. Content past a stack's budget is
 *    clipped, never drawn over a neighbour. The budgets are fractions, so a
 *    portrait phone and a grid tile obey the same rule.
 *
 * Pure module — no React. Safe for tests.
 */
import {
  type OverlayConfig,
  type OverlayItemId,
} from './overlay-config.js'
import { OVERLAY_ANCHORS, type OverlayAnchor, type OverlayPosition } from './overlay-position.js'

/** One overlay that is drawn, and the anchor it is drawn at. */
export interface StackItem {
  readonly id: OverlayItemId
  readonly anchor: OverlayAnchor
}

/** Default order inside a stack, first = nearest the corner. The controls come
 *  before the badges so that in a bottom corner they sit on the edge and the
 *  badges stack above them. Pinned readouts follow, in their own order. */
export const DEFAULT_STACK_ORDER: readonly OverlayItemId[] = Object.freeze([
  'cameraName',
  'controlsLeft',
  'controlsRight',
  'doorbell',
  'motionBadge',
  'stats',
  'audioMeter',
  'occupancy',
  'viewers',
  'deviceInfo',
]) as readonly OverlayItemId[]

/** What the host knows that the document cannot say. */
export interface StackContext {
  /** The camera has the doorbell feature (the badge is offered at all). */
  readonly hasDoorbell: boolean
  /** The device-info pill's position (a device-level setting, not part of the
   *  document), `off` when not placed. */
  readonly deviceInfo: OverlayPosition
}

function placed(position: OverlayPosition, id: OverlayItemId): readonly StackItem[] {
  return position === 'off' ? [] : [{ id, anchor: position }]
}

/** Every overlay that is placed, with its anchor, in default order. */
export function stackItems(config: OverlayConfig, ctx: StackContext): readonly StackItem[] {
  const named: readonly StackItem[] = [
    ...placed(config.cameraName, 'cameraName'),
    { id: 'controlsLeft', anchor: config.controlsLeft },
    { id: 'controlsRight', anchor: config.controlsRight },
    ...(config.doorbell && ctx.hasDoorbell
      ? [{ id: 'doorbell' as const, anchor: config.doorbellAnchor }]
      : []),
    ...placed(config.motionBadge, 'motionBadge'),
    ...placed(config.stats, 'stats'),
    ...placed(config.audioMeter, 'audioMeter'),
    ...placed(config.occupancy, 'occupancy'),
    ...placed(config.viewers, 'viewers'),
    ...placed(ctx.deviceInfo, 'deviceInfo'),
  ]
  const readouts: readonly StackItem[] = config.readouts.map((r) => ({
    id: `readout:${r.id}` as const,
    anchor: r.corner,
  }))
  return [...named, ...readouts]
}

/**
 * Order the ids of ONE stack: the operator's order first, then the default.
 * An id the operator's list does not mention keeps its place in
 * {@link DEFAULT_STACK_ORDER}; pinned readouts (not in it) follow, as given.
 */
export function orderStack(
  ids: readonly OverlayItemId[],
  userOrder: readonly OverlayItemId[],
): readonly OverlayItemId[] {
  const present = new Set(ids)
  const user = userOrder.filter((id) => present.has(id))
  const taken = new Set(user)
  const byDefault = DEFAULT_STACK_ORDER.filter((id) => present.has(id) && !taken.has(id))
  const rest = ids.filter((id) => !taken.has(id) && !byDefault.includes(id))
  return [...user, ...byDefault, ...rest]
}

/** One anchor's stack: the anchor and its ordered ids. */
export interface Stack {
  readonly anchor: OverlayAnchor
  readonly ids: readonly OverlayItemId[]
}

/** The non-empty stacks, in `OVERLAY_ANCHORS` order, each ordered by
 *  {@link orderStack}. */
export function buildStacks(
  items: readonly StackItem[],
  userOrder: readonly OverlayItemId[],
): readonly Stack[] {
  return OVERLAY_ANCHORS.flatMap((anchor) => {
    const ids = items.filter((i) => i.anchor === anchor).map((i) => i.id)
    return ids.length === 0 ? [] : [{ anchor, ids: orderStack(ids, userOrder) }]
  })
}

export type StackDirection = 'down' | 'up'

/** Bottom anchors grow upward from the edge; everything else grows downward. */
export function stackDirection(anchor: OverlayAnchor): StackDirection {
  return anchor.startsWith('bottom') ? 'up' : 'down'
}

/** The inset of the container's edges: the base gutter plus the safe area. */
export interface StackInset {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

type Percent = `${number}%`

/** The absolute box of one stack — plain numbers and strings, so it is a valid
 *  React Native style and a testable value. */
export interface StackBox {
  readonly position: 'absolute'
  readonly top?: number | Percent
  readonly bottom?: number | Percent
  readonly left?: number
  readonly right?: number
  readonly flexDirection: 'column' | 'column-reverse'
  readonly alignItems: 'flex-start' | 'center' | 'flex-end'
  readonly justifyContent?: 'center'
  readonly maxWidth: Percent
  readonly maxHeight: Percent
  readonly gap: number
  readonly overflow: 'hidden'
}

/** Vertical gap between the rows of a stack. */
export const STACK_GAP = 4

type Band = 'left' | 'center' | 'right'
type Edge = 'top' | 'middle' | 'bottom'

function bandOf(anchor: OverlayAnchor): Band {
  if (anchor.endsWith('left')) return 'left'
  if (anchor.endsWith('right')) return 'right'
  return 'center'
}

function edgeOf(anchor: OverlayAnchor): Edge {
  if (anchor.startsWith('top')) return 'top'
  if (anchor.startsWith('bottom')) return 'bottom'
  return 'middle'
}

/** The anchor at an edge and a band, or null for the centre (never an anchor). */
function anchorAt(edge: Edge, band: Band): OverlayAnchor | null {
  if (edge === 'middle') return band === 'left' ? 'left-center' : band === 'right' ? 'right-center' : null
  return band === 'center' ? `${edge}-center` : `${edge}-${band}`
}

function has(occupied: ReadonlySet<OverlayAnchor>, anchor: OverlayAnchor | null): boolean {
  return anchor !== null && occupied.has(anchor)
}

/** Share of the width a corner stack may take, given who else is on its edge. */
export function cornerWidthShare(anchor: OverlayAnchor, occupied: ReadonlySet<OverlayAnchor>): number {
  const edge = edgeOf(anchor)
  if (edge === 'middle' || bandOf(anchor) === 'center') return 100
  const opposite = has(occupied, anchorAt(edge, bandOf(anchor) === 'left' ? 'right' : 'left'))
  const centre = has(occupied, anchorAt(edge, 'center'))
  if (opposite && centre) return 40
  if (opposite) return 50
  if (centre) return 80
  return 100
}

/** Height share of a corner when a side-centre stack shares its side. */
export const MIDDLE_CORNER_SHARE = 25

/** The side-centre stack's band: `MIDDLE_EDGE`% from the top and bottom, so it
 *  is `100 - 2 * MIDDLE_EDGE`% tall. Chosen so a corner's inset plus
 *  {@link MIDDLE_CORNER_SHARE} still ends above it down to an 80 px container. */
export const MIDDLE_EDGE = 35

/** Share of the height a corner stack may take, given who else is on its side. */
export function cornerHeightShare(anchor: OverlayAnchor, occupied: ReadonlySet<OverlayAnchor>): number {
  const edge = edgeOf(anchor)
  const band = bandOf(anchor)
  if (edge === 'middle' || band === 'center') return 100
  const otherEdge = edge === 'top' ? 'bottom' : 'top'
  const opposite = has(occupied, anchorAt(otherEdge, band))
  const middle = has(occupied, anchorAt('middle', band))
  // The side-centre stack owns the band between 35% and 65% of the height; a
  // corner above or below it stays within 25% (+ its inset), so the three can
  // never meet, whichever of them is the one that grew.
  if (middle) return MIDDLE_CORNER_SHARE
  if (opposite) return 50
  return 100
}

/**
 * The box of the stack at `anchor`. `occupied` is the set of ALL anchors that
 * have a stack — a stack's budget depends on its neighbours (rule 5).
 */
export function stackBox(
  anchor: OverlayAnchor,
  occupied: ReadonlySet<OverlayAnchor>,
  inset: StackInset,
): StackBox {
  const direction = stackDirection(anchor)
  const base = {
    position: 'absolute',
    flexDirection: direction === 'up' ? 'column-reverse' : 'column',
    gap: STACK_GAP,
    overflow: 'hidden',
  } as const
  const widthShare: Percent = `${cornerWidthShare(anchor, occupied)}%`
  const heightShare: Percent = `${cornerHeightShare(anchor, occupied)}%`
  switch (anchor) {
    case 'top-left':
      return { ...base, top: inset.top, left: inset.left, alignItems: 'flex-start', maxWidth: widthShare, maxHeight: heightShare }
    case 'top-right':
      return { ...base, top: inset.top, right: inset.right, alignItems: 'flex-end', maxWidth: widthShare, maxHeight: heightShare }
    case 'bottom-left':
      return { ...base, bottom: inset.bottom, left: inset.left, alignItems: 'flex-start', maxWidth: widthShare, maxHeight: heightShare }
    case 'bottom-right':
      return { ...base, bottom: inset.bottom, right: inset.right, alignItems: 'flex-end', maxWidth: widthShare, maxHeight: heightShare }
    case 'top-center':
      return { ...base, top: inset.top, left: inset.left, right: inset.right, alignItems: 'center', maxWidth: '100%', maxHeight: heightShare }
    case 'bottom-center':
      return { ...base, bottom: inset.bottom, left: inset.left, right: inset.right, alignItems: 'center', maxWidth: '100%', maxHeight: heightShare }
    case 'left-center':
      return { ...base, top: `${MIDDLE_EDGE}%`, bottom: `${MIDDLE_EDGE}%`, left: inset.left, justifyContent: 'center', alignItems: 'flex-start', maxWidth: '50%', maxHeight: `${100 - 2 * MIDDLE_EDGE}%` }
    case 'right-center':
      return { ...base, top: `${MIDDLE_EDGE}%`, bottom: `${MIDDLE_EDGE}%`, right: inset.right, justifyContent: 'center', alignItems: 'flex-end', maxWidth: '50%', maxHeight: `${100 - 2 * MIDDLE_EDGE}%` }
  }
}
