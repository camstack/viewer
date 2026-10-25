/**
 * The retrain canvas viewport — pure zoom / pan arithmetic and the conversions
 * between a screen point, the frame and a normalised box.
 *
 * The frame is drawn `contain` inside a container (`displayedImageRect`) and the
 * whole picture is then scaled by `scale` about the container centre and shifted
 * by `(tx, ty)`. The box overlay is NOT inside that transform: it is positioned
 * from these functions in screen pixels, so a stroke and a corner handle keep
 * their size at every zoom (a 44 pt touch target stays 44 pt).
 *
 *   screen = centre + t + scale * (unscaled - centre)
 */
import type { NormBox, PixelRect } from './boxes.js'
import { moveBox, resizeBox, type ResizeHandle } from './boxes.js'

export interface Viewport {
  readonly scale: number
  readonly tx: number
  readonly ty: number
}

export interface Size {
  readonly w: number
  readonly h: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

export const IDENTITY_VIEWPORT: Viewport = { scale: 1, tx: 0, ty: 0 }
export const MIN_SCALE = 1
export const MAX_SCALE = 8
/** The smallest touch target the platforms recommend, in points. */
export const TOUCH_TARGET = 44
/** Extra reach around a box body, in points, so a thin box is still grabbable. */
export const BODY_SLOP = 8

export type Corner = Extract<ResizeHandle, 'nw' | 'ne' | 'sw' | 'se'>
export const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se']

/** What a touch at a screen point grabbed on the selected box. */
export type Grab =
  | { readonly kind: 'corner'; readonly corner: Corner }
  | { readonly kind: 'body' }

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

/** Keep the picture covering the container: a pan never exposes more than the bars. */
export function clampViewport(vp: Viewport, container: Size, img: PixelRect): Viewport {
  const scale = clampScale(vp.scale)
  const limX = Math.max(0, (scale * img.width - container.w) / 2)
  const limY = Math.max(0, (scale * img.height - container.h) / 2)
  return {
    scale,
    tx: Math.min(limX, Math.max(-limX, vp.tx)),
    ty: Math.min(limY, Math.max(-limY, vp.ty)),
  }
}

/** Zoom to `nextScale`, keeping the picture point under `focal` where it is. */
export function zoomAt(
  vp: Viewport,
  nextScale: number,
  focal: Point,
  container: Size,
  img: PixelRect,
): Viewport {
  const scale = clampScale(nextScale)
  const ratio = scale / vp.scale
  const cx = container.w / 2
  const cy = container.h / 2
  return clampViewport(
    {
      scale,
      tx: focal.x - cx - ratio * (focal.x - cx - vp.tx),
      ty: focal.y - cy - ratio * (focal.y - cy - vp.ty),
    },
    container,
    img,
  )
}

export function panBy(
  vp: Viewport,
  dx: number,
  dy: number,
  container: Size,
  img: PixelRect,
): Viewport {
  return clampViewport({ ...vp, tx: vp.tx + dx, ty: vp.ty + dy }, container, img)
}

/**
 * A two-finger gesture: zoom by `factor` about where the fingers STARTED, then
 * follow the fingers' midpoint — so the picture point under the fingers stays
 * under them whether they spread, pinch or slide together.
 */
export function pinchViewport(
  base: Viewport,
  factor: number,
  startFocal: Point,
  focal: Point,
  container: Size,
  img: PixelRect,
): Viewport {
  const zoomed = zoomAt(base, base.scale * factor, startFocal, container, img)
  return panBy(zoomed, focal.x - startFocal.x, focal.y - startFocal.y, container, img)
}

/** A screen point as a normalised frame coordinate — NOT clamped to [0,1]. */
export function screenToNorm(p: Point, vp: Viewport, container: Size, img: PixelRect): Point {
  const cx = container.w / 2
  const cy = container.h / 2
  const ux = cx + (p.x - cx - vp.tx) / vp.scale
  const uy = cy + (p.y - cy - vp.ty) / vp.scale
  return { x: (ux - img.left) / img.width, y: (uy - img.top) / img.height }
}

export function normToScreen(p: Point, vp: Viewport, container: Size, img: PixelRect): Point {
  const cx = container.w / 2
  const cy = container.h / 2
  const ux = img.left + p.x * img.width
  const uy = img.top + p.y * img.height
  return { x: cx + vp.tx + vp.scale * (ux - cx), y: cy + vp.ty + vp.scale * (uy - cy) }
}

export function clamp01(p: Point): Point {
  return { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }
}

/** A box as a rectangle in screen pixels. */
export function boxToScreen(
  box: NormBox,
  vp: Viewport,
  container: Size,
  img: PixelRect,
): PixelRect {
  const a = normToScreen({ x: box.x, y: box.y }, vp, container, img)
  return {
    left: a.x,
    top: a.y,
    width: box.w * img.width * vp.scale,
    height: box.h * img.height * vp.scale,
  }
}

export function cornerPoint(box: NormBox, corner: Corner): Point {
  return {
    x: corner.includes('w') ? box.x : box.x + box.w,
    y: corner.includes('n') ? box.y : box.y + box.h,
  }
}

/**
 * What a touch grabs on the SELECTED box: a corner (inside a `touchPx` square
 * centred on it — corners win), the body (inside the box, plus a small slop),
 * or nothing. Distances are screen pixels, so the target does not shrink as the
 * picture is zoomed out.
 */
export function grabAt(
  box: NormBox,
  touch: Point,
  vp: Viewport,
  container: Size,
  img: PixelRect,
  touchPx: number = TOUCH_TARGET,
): Grab | null {
  const half = touchPx / 2
  let best: { corner: Corner; dist: number } | null = null
  for (const corner of CORNERS) {
    const c = normToScreen(cornerPoint(box, corner), vp, container, img)
    const dist = Math.max(Math.abs(c.x - touch.x), Math.abs(c.y - touch.y))
    if (dist <= half && (best === null || dist < best.dist)) best = { corner, dist }
  }
  if (best !== null) return { kind: 'corner', corner: best.corner }
  const r = boxToScreen(box, vp, container, img)
  const inside =
    touch.x >= r.left - BODY_SLOP &&
    touch.x <= r.left + r.width + BODY_SLOP &&
    touch.y >= r.top - BODY_SLOP &&
    touch.y <= r.top + r.height + BODY_SLOP
  return inside ? { kind: 'body' } : null
}

/** A drag of `dx,dy` screen pixels, as a normalised delta of the frame. */
export function screenDeltaToNorm(
  dx: number,
  dy: number,
  vp: Viewport,
  img: PixelRect,
): Point {
  return { x: dx / (img.width * vp.scale), y: dy / (img.height * vp.scale) }
}

/** The box a body drag of `dx,dy` screen pixels turns `base` into. */
export function dragMove(
  base: NormBox,
  dx: number,
  dy: number,
  vp: Viewport,
  img: PixelRect,
): NormBox {
  const d = screenDeltaToNorm(dx, dy, vp, img)
  return moveBox(base, d.x, d.y)
}

/**
 * The box a corner drag of `dx,dy` screen pixels turns `base` into. The corner
 * follows the finger by the DISTANCE moved, not to the finger's position, so
 * grabbing a corner a few points off does not make the box jump.
 */
export function dragResize(
  base: NormBox,
  corner: Corner,
  dx: number,
  dy: number,
  vp: Viewport,
  img: PixelRect,
): NormBox {
  const d = screenDeltaToNorm(dx, dy, vp, img)
  const start = cornerPoint(base, corner)
  return resizeBox(base, corner, { x: start.x + d.x, y: start.y + d.y })
}

/**
 * The viewport that brings a box to the middle of the VISIBLE area (the
 * container less `bottomInset`, the part a sheet covers) WITHOUT changing the
 * zoom. At 1x the whole frame is already on screen, so nothing moves (the box is
 * only highlighted); a zoomed view pans, clamped to the picture.
 */
export function centerOnBox(
  box: NormBox,
  current: Viewport,
  container: Size,
  img: PixelRect,
  bottomInset: number = 0,
): Viewport {
  const visibleH = Math.max(1, container.h - bottomInset)
  const scale = current.scale
  const cx = container.w / 2
  const cy = container.h / 2
  const ux = img.left + (box.x + box.w / 2) * img.width
  const uy = img.top + (box.y + box.h / 2) * img.height
  const next = clampViewport(
    { scale, tx: -scale * (ux - cx), ty: visibleH / 2 - cy - scale * (uy - cy) },
    container,
    img,
  )
  // `+ 0` folds a -0 into 0, so an unmoved 1x view compares equal to the identity.
  return { scale: next.scale, tx: next.tx + 0, ty: next.ty + 0 }
}
