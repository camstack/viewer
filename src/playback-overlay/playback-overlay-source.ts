/**
 * playback-overlay-source — what the live overlays draw during RECORDED
 * playback, derived from the tracks the hub stored.
 *
 * One pure source behind the existing overlay components: detection boxes from
 * each track's `positions[]` interpolated at the playback time, occupancy as
 * the tracks alive at that time, the motion badge from the merged spans of
 * those tracks (or, when the hub answered, the stored motion EPISODES), and the
 * audio level read from the stored device-history series
 * ({@link AUDIO_LEVEL_HISTORY_KEY}).
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

/** One stored audio-level point: the time and the dBFS the hub recorded. */
export interface AudioPoint {
  readonly t: number
  readonly dbfs: number
}

/** The stored audio level over a window, sorted by time. Absent (null where it
 *  travels) means the hub did not answer or holds nothing for the window. */
export interface AudioSeries {
  readonly points: readonly AudioPoint[]
}

/** A stored motion region at playback time, normalised to the frame. */
export interface MotionRegionBox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly pixelCount: number
}

/** One stored motion episode (`pipelineAnalytics.getMotionEvents`). */
export interface StoredMotionEpisode extends MotionEpisode {
  readonly regions: readonly MotionRegionBox[]
}

/** The device-history series the hub keeps the audio level in. */
export const AUDIO_LEVEL_HISTORY_KEY = 'addon:pipeline-analytics/audio-level'
/** How long a stored level is held past its point: the raw step is ~10 s, so a
 *  point answers the next step and a half, and nothing beyond (a hole is
 *  unknown, not the last value forever). A rollup bucket answers its own width. */
export const AUDIO_HOLD_MS = 15_000
/** Widest rollup bucket a point may stand for (1 h). */
export const AUDIO_ROLLUP_HOLD_MS = 3_600_000
/** A motion row without a duration still lasts this long on screen. */
export const MOTION_TAIL_MS = 2_000

export type PlaybackOverlayFrame =
  | { readonly availability: 'unknown' }
  | {
      readonly availability: 'known'
      readonly boxes: readonly DetectionBox[]
      readonly occupancy: readonly OccupancyCount[]
      readonly motion: boolean
      /** Null = no level available; the meter stays hidden. Never 0. */
      readonly audioDbfs: number | null
      /** Stored motion regions of the episode at this time (empty = none
       *  stored; the regions layer draws nothing). */
      readonly motionRegions: readonly MotionRegionBox[]
    }

export type Coverage = 'known' | 'unknown'

export interface PlaybackOverlaySourceData {
  readonly tracks: readonly OverlayTrack[]
  readonly coverage: Coverage
  /** The stored audio level; null = unanswered or empty (unknown, never 0). */
  readonly audio?: AudioSeries | null
  /** The stored motion episodes; null = unanswered (motion then falls back to
   *  the tracks' spans). An empty list is a real answer: no motion. */
  readonly motion?: readonly StoredMotionEpisode[] | null
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
    ...(s.score === undefined ? { noScore: true as const } : {}),
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

/**
 * `deviceHistory.query` answer → the audio series. A malformed answer, a query
 * that returned no point, and a point without a value all yield null/skip — the
 * caller treats null as UNKNOWN, never as silence (D315, D393).
 */
export function parseAudioSeries(raw: unknown): AudioSeries | null {
  if (!isRecord(raw) || !Array.isArray(raw.series)) return null
  const first = raw.series.find(isRecord)
  if (first === undefined || !Array.isArray(first.points)) return null
  const points: AudioPoint[] = []
  for (const p of first.points) {
    if (!isRecord(p)) continue
    const t = num(p.t)
    const dbfs = num(p.last) ?? num(p.mean)
    if (t === null || dbfs === null) continue
    points.push({ t, dbfs })
  }
  if (points.length === 0) return null
  return { points: points.sort((a, b) => a.t - b.t) }
}

/** The level at `t`: the latest point at or before it, held for
 *  {@link AUDIO_HOLD_MS}; null across a hole or with no series. */
export function audioAt(series: AudioSeries | null | undefined, t: number): number | null {
  if (series === null || series === undefined) return null
  let lo = 0
  let hi = series.points.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((series.points[mid]?.t ?? Infinity) <= t) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  const point = series.points[found]
  if (point === undefined) return null
  const next = series.points[found + 1]
  // A rollup bucket stands for its own width: the gap to the next point, up to
  // an hour. A raw step is held a little past itself.
  const span = next === undefined ? AUDIO_HOLD_MS : Math.min(AUDIO_ROLLUP_HOLD_MS, Math.max(AUDIO_HOLD_MS, next.t - point.t))
  return t - point.t <= span ? point.dbfs : null
}

function parseMotionRegions(row: Record<string, unknown>): readonly MotionRegionBox[] {
  const w = num(row.frameWidth)
  const h = num(row.frameHeight)
  if (w === null || h === null || !(w > 0) || !(h > 0) || !Array.isArray(row.regions)) return []
  const out: MotionRegionBox[] = []
  for (const r of row.regions) {
    if (!isRecord(r) || !isRecord(r.bbox)) continue
    const x = num(r.bbox.x)
    const y = num(r.bbox.y)
    const bw = num(r.bbox.w)
    const bh = num(r.bbox.h)
    if (x === null || y === null || bw === null || bh === null || !(bw > 0) || !(bh > 0)) continue
    out.push({ x: x / w, y: y / h, w: bw / w, h: bh / h, pixelCount: num(r.pixelCount) ?? 0 })
  }
  return out
}

/**
 * `getMotionEvents` rows → episodes. A row is one EPISODE (`durationMs` = first
 * to last rising edge; null = still open → runs to `nowMs`; absent = a legacy
 * row, which lasts its last stored edge). Never read an absent duration as an
 * open episode. Null when the answer is not a list.
 */
export function parseMotionEvents(raw: unknown, nowMs: number): readonly StoredMotionEpisode[] | null {
  if (!Array.isArray(raw)) return null
  const out: StoredMotionEpisode[] = []
  for (const row of raw) {
    if (!isRecord(row)) continue
    const start = num(row.timestamp)
    if (start === null) continue
    const edges = Array.isArray(row.edges) ? row.edges.map(num).filter((e): e is number => e !== null) : []
    const lastEdge = edges.length > 0 ? Math.max(...edges) : 0
    const end =
      row.durationMs === null
        ? Math.max(nowMs, start + MOTION_TAIL_MS)
        : start + (num(row.durationMs) ?? lastEdge) + MOTION_TAIL_MS
    out.push({ start, end, regions: parseMotionRegions(row) })
  }
  return out.sort((a, b) => a.start - b.start)
}

export interface CoverageSignal {
  /** The window read hit its row limit: rows past it were never seen, so the
   *  range cannot be called known. */
  readonly truncated?: boolean
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
  if (signal.truncated === true) return 'unknown'
  if (signal.windowTracks > 0) return 'known'
  return signal.probeTracks > 0 ? 'known' : 'unknown'
}

/** Everything the overlays draw at playback time `t`. */
export function frameAt(source: PlaybackOverlaySourceData, t: number): PlaybackOverlayFrame {
  if (source.coverage === 'unknown') return { availability: 'unknown' }
  const stored = source.motion ?? null
  const active = stored?.find((e) => t >= e.start && t <= e.end)
  // The hub's motion episodes are the truth when it answered; a failed read
  // falls back to the tracks' spans, which is what drew before.
  const motion =
    stored !== null ? active !== undefined : motionEpisodes(source.tracks).some((e) => t >= e.start && t <= e.end)
  return {
    availability: 'known',
    boxes: boxesAt(source.tracks, t),
    occupancy: occupancyAt(source.tracks, t),
    motion,
    audioDbfs: audioAt(source.audio, t),
    motionRegions: active?.regions ?? NO_REGIONS,
  }
}

export interface PlaybackGateInput {
  readonly isLive: boolean
  readonly paused: boolean
  readonly availability: PlaybackOverlayFrame['availability']
  readonly audioDbfs: number | null
}

export interface PlaybackGates {
  /** The live edge, playing: the live feeds draw. */
  readonly liveOverlays: boolean
  /** Recorded playback with a known range: the stored-track source draws. */
  readonly fromPlayback: boolean
  /** Boxes, highlight border and occupancy follow either source. */
  readonly boxes: boolean
  readonly border: boolean
  readonly occupancy: boolean
  /** The motion pill, border and regions follow either source too. */
  readonly motion: boolean
  /** Playback never shows a meter without a real level. */
  readonly audioMeter: boolean
}

/** Which source an overlay draws from: live, stored tracks, or nothing. */
export function resolvePlaybackGates(input: PlaybackGateInput): PlaybackGates {
  const liveOverlays = input.isLive && !input.paused
  const fromPlayback = !input.isLive && input.availability === 'known'
  const shown = liveOverlays || fromPlayback
  return {
    liveOverlays,
    fromPlayback,
    boxes: shown,
    border: shown,
    occupancy: shown,
    motion: shown,
    audioMeter: liveOverlays || (fromPlayback && input.audioDbfs !== null),
  }
}

const NO_REGIONS: readonly MotionRegionBox[] = []

export const NO_OCCUPANCY: readonly OccupancyCount[] = []

export function sameOccupancy(a: readonly OccupancyCount[], b: readonly OccupancyCount[]): boolean {
  return a.length === b.length && a.every((c, i) => c.className === b[i]?.className && c.count === b[i]?.count)
}
