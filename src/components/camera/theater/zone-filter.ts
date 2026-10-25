/**
 * zone-filter — pure geometry for the theater timeline's client-side zone
 * filter.
 *
 * ## The two coordinate spaces, and how they are reconciled
 *
 * The operator draws the zone on the DISPLAYED video box, so the rect is
 * normalised 0..1 of the frame. A track row's `positions[].bbox`, however, is
 * in PIXELS of the detection-frame space. Comparing them needs the frame's
 * real dimensions.
 *
 * v0 ESTIMATED them as the max bbox extent across every loaded track, on the
 * theory that "over a day of activity the extents approach the real frame
 * edges". Measured against the live hub on 2026-08-01, that theory is false
 * for any camera whose subjects never reach one edge of its picture:
 *
 *   device 101, today's window (41 tracks) → estimate 630×175, real 640×360
 *
 * A vertical scale error of 2.06× puts every track at roughly DOUBLE its true
 * normalised Y, so a zone drawn over the lower half of the picture matched
 * nothing at all and one drawn over the upper half matched everything — the
 * filter looked broken while doing exactly what it was told.
 *
 * The row already carries the answer: `envelope` is the track's trajectory
 * bounding box NORMALISED 0..1 by the server, using the detection-frame dims
 * it knew at persist time. One track that carries both an envelope and its
 * pixel positions therefore pins the frame EXACTLY —
 * `frameW = (pxMaxX − pxMinX) / (envMaxX − envMinX)` — and per-position
 * testing keeps its precision. Verified on 1000 live rows across two cameras:
 * every single one recovered 640.00×360.00, min = max, no spread.
 *
 * {@link estimateFrameSize} survives only as the fallback for legacy rows
 * persisted before the envelope existed. Tracks with no geometry at all ALWAYS
 * pass (never silently hidden).
 *
 * All functions are stateless and immutable — no React, no fetching.
 */

// ─── Types ────────────────────────────────────────────────────────────

import {
  isPolygonUsable,
  polygonBounds,
  rectIntersectsPolygon,
  type ZonePoint,
} from './zone-polygon.js'

export type { ZonePoint }

/** A rect in PIXELS of the detection-frame space (server bbox shape). */
export interface PixelRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** A rect NORMALISED to 0..1 of the (16:9) frame — the zone + filter space. */
export interface ZoneRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/**
 * The shape the operator drew.
 *
 * A discriminated union rather than "a rect, plus an optional points array":
 * every consumer must handle both, and an optional field lets one of them
 * quietly keep filtering by the bounding box while looking correct.
 *
 * The rect case is kept rather than expressed as a four-point polygon. It is
 * the common gesture, its hit test is four comparisons against a polygon's
 * per-vertex loop, and the persisted track envelope is a rect — collapsing them
 * would pay polygon cost on every rect filter for no gain.
 */
export type ZoneShape =
  | { readonly kind: 'rect'; readonly rect: ZoneRect }
  | { readonly kind: 'polygon'; readonly points: readonly ZonePoint[] }

/** Wrap a rect as a shape — the fast path most drags produce. */
export function rectShape(rect: ZoneRect): ZoneShape {
  return { kind: 'rect', rect }
}

/** The shape's bounding rect: the polygon's bounds, or the rect itself. */
export function shapeBounds(shape: ZoneShape): ZoneRect | null {
  return shape.kind === 'rect' ? shape.rect : polygonBounds(shape.points)
}

/** Is this shape big enough to act as a filter? */
export function isShapeUsable(shape: ZoneShape): boolean {
  return shape.kind === 'rect' ? isZoneUsable(shape.rect) : isPolygonUsable(shape.points)
}

/** Estimated detection-frame dimensions in pixels. */
/**
 * What a tap on the Zona pill does. The flow is a TOGGLE: while it is active
 * (a drawing in progress, or a zone filter applied) the tap turns it OFF —
 * cancels the drawing and clears the zone — and only an idle flow starts one.
 */
export function zonePillAction(drawing: boolean, zone: ZoneShape | null): 'draw' | 'off' {
  return drawing || zone !== null ? 'off' : 'draw'
}

export interface FrameSize {
  readonly w: number
  readonly h: number
}

/** Minimal item shape the zone filter needs (structural — avoids importing the
 *  timeline's `ObjectEvent` and creating a module cycle). */
export interface ZoneFilterable {
  readonly positionBoxes?: readonly PixelRect[]
  /** The server's `envelope`, already converted to a {@link ZoneRect}: the
   *  track's trajectory bounds NORMALISED 0..1 against the real detection
   *  frame. Absent on legacy rows and on dims-less / active tracks. */
  readonly normalizedEnvelope?: ZoneRect
}

// ─── Geometry primitives ──────────────────────────────────────────────

/** True when the two normalised rects overlap (open intervals — mere edge
 *  contact does not count as an intersection). */
export function rectsIntersect(a: ZoneRect, b: ZoneRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** Normalise a pixel rect against the frame size; null for a degenerate frame. */
export function normalizeRect(rect: PixelRect, frame: FrameSize): ZoneRect | null {
  if (frame.w <= 0 || frame.h <= 0) return null
  return { x: rect.x / frame.w, y: rect.y / frame.h, w: rect.w / frame.w, h: rect.h / frame.h }
}

/**
 * Estimate the detection-frame size as the max bbox extent across every
 * track's position boxes. FALLBACK ONLY — it is wrong by construction on any
 * camera whose subjects never reach an edge (see module doc). Null when no
 * usable geometry.
 */
export function estimateFrameSize(
  boxesPerTrack: readonly (readonly PixelRect[])[],
): FrameSize | null {
  let w = 0
  let h = 0
  for (const boxes of boxesPerTrack) {
    for (const b of boxes) {
      if (b.x + b.w > w) w = b.x + b.w
      if (b.y + b.h > h) h = b.y + b.h
    }
  }
  return w > 0 && h > 0 ? { w, h } : null
}

/**
 * Smallest envelope extent that can pin a frame dimension. Below it the
 * division amplifies the server's rounding: a track that barely moved spans a
 * few thousandths of the frame, and 1e-3 of relative error there becomes tens
 * of pixels of frame size. Tracks that small are plentiful, so discarding them
 * costs nothing.
 */
export const MIN_ENVELOPE_EXTENT = 0.02

/**
 * Recover the EXACT detection-frame size from ONE track that carries both its
 * pixel positions and the server's normalised envelope: the same extent
 * measured in both spaces is a scale factor. Null when either space is missing
 * or too small to divide by.
 */
export function frameSizeFromEnvelope(
  boxes: readonly PixelRect[] | undefined,
  envelope: ZoneRect | undefined,
): FrameSize | null {
  if (boxes === undefined || boxes.length === 0 || envelope === undefined) return null
  if (envelope.w < MIN_ENVELOPE_EXTENT || envelope.h < MIN_ENVELOPE_EXTENT) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const b of boxes) {
    if (b.x < minX) minX = b.x
    if (b.y < minY) minY = b.y
    if (b.x + b.w > maxX) maxX = b.x + b.w
    if (b.y + b.h > maxY) maxY = b.y + b.h
  }
  const w = (maxX - minX) / envelope.w
  const h = (maxY - minY) / envelope.h
  return w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h) ? { w, h } : null
}

/** Median of a non-empty list (no mutation of the input). */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/**
 * The frame every position box is normalised against, for a whole item set.
 *
 * Prefers the EXACT recovery, taken as the median over every item that can
 * supply one — a median rather than the first match so a single anomalous row
 * (a re-encoded stream, a truncated position history) cannot re-scale the
 * entire filter. Falls back to {@link estimateFrameSize} only when NO item
 * carries an envelope, which today means only legacy rows.
 */
export function resolveFrameSize(items: readonly ZoneFilterable[]): FrameSize | null {
  const widths: number[] = []
  const heights: number[] = []
  for (const item of items) {
    const exact = frameSizeFromEnvelope(item.positionBoxes, item.normalizedEnvelope)
    if (exact !== null) {
      widths.push(exact.w)
      heights.push(exact.h)
    }
  }
  if (widths.length > 0 && heights.length > 0) {
    return { w: median(widths), h: median(heights) }
  }
  return estimateFrameSize(items.map((i) => i.positionBoxes ?? []))
}

// ─── Parsing (raw listTracks row → pixel boxes) ───────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toPixelRect(v: unknown): PixelRect | null {
  if (!isRecord(v)) return null
  const { x, y, w, h } = v
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof w !== 'number' ||
    typeof h !== 'number'
  ) {
    return null
  }
  if (!(w > 0) || !(h > 0)) return null
  return { x, y, w, h }
}

/** Extract the pixel bboxes of a raw `listTracks` row's `positions[]`. Tolerant:
 *  malformed entries are skipped; a non-array yields []. Never throws. */
export function parsePositionBoxes(row: unknown): readonly PixelRect[] {
  if (!isRecord(row) || !Array.isArray(row.positions)) return []
  const out: PixelRect[] = []
  for (const p of row.positions) {
    if (!isRecord(p)) continue
    const rect = toPixelRect(p.bbox)
    if (rect !== null) out.push(rect)
  }
  return out
}

/**
 * Extract a raw `listTracks` row's `envelope` (min/max normalised 0..1) as a
 * {@link ZoneRect}. Null when the row has none (legacy / dims-less / active
 * tracks), when a bound is not a finite number, or when the envelope is
 * inverted. Tolerant: never throws.
 */
export function parseNormalizedEnvelope(row: unknown): ZoneRect | null {
  if (!isRecord(row) || !isRecord(row.envelope)) return null
  const { minX, minY, maxX, maxY } = row.envelope
  if (
    typeof minX !== 'number' ||
    typeof minY !== 'number' ||
    typeof maxX !== 'number' ||
    typeof maxY !== 'number' ||
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null
  }
  if (maxX < minX || maxY < minY) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// ─── Track ↔ zone predicate + event filtering ─────────────────────────

/**
 * True when the track reaches into the zone.
 *
 * Per-POSITION when the frame is known: a track that walked past the zone on
 * its way elsewhere is correctly rejected. Falls back to the envelope — the
 * trajectory's bounding box, which over-matches an L-shaped path — only when
 * there is no frame to normalise positions against, or no positions at all. A
 * track with neither always passes: it cannot be judged, and silently hiding
 * it would misreport the camera as quiet.
 */
export function trackMatchesZone(
  item: ZoneFilterable,
  frame: FrameSize | null,
  zone: ZoneShape,
): boolean {
  const boxes = item.positionBoxes
  if (frame !== null && boxes !== undefined && boxes.length > 0) {
    for (const b of boxes) {
      const normalized = normalizeRect(b, frame)
      if (normalized === null) continue
      if (zone.kind === 'rect') {
        if (rectsIntersect(normalized, zone.rect)) return true
      } else if (rectIntersectsPolygon(normalized, zone.points)) {
        return true
      }
    }
    return false
  }
  // Envelope fallback: the track carries only its trajectory BOUNDS, so the
  // most we can say about a polygon is whether those bounds touch it. That is
  // deliberately generous — a track whose envelope overlaps a concave zone's
  // notch passes. Better than dropping a track we cannot judge: the per-box
  // test above is exact and is what runs whenever positions are present.
  if (item.normalizedEnvelope !== undefined) {
    return zone.kind === 'rect'
      ? rectsIntersect(item.normalizedEnvelope, zone.rect)
      : rectIntersectsPolygon(item.normalizedEnvelope, zone.points)
  }
  return true
}

/**
 * Apply an active zone to the timeline's event items. The frame is resolved
 * from the SAME item set (see {@link resolveFrameSize}); items the filter
 * cannot judge pass through.
 */
export function filterEventsByZone<T extends ZoneFilterable>(
  events: readonly T[],
  zone: ZoneShape | null,
): readonly T[] {
  if (zone === null) return events
  const frame = resolveFrameSize(events)
  return events.filter((e) => trackMatchesZone(e, frame, zone))
}

// ─── Drag → zone rect (the editor gesture) ────────────────────────────

/** Smallest usable zone edge (fraction of the frame) — rejects accidental taps. */
export const MIN_ZONE_FRACTION = 0.02

/**
 * Map a drag from `(startX, startY)` to `(endX, endY)` (px, relative to the
 * displayed image box of `boxW × boxH`) onto a normalised, clamped ZoneRect.
 * Any drag direction works; null while the box is unmeasured.
 */
export function dragToRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  boxW: number,
  boxH: number,
): ZoneRect | null {
  if (boxW <= 0 || boxH <= 0) return null
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
  const x1 = clamp01(Math.min(startX, endX) / boxW)
  const y1 = clamp01(Math.min(startY, endY) / boxH)
  const x2 = clamp01(Math.max(startX, endX) / boxW)
  const y2 = clamp01(Math.max(startY, endY) / boxH)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/** True when the drawn zone is big enough to act as a filter. */
export function isZoneUsable(zone: ZoneRect): boolean {
  return zone.w >= MIN_ZONE_FRACTION && zone.h >= MIN_ZONE_FRACTION
}
