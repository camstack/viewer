/**
 * sheet-drag — the pure arithmetic of dragging a phone sheet down to close it.
 * The wiring (gesture, shared values) is in `SheetModal.tsx`. Every function
 * here runs on the UI thread, inside Reanimated worklets: each MUST carry the
 * `'worklet'` directive (`scripts/check-worklet-calls.mjs` enforces it).
 */

/** Drag distance, as a share of the card height, past which a release closes. */
export const CLOSE_DISTANCE_FRACTION = 0.3
/** Downward release velocity (points/s) that closes regardless of distance. */
export const CLOSE_VELOCITY = 800
/** Height of the card's top strip (handle / header) a drag may start from. */
export const DRAG_ZONE_HEIGHT = 64
/** Downward travel (points) before the drag takes over from a tap or a scroll. */
export const DRAG_ACTIVATION = 8

function clamp01(n: number): number {
  'worklet'
  return Math.min(1, Math.max(0, n))
}

/** A card only follows the finger downwards. */
export function clampDrag(translationY: number): number {
  'worklet'
  return Math.max(0, translationY)
}

/** Release decision: past a distance or a fling closes, otherwise it springs back. */
export function shouldCloseOnRelease(dragY: number, velocityY: number, cardHeight: number): boolean {
  'worklet'
  return dragY > cardHeight * CLOSE_DISTANCE_FRACTION || velocityY > CLOSE_VELOCITY
}

/** Share of the backdrop that survives a drag: 1 at rest, 0 once the card is gone. */
export function dragScrimFactor(dragY: number, cardHeight: number): number {
  'worklet'
  return cardHeight <= 0 ? 1 : 1 - clamp01(dragY / cardHeight)
}
