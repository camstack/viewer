/**
 * polygon-draw — pure, RN-free geometry behind the personal-rule custom-zone
 * drawing overlay (task B6). It mirrors the admin polygon zone editor's math:
 * vertices are authored in the PIXELS of the letterboxed image box, then
 * normalised 0..1 against that box into a {@link NcMaskPolygonShape} — the exact
 * `{ kind:'polygon', points:[{x,y}] }` vocabulary A1's `customZones` consumes and
 * the server ZoneEngine evaluates.
 *
 * The frame-vs-view distinction (spec/brief): a camera snapshot is shown with a
 * `contain` fit, so on either orientation it is letterboxed inside the drawing
 * stage. {@link fitContain} computes that letterboxed sub-rect; the overlay
 * positions its touch surface exactly over it so a touch's `locationX/Y` are
 * already image-local. {@link toFrameLocal} is the equivalent mapping for a touch
 * measured in STAGE coordinates (kept pure + tested for correctness on both
 * orientations). {@link toNormalizedPolygon} then divides by the image box — never
 * the stage — so points are normalised to the FRAME, not the view.
 *
 * Every function is stateless and immutable (project immutability rule) — no
 * React, no fetching — and unit-tested in `__tests__/polygon-draw.spec.ts`.
 */
import type { NcMaskPolygonShape } from '../../data/notification-center.js'

/** A point in pixels of the (letterboxed) image box, top-left origin. */
export interface Point {
  readonly x: number
  readonly y: number
}

/** A measured box size in pixels. */
export interface Box {
  readonly width: number
  readonly height: number
}

/** The letterboxed image sub-rect inside the drawing stage. */
export interface DisplayBox {
  readonly offsetX: number
  readonly offsetY: number
  readonly width: number
  readonly height: number
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

/** Append a vertex, returning a new array (never mutates the input). */
export function addVertex(verts: readonly Point[], point: Point): Point[] {
  return [...verts, point]
}

/** Replace the vertex at `index` immutably. Out-of-range index → unchanged copy. */
export function moveVertex(verts: readonly Point[], index: number, point: Point): Point[] {
  if (index < 0 || index >= verts.length) return [...verts]
  return verts.map((vertex, i) => (i === index ? point : vertex))
}

/** A polygon can be closed only once it has at least three vertices. */
export function isClosable(verts: readonly Point[]): boolean {
  return verts.length >= 3
}

/**
 * Normalise image-box-pixel vertices into a 0..1 {@link NcMaskPolygonShape}.
 * Each coordinate is clamped into [0,1] so a touch that strayed a pixel past the
 * edge still yields a valid vertex. A degenerate box yields an empty polygon.
 */
export function toNormalizedPolygon(verts: readonly Point[], box: Box): NcMaskPolygonShape {
  if (box.width <= 0 || box.height <= 0) return { kind: 'polygon', points: [] }
  return {
    kind: 'polygon',
    points: verts.map((vertex) => ({
      x: clamp(vertex.x / box.width, 0, 1),
      y: clamp(vertex.y / box.height, 0, 1),
    })),
  }
}

/** De-normalise a stored polygon's points back into image-box pixels (for
 *  re-editing an existing zone). Inverse of {@link toNormalizedPolygon}. */
export function fromNormalizedPolygon(poly: NcMaskPolygonShape, box: Box): Point[] {
  return poly.points.map((point) => ({ x: point.x * box.width, y: point.y * box.height }))
}

/**
 * `contain`-fit a frame of `frameW × frameH` inside `container`, returning the
 * letterboxed sub-rect (offset + size). Correct on both orientations: the frame
 * is scaled by the smaller axis ratio and centred. A degenerate frame falls back
 * to filling the whole container (offset 0).
 */
export function fitContain(container: Box, frameW: number, frameH: number): DisplayBox {
  if (container.width <= 0 || container.height <= 0 || frameW <= 0 || frameH <= 0) {
    return { offsetX: 0, offsetY: 0, width: container.width, height: container.height }
  }
  const scale = Math.min(container.width / frameW, container.height / frameH)
  const width = frameW * scale
  const height = frameH * scale
  return {
    offsetX: (container.width - width) / 2,
    offsetY: (container.height - height) / 2,
    width,
    height,
  }
}

/**
 * Map a touch measured in STAGE (container) coordinates onto image-box-local
 * pixels: subtract the letterbox offset and clamp into the image rect so a touch
 * that landed on a letterbox bar snaps to the nearest image edge.
 */
export function toFrameLocal(touch: Point, box: DisplayBox): Point {
  return {
    x: clamp(touch.x - box.offsetX, 0, box.width),
    y: clamp(touch.y - box.offsetY, 0, box.height),
  }
}

/** Squared distance between two points (cheap hit-testing; avoids a sqrt). */
export function distanceSq(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/**
 * Index of the first vertex within `radius` px of `point`, else -1. Used to
 * decide whether a touch grabs an existing vertex (drag) or adds a new one, and
 * whether a tap on vertex 0 should close the loop.
 */
export function hitVertex(verts: readonly Point[], point: Point, radius: number): number {
  const r2 = radius * radius
  for (let i = 0; i < verts.length; i += 1) {
    if (distanceSq(verts[i], point) <= r2) return i
  }
  return -1
}
