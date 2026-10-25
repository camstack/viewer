/** Pure helpers for the cluster detail view. No React, no side-effects, no `any`. */

// ─── Types ────────────────────────────────────────────────────────────

/** Pixel-space bounding box in the INFERENCE frame's coordinate system
 *  (mirrors the server `BoundingBoxSchema`). Map onto a displayed image with
 *  `frameWidth`/`frameHeight`. */
export interface Bbox {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** A single detection enriched from the `projection: 'full'` object event. */
export interface DetailDetection {
  readonly id: string
  readonly timestamp: number
  readonly className: string
  readonly label?: string
  readonly confidence?: number
  readonly zones: readonly string[]
  readonly state?: string
  readonly trackId?: string
  /** Inference-frame id shared by every detection of the same scene/instant.
   *  The "frame-parent" grouping key (falls back to `timestamp` when absent). */
  readonly frameId?: string
  readonly mediaUrl?: string
  /** Pixel-space bbox in inference-frame coords (full projection only). */
  readonly bbox?: Bbox
  /** Inference-frame dimensions, to project `bbox` onto the displayed image. */
  readonly frameWidth?: number
  readonly frameHeight?: number
}

/** One inference frame (scene) = all detections that share the same frameId
 *  (or, for legacy rows without one, the same exact timestamp). */
export interface DetailFrame {
  readonly key: string
  /** The scene/parent key when present (else the timestamp string). */
  readonly frameId?: string
  readonly timestamp: number
  /** Detection whose media is shown for this frame (first with media). */
  readonly imageDetectionId?: string
  readonly imageMediaUrl?: string
  readonly detections: readonly DetailDetection[]
}

/** One tracked object across the cluster — the top level of the track→scene
 *  hierarchy. Aggregates every detection that shares a `trackId`. */
export interface TrackGroup {
  readonly trackId: string
  readonly className: string
  /** Enrichment label (identity name / plate text) if any detection carries one. */
  readonly label?: string
  /** Hero detection for the chip (highest confidence; ties → first with media). */
  readonly representative: DetailDetection
  /** Distinct scene-frames this track appears in (its "children frames"). */
  readonly frameCount: number
  readonly startMs: number
  readonly endMs: number
}

// ─── Grouping ─────────────────────────────────────────────────────────

/** The scene/parent key for a detection: its `frameId`, or the timestamp string
 *  for legacy rows written before frameId existed. */
export function frameKey(d: Pick<DetailDetection, 'frameId' | 'timestamp'>): string {
  return d.frameId ?? String(d.timestamp)
}

/**
 * Group detections into scene-frames. Detections from the same inference frame
 * share a `frameId` (or, for legacy rows, an exact `timestamp`). Frames are
 * returned newest→oldest; each frame's image is the first detection with a
 * `mediaUrl` (fast path) else the first detection (modal fetches by id).
 */
export function groupEventsByFrame(
  detections: readonly DetailDetection[],
): DetailFrame[] {
  const byKey = new Map<string, DetailDetection[]>()
  for (const d of detections) {
    const k = frameKey(d)
    const bucket = byKey.get(k)
    if (bucket) bucket.push(d)
    else byKey.set(k, [d])
  }

  // Newest-first by the group's timestamp.
  const keys = [...byKey.keys()].sort(
    (a, b) => (byKey.get(b)![0]!.timestamp) - (byKey.get(a)![0]!.timestamp),
  )
  return keys.map((k) => {
    const group = byKey.get(k) ?? []
    const withMedia = group.find((d) => Boolean(d.mediaUrl))
    const image = withMedia ?? group[0]
    return {
      key: k,
      frameId: group[0]?.frameId,
      timestamp: group[0]?.timestamp ?? 0,
      imageDetectionId: image?.id,
      imageMediaUrl: withMedia?.mediaUrl,
      detections: group,
    }
  })
}

/**
 * Group detections by `trackId` into the top-level track list (the "track" in
 * track→frame-parent→children). Detections without a trackId are ignored here
 * (they still appear in scene overlays/crops). Tracks are returned by recency
 * (most-recently-seen first).
 */
export function groupByTrack(detections: readonly DetailDetection[]): TrackGroup[] {
  const byTrack = new Map<string, DetailDetection[]>()
  for (const d of detections) {
    if (d.trackId === undefined) continue
    const bucket = byTrack.get(d.trackId)
    if (bucket) bucket.push(d)
    else byTrack.set(d.trackId, [d])
  }

  const groups: TrackGroup[] = []
  for (const [trackId, dets] of byTrack) {
    // Representative: highest confidence, ties broken by having a mediaUrl.
    let rep = dets[0]!
    for (const d of dets) {
      const dc = d.confidence ?? 0
      const rc = rep.confidence ?? 0
      if (dc > rc || (dc === rc && Boolean(d.mediaUrl) && !rep.mediaUrl)) rep = d
    }
    const label = dets.find((d) => d.label !== undefined)?.label
    const frameKeys = new Set(dets.map(frameKey))
    let startMs = Number.POSITIVE_INFINITY
    let endMs = Number.NEGATIVE_INFINITY
    for (const d of dets) {
      if (d.timestamp < startMs) startMs = d.timestamp
      if (d.timestamp > endMs) endMs = d.timestamp
    }
    groups.push({
      trackId,
      className: rep.className,
      ...(label !== undefined ? { label } : {}),
      representative: rep,
      frameCount: frameKeys.size,
      startMs,
      endMs,
    })
  }
  // Most-recently-seen first.
  return groups.sort((a, b) => b.endMs - a.endMs)
}

/**
 * The scene-frames in which a given track appears (its "children frames"). Each
 * returned frame still contains ALL co-present detections of that scene — so the
 * UI can overlay every box and show every object's crop, not just the track's.
 */
export function scenesForTrack(
  detections: readonly DetailDetection[],
  trackId: string,
): DetailFrame[] {
  const keysWithTrack = new Set(
    detections.filter((d) => d.trackId === trackId).map(frameKey),
  )
  return groupEventsByFrame(detections).filter((f) => keysWithTrack.has(f.key))
}

// ─── Parsing ──────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Parse one `projection:'full'` getObjectEvents row into a DetailDetection. */
export function toDetailDetection(row: unknown): DetailDetection | null {
  if (!isRecord(row)) return null
  if (typeof row.id !== 'string' || row.id.length === 0) return null
  if (typeof row.timestamp !== 'number') return null
  if (typeof row.className !== 'string' || row.className.length === 0) return null

  const zones = Array.isArray(row.zones)
    ? row.zones.filter((z): z is string => typeof z === 'string')
    : []

  return {
    id: row.id,
    timestamp: row.timestamp,
    className: row.className,
    label: typeof row.label === 'string' ? row.label : undefined,
    confidence: typeof row.confidence === 'number' ? row.confidence : undefined,
    zones,
    state: typeof row.state === 'string' ? row.state : undefined,
    trackId: typeof row.trackId === 'string' ? row.trackId : undefined,
    frameId: typeof row.frameId === 'string' ? row.frameId : undefined,
    mediaUrl: typeof row.mediaUrl === 'string' ? row.mediaUrl : undefined,
    bbox: parseBbox(row.bbox),
    frameWidth: typeof row.frameWidth === 'number' ? row.frameWidth : undefined,
    frameHeight: typeof row.frameHeight === 'number' ? row.frameHeight : undefined,
  }
}

/** Parse a server `{x,y,w,h}` bbox; null/malformed → undefined. */
function parseBbox(raw: unknown): Bbox | undefined {
  if (!isRecord(raw)) return undefined
  const { x, y, w, h } = raw
  if (typeof x !== 'number' || typeof y !== 'number' || typeof w !== 'number' || typeof h !== 'number') {
    return undefined
  }
  return { x, y, w, h }
}

// ─── Bounding-box geometry (pure; unit-tested) ──────────────────────────

/** A rectangle in screen px (relative to the frame-view container's top-left). */
export interface ScreenRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * The letterboxed rect a `frameW × frameH` image occupies when rendered
 * `contain` inside a `containerW × containerH` box (centered, aspect-preserved).
 * Degenerate inputs fall back to the full container.
 */
export function containRect(
  frameW: number,
  frameH: number,
  containerW: number,
  containerH: number,
): ScreenRect {
  if (frameW <= 0 || frameH <= 0 || containerW <= 0 || containerH <= 0) {
    return { left: 0, top: 0, width: Math.max(0, containerW), height: Math.max(0, containerH) }
  }
  const scale = Math.min(containerW / frameW, containerH / frameH)
  const width = frameW * scale
  const height = frameH * scale
  return { left: (containerW - width) / 2, top: (containerH - height) / 2, width, height }
}

/**
 * Project a pixel-space `bbox` (in `frameW × frameH` inference-frame coords) onto
 * the `contain`-rendered image rect. The bbox is scaled by the rendered image
 * size (not the container) and offset by the letterbox margins.
 */
export function bboxToScreen(
  bbox: Bbox,
  frameW: number,
  frameH: number,
  image: ScreenRect,
): ScreenRect {
  if (frameW <= 0 || frameH <= 0) return { left: image.left, top: image.top, width: 0, height: 0 }
  const sx = image.width / frameW
  const sy = image.height / frameH
  return {
    left: image.left + bbox.x * sx,
    top: image.top + bbox.y * sy,
    width: bbox.w * sx,
    height: bbox.h * sy,
  }
}

// ─── Summary ──────────────────────────────────────────────────────────

export interface ClusterSummary {
  readonly classes: readonly string[]
  readonly detectionCount: number
  readonly startMs: number
  readonly endMs: number
}

/** Distinct classes (first-seen order), total detections, and time span. */
export function summarizeCluster(frames: readonly DetailFrame[]): ClusterSummary {
  const classes: string[] = []
  let detectionCount = 0
  let startMs = Number.POSITIVE_INFINITY
  let endMs = Number.NEGATIVE_INFINITY

  for (const f of frames) {
    for (const d of f.detections) {
      detectionCount += 1
      if (!classes.includes(d.className)) classes.push(d.className)
      if (d.timestamp < startMs) startMs = d.timestamp
      if (d.timestamp > endMs) endMs = d.timestamp
    }
  }

  if (detectionCount === 0) return { classes: [], detectionCount: 0, startMs: 0, endMs: 0 }
  return { classes, detectionCount, startMs, endMs }
}
