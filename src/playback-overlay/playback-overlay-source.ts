/**
 * playback-overlay-source — what the live overlays draw during RECORDED
 * playback, derived from the tracks the hub stored.
 *
 * One pure source behind the existing overlay components: detection boxes from
 * each track's `positions[]` interpolated at the playback time, occupancy as
 * the tracks alive at that time, the motion badge from the merged spans of
 * those tracks, and an audio level that is ALWAYS null here (no stored level
 * exists; a player-side tap may supply one, a fake never does).
 *
 * D315: a range whose tracks were pruned is UNKNOWN, never "no detections" —
 * {@link resolveCoverage} is the one place that tells the two apart, and
 * {@link frameAt} on unknown coverage returns no frame at all.
 */
import type { DetectionBox } from '../data/use-detections.js'
import {
  frameSizeFromEnvelope,
  parseNormalizedEnvelope,
  parsePositionBoxes,
  type FrameSize,
} from '../components/camera/theater/zone-filter.js'

/** One stored position, bbox in frame pixels. */
export interface TrackSample {
  readonly t: number
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly score?: number
}

export interface OverlayTrack {
  readonly id: string
  readonly className: string
  readonly firstSeen: number
  readonly lastSeen: number
  readonly samples: readonly TrackSample[]
  /** Detection-frame size the pixel boxes are measured in; null = cannot be
   *  normalised (the track still counts for occupancy and motion). */
  readonly frame: FrameSize | null
}

export interface OccupancyCount {
  readonly className: string
  readonly count: number
}

export interface MotionEpisode {
  readonly start: number
  readonly end: number
}

export type PlaybackOverlayFrame =
  | { readonly availability: 'unknown' }
  | {
      readonly availability: 'known'
      readonly boxes: readonly DetectionBox[]
      readonly occupancy: readonly OccupancyCount[]
      readonly motion: boolean
      /** Null = no level available; the meter stays hidden. */
      readonly audioDbfs: number | null
    }

export type Coverage = 'known' | 'unknown'

export interface PlaybackOverlaySourceData {
  readonly tracks: readonly OverlayTrack[]
  readonly coverage: Coverage
}

/** A hole in `positions[]` wider than this is not bridged by interpolation. */
export const MAX_INTERP_GAP_MS = 3_000
/** How far past its first / last stored position a box is held. */
export const EDGE_HOLD_MS = 1_000
/** Spans closer than this are one motion episode. */
export const MOTION_MERGE_GAP_MS = 2_000

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function parseSamples(row: Record<string, unknown>): readonly TrackSample[] {
  if (!Array.isArray(row.positions)) return []
  const out: TrackSample[] = []
  for (const p of row.positions) {
    if (!isRecord(p) || !isRecord(p.bbox)) continue
    const t = num(p.timestamp)
    const x = num(p.bbox.x)
    const y = num(p.bbox.y)
    const w = num(p.bbox.w)
    const h = num(p.bbox.h)
    if (t === null || x === null || y === null || w === null || h === null || !(w > 0) || !(h > 0)) continue
    const score = num(p.score)
    out.push(score === null ? { t, x, y, w, h } : { t, x, y, w, h, score })
  }
  return out.sort((a, b) => a.t - b.t)
}

/** Frame size from the envelope; else from the normalised centre every
 *  position also carries (centre px ÷ centre normalised). */
function resolveFrame(row: Record<string, unknown>, samples: readonly TrackSample[]): FrameSize | null {
  const envelope = parseNormalizedEnvelope(row)
  const fromEnvelope = frameSizeFromEnvelope(
    parsePositionBoxes(row),
    envelope === null ? undefined : envelope,
  )
  if (fromEnvelope !== null) return fromEnvelope
  if (!Array.isArray(row.positions)) return null
  const ws: number[] = []
  const hs: number[] = []
  for (const p of row.positions) {
    if (!isRecord(p) || !isRecord(p.bbox)) continue
    const nx = num(p.x)
    const ny = num(p.y)
    const bx = num(p.bbox.x)
    const by = num(p.bbox.y)
    const bw = num(p.bbox.w)
    const bh = num(p.bbox.h)
    if (nx === null || ny === null || bx === null || by === null || bw === null || bh === null) continue
    if (nx > 0.1 && ny > 0.1) {
      ws.push((bx + bw / 2) / nx)
      hs.push((by + bh / 2) / ny)
    }
  }
  if (ws.length === 0 || samples.length === 0) return null
  const mid = (a: readonly number[]): number => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)] ?? 0
  const w = mid(ws)
  const h = mid(hs)
  return w > 0 && h > 0 ? { w, h } : null
}

/** Raw `listTracks` rows → tracks. Tolerant: a malformed row is skipped. */
export function normalizeTracks(rows: readonly unknown[]): readonly OverlayTrack[] {
  const out: OverlayTrack[] = []
  for (const row of rows) {
    if (!isRecord(row)) continue
    const id = typeof row.trackId === 'string' ? row.trackId : null
    const className = typeof row.className === 'string' ? row.className : null
    const firstSeen = num(row.firstSeen)
    const lastSeen = num(row.lastSeen)
    if (id === null || className === null || firstSeen === null || lastSeen === null) continue
    const samples = parseSamples(row)
    out.push({ id, className, firstSeen, lastSeen, samples, frame: resolveFrame(row, samples) })
  }
  return out
}

function isAlive(track: OverlayTrack, t: number): boolean {
  return t >= track.firstSeen && t <= track.lastSeen
}

function boxOf(track: OverlayTrack, s: TrackSample): DetectionBox | null {
  const f = track.frame
  if (f === null) return null
  return {
    label: track.className,
    score: s.score ?? 0,
    x1: s.x / f.w,
    y1: s.y / f.h,
    x2: (s.x + s.w) / f.w,
    y2: (s.y + s.h) / f.h,
  }
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

/** The track's sample at `t`: interpolated between neighbours, held briefly
 *  past either end, null across a wide hole. */
function sampleAt(track: OverlayTrack, t: number): TrackSample | null {
  const s = track.samples
  const first = s[0]
  const last = s[s.length - 1]
  if (first === undefined || last === undefined) return null
  if (t <= first.t) return first.t - t <= EDGE_HOLD_MS ? first : null
  if (t >= last.t) return t - last.t <= EDGE_HOLD_MS ? last : null
  let lo = 0
  let hi = s.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((s[mid]?.t ?? 0) <= t) lo = mid
    else hi = mid
  }
  const a = s[lo]
  const b = s[hi]
  if (a === undefined || b === undefined) return null
  if (b.t - a.t > MAX_INTERP_GAP_MS) {
    const nearest = t - a.t <= b.t - t ? a : b
    return Math.abs(nearest.t - t) <= EDGE_HOLD_MS ? nearest : null
  }
  const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
  const score = a.score !== undefined && b.score !== undefined ? lerp(a.score, b.score, k) : undefined
  const base = { t, x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) }
  return score === undefined ? base : { ...base, score }
}

/** Boxes of every track alive at `t`. */
export function boxesAt(tracks: readonly OverlayTrack[], t: number): readonly DetectionBox[] {
  const out: DetectionBox[] = []
  for (const track of tracks) {
    if (!isAlive(track, t)) continue
    const sample = sampleAt(track, t)
    if (sample === null) continue
    const box = boxOf(track, sample)
    if (box !== null) out.push(box)
  }
  return out
}

function occupancyAt(tracks: readonly OverlayTrack[], t: number): readonly OccupancyCount[] {
  const counts = new Map<string, number>()
  for (const track of tracks) {
    if (isAlive(track, t)) counts.set(track.className, (counts.get(track.className) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([className, count]) => ({ className, count }))
    .sort((a, b) => b.count - a.count || a.className.localeCompare(b.className))
}

/** Track lifetimes merged into motion episodes. */
export function motionEpisodes(tracks: readonly OverlayTrack[]): readonly MotionEpisode[] {
  const spans = tracks.map((t) => ({ start: t.firstSeen, end: t.lastSeen })).sort((a, b) => a.start - b.start)
  const out: MotionEpisode[] = []
  for (const span of spans) {
    const prev = out[out.length - 1]
    if (prev !== undefined && span.start - prev.end <= MOTION_MERGE_GAP_MS) {
      out[out.length - 1] = { start: prev.start, end: Math.max(prev.end, span.end) }
    } else {
      out.push(span)
    }
  }
  return out
}

export interface CoverageSignal {
  /** The window read answered (not loading, not failed). */
  readonly answered: boolean
  readonly windowTracks: number
  /** Tracks found by a probe at or before the window's end. */
  readonly probeTracks: number
}

/**
 * Can the overlay say anything about this range?
 *
 * An empty window is "quiet" only when older history exists; with nothing at
 * or before it, the range is before the oldest track we still hold and a
 * pruned range looks exactly like a quiet one — so it is unknown.
 */
export function resolveCoverage(signal: CoverageSignal): Coverage {
  if (!signal.answered) return 'unknown'
  if (signal.windowTracks > 0) return 'known'
  return signal.probeTracks > 0 ? 'known' : 'unknown'
}

/** Everything the overlays draw at playback time `t`. */
export function frameAt(source: PlaybackOverlaySourceData, t: number): PlaybackOverlayFrame {
  if (source.coverage === 'unknown') return { availability: 'unknown' }
  const motion = motionEpisodes(source.tracks).some((e) => t >= e.start && t <= e.end)
  return {
    availability: 'known',
    boxes: boxesAt(source.tracks, t),
    occupancy: occupancyAt(source.tracks, t),
    motion,
    audioDbfs: null,
  }
}
