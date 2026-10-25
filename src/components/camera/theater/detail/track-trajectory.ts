/**
 * track-trajectory — pure geometry for the track detail's PATH image: every
 * position of one track drawn over its best stored full frame, so the operator
 * reads "where did this subject actually go" from one picture instead of
 * inferring it from a single crop.
 *
 * ## Coordinate spaces (the trap that bit the zone filter — see zone-filter.ts)
 *
 * A track's `positions[].bbox` is in PIXELS of the DETECTION-frame space
 * (640×360 on the measured cameras). The frame we draw on is a different,
 * larger space (`keyFrame` native, `keyFrameSmall` 960, …). The bridge is the
 * SAME recovery the zone filter uses: {@link resolveFrameSize} pins the exact
 * detection-frame dimensions from one track carrying both its pixel positions
 * and the server-normalised `envelope`; every path point is then normalised
 * 0..1 and projected onto the rendered image rect by the overlay. Nothing here
 * re-derives that math.
 *
 * ## Honesty rules, from real tracks (verified live, device 101, 2026-08-02)
 *
 *  - A near-FULL-FRAME box (e.g. 637.2×341.4 on a 640×360 frame) is a motion
 *    placeholder, not a localisation: its center is an artifact. Drawing it as
 *    a path point would put a confident dot mid-frame where nothing stood.
 *    Such samples are folded into ONE {@link UnlocalizedSummary} — rendered as
 *    a dashed region, never as points. A track whose EVERY sample is
 *    unlocalized (the stationary phantom: 8 identical full-frame boxes,
 *    totalDistance 0) therefore shows an honest "somewhere in this region for
 *    N samples", not a fake center dot.
 *  - A stationary subject produces many IDENTICAL samples (a parked car held
 *    one box for 11 samples / 3.8s). Consecutive samples closer than
 *    {@link DWELL_COLLAPSE_EPS} collapse into one {@link TrajectoryNode}
 *    carrying the sample count and the dwell time span — rendered as one node
 *    whose size and label encode the dwell, not 11 stacked dots.
 *
 * All pure — no React, no fetching, no `any`. Unit-tested against the real
 * tracks in `__tests__/track-trajectory.spec.ts`.
 */

import {
  resolveFrameSize,
  type FrameSize,
  type PixelRect,
  type ZoneRect,
} from '../zone-filter.js'
import type { ScreenRect } from './cluster-detail.js'
import type { MediaGroup, LogicalMediaKind } from '../../../../data/track-media-groups.js'

// ─── Types ────────────────────────────────────────────────────────────

/** One raw track position: its detection-frame pixel bbox + capture time. */
export interface TrackPositionSample {
  readonly bbox: PixelRect
  readonly timestamp: number
}

/** One drawn path node: a normalised (0..1) center, the samples that collapsed
 *  into it, their time span, and the LAST sample's normalised bbox. */
export interface TrajectoryNode {
  readonly x: number
  readonly y: number
  readonly samples: number
  readonly firstTs: number
  readonly lastTs: number
  readonly bbox: ZoneRect
}

/** The samples that carried NO localisation (near-full-frame boxes), folded
 *  into one honest summary: how many, when, and the region they claimed. */
export interface UnlocalizedSummary {
  readonly samples: number
  readonly firstTs: number
  readonly lastTs: number
  readonly bbox: ZoneRect
}

/** The full drawable model for one track's trajectory. */
export interface TrackTrajectory {
  readonly nodes: readonly TrajectoryNode[]
  readonly unlocalized: UnlocalizedSummary | null
  /** The recovered detection-frame size the positions were normalised against. */
  readonly frame: FrameSize
}

// ─── Constants ────────────────────────────────────────────────────────

/** A bbox covering at least this fraction of BOTH frame dimensions is a
 *  motion placeholder, not a localisation (the real degenerate boxes measure
 *  0.996×0.948 of the frame; real subjects a fraction of that). */
export const FULL_FRAME_COVERAGE = 0.85

/** Consecutive samples whose centers are closer than this (normalised
 *  euclidean) collapse into one dwell node. 0.005 ≈ 3 px on a 640-wide
 *  detection frame — identical boxes and sub-pixel jitter collapse, a real
 *  step (≥ ~5 px) does not. */
export const DWELL_COLLAPSE_EPS = 0.005

// ─── Parsing (raw getTrack row → samples) ─────────────────────────────

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

/**
 * Extract `{bbox, timestamp}` samples from a raw `pipelineAnalytics.getTrack`
 * row's `positions[]`. The zone filter's `parsePositionBoxes` drops the
 * timestamps this model needs for dwell, hence the sibling parser (same
 * tolerance rules: malformed entries skipped, non-array → [], never throws;
 * a missing timestamp becomes 0 so ordering still holds).
 */
export function parseTrackPositions(row: unknown): TrackPositionSample[] {
  if (!isRecord(row) || !Array.isArray(row.positions)) return []
  const out: TrackPositionSample[] = []
  for (const p of row.positions) {
    if (!isRecord(p)) continue
    const bbox = toPixelRect(p.bbox)
    if (bbox === null) continue
    const timestamp = typeof p.timestamp === 'number' && Number.isFinite(p.timestamp) ? p.timestamp : 0
    out.push({ bbox, timestamp })
  }
  return out
}

// ─── Model building ───────────────────────────────────────────────────

function normalizedBbox(b: PixelRect, frame: FrameSize): ZoneRect {
  return { x: b.x / frame.w, y: b.y / frame.h, w: b.w / frame.w, h: b.h / frame.h }
}

/**
 * Build the drawable trajectory for one track.
 *
 * The detection-frame size is recovered via the zone filter's
 * {@link resolveFrameSize} (exact envelope recovery, max-extent estimate as the
 * legacy fallback) — the SAME bridge that fixed the zone filter's two-spaces
 * defect. Null when there are no positions or no frame can be resolved.
 */
export function buildTrackTrajectory(
  positions: readonly TrackPositionSample[],
  envelope: ZoneRect | null,
): TrackTrajectory | null {
  if (positions.length === 0) return null
  const boxes = positions.map((p) => p.bbox)
  const frame = resolveFrameSize([
    {
      positionBoxes: boxes,
      ...(envelope !== null ? { normalizedEnvelope: envelope } : {}),
    },
  ])
  if (frame === null) return null

  const nodes: TrajectoryNode[] = []
  let unlocalized: UnlocalizedSummary | null = null

  for (const p of positions) {
    const isUnlocalized =
      p.bbox.w >= FULL_FRAME_COVERAGE * frame.w && p.bbox.h >= FULL_FRAME_COVERAGE * frame.h
    const nbox = normalizedBbox(p.bbox, frame)

    if (isUnlocalized) {
      unlocalized =
        unlocalized === null
          ? { samples: 1, firstTs: p.timestamp, lastTs: p.timestamp, bbox: nbox }
          : {
              samples: unlocalized.samples + 1,
              firstTs: Math.min(unlocalized.firstTs, p.timestamp),
              lastTs: Math.max(unlocalized.lastTs, p.timestamp),
              bbox: nbox,
            }
      continue
    }

    const cx = nbox.x + nbox.w / 2
    const cy = nbox.y + nbox.h / 2
    const prev = nodes[nodes.length - 1]
    if (prev !== undefined && Math.hypot(cx - prev.x, cy - prev.y) < DWELL_COLLAPSE_EPS) {
      nodes[nodes.length - 1] = {
        ...prev,
        samples: prev.samples + 1,
        lastTs: Math.max(prev.lastTs, p.timestamp),
        bbox: nbox,
      }
      continue
    }
    nodes.push({ x: cx, y: cy, samples: 1, firstTs: p.timestamp, lastTs: p.timestamp, bbox: nbox })
  }

  if (nodes.length === 0 && unlocalized === null) return null
  return { nodes, unlocalized, frame }
}

/** How long the subject held one node's position. */
export function dwellMs(node: TrajectoryNode): number {
  return Math.max(0, node.lastTs - node.firstTs)
}

/** Total raw samples the model accounts for (path + unlocalized). */
export function trajectorySampleCount(traj: TrackTrajectory): number {
  return traj.nodes.reduce((acc, n) => acc + n.samples, 0) + (traj.unlocalized?.samples ?? 0)
}

/** Full time span covered by the samples, in ms. */
export function trajectorySpanMs(traj: TrackTrajectory): number {
  let first = Number.POSITIVE_INFINITY
  let last = Number.NEGATIVE_INFINITY
  for (const n of traj.nodes) {
    if (n.firstTs < first) first = n.firstTs
    if (n.lastTs > last) last = n.lastTs
  }
  if (traj.unlocalized !== null) {
    if (traj.unlocalized.firstTs < first) first = traj.unlocalized.firstTs
    if (traj.unlocalized.lastTs > last) last = traj.unlocalized.lastTs
  }
  return Number.isFinite(first) && Number.isFinite(last) ? Math.max(0, last - first) : 0
}

// ─── Base-frame selection ─────────────────────────────────────────────

/**
 * Preference order for the frame the path is drawn on. Only FULL-scene frames
 * qualify — a crop (best shot / face / plate / object crop) shows a fragment
 * of the picture, so frame-normalised points cannot be drawn on it
 * meaningfully. `keyFrame` first: it is the clean full frame captured at the
 * track's BEST detection (the full-frame counterpart of the best-shot crop —
 * the pipeline's existing "best" ranking, not a new one). Then the event's
 * clean `fullFrame`, then the pre-boxed cadence frames.
 */
const BASE_FRAME_PREFERENCE: readonly LogicalMediaKind[] = [
  'keyFrame',
  'frame',
  'firstFrame',
  'lastFrame',
  'snapshot',
  'frameBoxed',
]

/** The stored media group the trajectory is drawn over, or null when the track
 *  has only crops (no full-scene frame → no path image). */
export function pickTrajectoryBase(groups: readonly MediaGroup[]): MediaGroup | null {
  for (const kind of BASE_FRAME_PREFERENCE) {
    const g = groups.find((candidate) => candidate.logicalKind === kind)
    if (g !== undefined) return g
  }
  return null
}

// ─── Screen projection (overlay math; container → SVG coords) ─────────

export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

/** Project a normalised (0..1) point onto the contain-rendered image rect
 *  (as computed by `cluster-detail.ts`'s `containRect`). */
export function pointToScreen(x: number, y: number, image: ScreenRect): ScreenPoint {
  return { x: image.left + x * image.width, y: image.top + y * image.height }
}

/** Project a normalised rect onto the contain-rendered image rect. */
export function normalizedRectToScreen(rect: ZoneRect, image: ScreenRect): ScreenRect {
  return {
    left: image.left + rect.x * image.width,
    top: image.top + rect.y * image.height,
    width: rect.w * image.width,
    height: rect.h * image.height,
  }
}

/**
 * SVG polygon `points` string for an arrowhead of `size` px whose tip sits at
 * `to`, oriented along `from → to`. Degenerate (zero-length) segments point
 * right so the head still renders.
 */
export function arrowHeadPoints(from: ScreenPoint, to: ScreenPoint, size: number): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  const ux = len > 0 ? dx / len : 1
  const uy = len > 0 ? dy / len : 0
  const bx = to.x - ux * size
  const by = to.y - uy * size
  const wx = -uy * (size * 0.6)
  const wy = ux * (size * 0.6)
  const fmt = (v: number): string => String(Math.round(v * 100) / 100)
  return `${fmt(to.x)},${fmt(to.y)} ${fmt(bx + wx)},${fmt(by + wy)} ${fmt(bx - wx)},${fmt(by - wy)}`
}

/** Node marker radius: grows with dwell time (sqrt — legible, not linear),
 *  bounded so an hour-long dwell cannot swallow the frame. */
export function nodeRadius(node: TrajectoryNode): number {
  const dwellSec = dwellMs(node) / 1000
  return Math.min(12, 3.5 + Math.sqrt(dwellSec) * 1.6)
}
