/**
 * Gesture arbitration for the retrain canvas — which edit a one-finger drag
 * performs, and what each finger position turns it into. Pure, so the decision
 * the canvas makes on a phone is testable without a gesture runtime.
 *
 * One finger:
 *  - "add box" mode: draws a new box from the touch-down point;
 *  - on the SELECTED box: a corner (44 pt target) resizes it, the body moves it;
 *  - anywhere else, zoomed in: pans the picture;
 *  - anywhere else at 1x: nothing (a tap there selects / clears instead).
 * Two fingers are the pinch's: zoom about the focal point, pan by its travel
 * ({@link pinchViewport}), and a pinch that starts mid-drag ends that drag.
 *
 * Every step is measured from the TOUCH-DOWN point to the finger's current
 * position, never from a gesture runtime's `translation`: iOS resets the
 * translation to zero at the moment a pan activates, Android and the web do
 * not, so a translation-based box would land a few points apart per platform.
 */
import { boxAtPoint, dragToBox, isDrawnBox, type NormBox, type PixelRect } from './boxes.js'
import {
  clamp01,
  dragMove,
  dragResize,
  grabAt,
  panBy,
  screenToNorm,
  type Grab,
  type Point,
  type Size,
  type Viewport,
} from './viewport.js'

/** What a one-finger drag was decided to do, at touch-down. */
export type CanvasDrag =
  | { readonly kind: 'edit'; readonly key: string; readonly base: NormBox; readonly grab: Grab }
  /** `start` is normalised and clamped to the frame. */
  | { readonly kind: 'draw'; readonly start: Point }
  | { readonly kind: 'view'; readonly start: Viewport }
  | { readonly kind: 'none' }

export const NO_DRAG: CanvasDrag = { kind: 'none' }

/** A live box the canvas can hit: its row key and rectangle. */
export interface CanvasBox {
  readonly key: string
  readonly bbox: NormBox
}

export interface DragDecisionInput {
  /** Touch-down point, in canvas (container) pixels. */
  readonly touch: Point
  readonly drawMode: boolean
  /** The selected live box, or `null` when nothing (or a ghost) is selected. */
  readonly selected: CanvasBox | null
  readonly viewport: Viewport
  readonly container: Size
  /** Where the frame sits at 1x; `null` before the layout is known. */
  readonly img: PixelRect | null
}

export function decideCanvasDrag(input: DragDecisionInput): CanvasDrag {
  const { touch, drawMode, selected, viewport, container, img } = input
  if (img === null) return NO_DRAG
  if (drawMode) return { kind: 'draw', start: clamp01(screenToNorm(touch, viewport, container, img)) }
  if (selected !== null) {
    const grab = grabAt(selected.bbox, touch, viewport, container, img)
    if (grab !== null) return { kind: 'edit', key: selected.key, base: selected.bbox, grab }
  }
  return viewport.scale > 1 ? { kind: 'view', start: viewport } : NO_DRAG
}

/** What one finger position turns a decided drag into. */
export type DragStep =
  | { readonly kind: 'edit'; readonly key: string; readonly bbox: NormBox }
  | { readonly kind: 'draw'; readonly box: NormBox }
  | { readonly kind: 'view'; readonly viewport: Viewport }
  | { readonly kind: 'none' }

export function dragStep(
  drag: CanvasDrag,
  down: Point,
  now: Point,
  viewport: Viewport,
  container: Size,
  img: PixelRect | null,
): DragStep {
  if (img === null) return { kind: 'none' }
  const dx = now.x - down.x
  const dy = now.y - down.y
  switch (drag.kind) {
    case 'edit':
      return {
        kind: 'edit',
        key: drag.key,
        bbox:
          drag.grab.kind === 'body'
            ? dragMove(drag.base, dx, dy, viewport, img)
            : dragResize(drag.base, drag.grab.corner, dx, dy, viewport, img),
      }
    case 'draw':
      return { kind: 'draw', box: dragToBox(drag.start, clamp01(screenToNorm(now, viewport, container, img))) }
    case 'view':
      return { kind: 'view', viewport: panBy(drag.start, dx, dy, container, img) }
    case 'none':
      return { kind: 'none' }
  }
}

/** The box a finished draw commits, or `null` for a drag too small to be one. */
export function committedDraw(draft: NormBox | null): NormBox | null {
  return draft !== null && isDrawnBox(draft) ? draft : null
}

/** The live box a tap at a screen point selects — the SMALLEST under it — or `null`. */
export function tapTarget(
  boxes: readonly CanvasBox[],
  touch: Point,
  viewport: Viewport,
  container: Size,
  img: PixelRect | null,
): string | null {
  if (img === null) return null
  const hit = boxAtPoint(
    boxes.map((b) => b.bbox),
    screenToNorm(touch, viewport, container, img),
  )
  return hit >= 0 ? (boxes[hit]?.key ?? null) : null
}
