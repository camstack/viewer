/**
 * tile-overlays — the PER-CAMERA indicators a hosted grid tile draws, and the
 * pure parsing/placement behind them.
 *
 * ## Why the embed has these at all
 *
 * The wall's per-cell menu is the app's own `CameraViewOptionsSurface`, hosted
 * natively over the WebView. It offers each camera its motion regions, its
 * motion badge, its audio meter, its occupancy chips and its stream stats — and
 * a menu may only offer what something DRAWS. On iOS/web the thing that draws a
 * tile is this bundle, so the tiles paint them here. (The first attempt hid the
 * rows in the grid instead, and the operator lost the indicators from the wall.)
 *
 * The config travels per DEVICE — `GridConfig.overlays[deviceId]`, pushed at
 * runtime by `setOverlays`. Until now the only per-tile thing the protocol
 * carried was the grid-wide highlight; this is the per-device channel the
 * highlight map was always going to need.
 *
 * Everything here is pure: parsing, placement and the level mapping. The
 * components in `components/TileIndicators.tsx` are the thin React half.
 * Mirrors the viewer's `overlay-position` / `audio-level` / `use-motion` /
 * `occupancy` modules — the embed is a separate bundle and cannot import them.
 */
import type { CSSProperties } from 'react'

/** The eight anchors, mirroring the viewer's `OVERLAY_ANCHORS`. */
export const OVERLAY_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'left-center',
  'right-center',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const

export type OverlayAnchor = (typeof OVERLAY_ANCHORS)[number]
/** An anchor, or hidden — `off` IS the switch (one field, never a boolean plus
 *  an anchor that could disagree). */
export type OverlayPosition = OverlayAnchor | 'off'

export function isOverlayAnchor(v: unknown): v is OverlayAnchor {
  return typeof v === 'string' && (OVERLAY_ANCHORS as readonly string[]).includes(v)
}

/**
 * Absolute placement per anchor, as inline CSS. A corner pins its two edges; an
 * EDGE-MIDPOINT pins both opposing edges and centres between them.
 *
 * Spelled out per anchor rather than derived by splitting the name: the
 * vocabulary is not uniform — `top-left` reads vertical-horizontal while
 * `left-center` reads horizontal-vertical — so a split puts `left` in the
 * vertical slot and pins the side-centre anchors to the wrong edges. (Caught by
 * the first run of `__tests__/tile-overlays.spec.ts`.)
 */
const ANCHOR_STYLE: Readonly<Record<OverlayAnchor, CSSProperties>> = {
  'top-left': { top: 8, left: 8 },
  'top-center': { top: 8, left: 0, right: 0, justifyContent: 'center' },
  'top-right': { top: 8, right: 8 },
  'left-center': { left: 8, top: 0, bottom: 0, alignItems: 'center' },
  'right-center': { right: 8, top: 0, bottom: 0, alignItems: 'center' },
  'bottom-left': { bottom: 8, left: 8 },
  'bottom-center': { bottom: 8, left: 0, right: 0, justifyContent: 'center' },
  'bottom-right': { bottom: 8, right: 8 },
}

export function anchorStyle(anchor: OverlayAnchor): CSSProperties {
  return { position: 'absolute', display: 'flex', ...ANCHOR_STYLE[anchor] }
}

// ── Audio level ──────────────────────────────────────────────────────────────

/** Upper dBFS bound of each of the six segments — the viewer's ladder. */
export const AUDIO_LEVEL_THRESHOLDS_DBFS: readonly number[] = [-60, -53, -46, -39, -32, -24]
export const AUDIO_LEVEL_STEPS = AUDIO_LEVEL_THRESHOLDS_DBFS.length

/** Colour per rung, quiet → loud. Mirrors the viewer's `AUDIO_LEVEL_COLORS`. */
export const AUDIO_LEVEL_COLORS: readonly string[] = [
  '#22c55e',
  '#84cc16',
  '#eab308',
  '#f59e0b',
  '#f97316',
  '#ef4444',
]

export function audioLevelColor(logicalIndex: number): string {
  const i = Math.min(Math.max(0, logicalIndex), AUDIO_LEVEL_COLORS.length - 1)
  return AUDIO_LEVEL_COLORS[i] ?? AUDIO_LEVEL_COLORS[0]!
}

/** How many segments are lit for a reading. `null` (no reading yet) = none. */
export function dbfsToLevel(dbfs: number | null): number {
  if (dbfs === null || !Number.isFinite(dbfs)) return 0
  let level = 0
  for (const threshold of AUDIO_LEVEL_THRESHOLDS_DBFS) {
    if (dbfs >= threshold) level += 1
  }
  return level
}

/**
 * How the meter lays itself out at a given anchor — THE SAME rule as the
 * viewer's `audio-level.meterOrientation`. A second, always-compact pill is
 * how the wall VU looked different from the single player.
 */
export type AudioMeterOrientation = 'horizontal' | 'vertical' | 'compact'

export function meterOrientation(position: OverlayPosition): AudioMeterOrientation | null {
  if (position === 'off') return null
  const tokens = position.split('-')
  const vertical = tokens.includes('top') ? 'top' : tokens.includes('bottom') ? 'bottom' : 'center'
  const horizontal = tokens.includes('left') ? 'left' : tokens.includes('right') ? 'right' : 'center'
  if (vertical !== 'center' && horizontal !== 'center') return 'compact'
  if (horizontal === 'center') return 'horizontal'
  return 'vertical'
}

/** Increasing bar heights (px) for the compact corner pill — viewer's ladder. */
export const AUDIO_METER_COMPACT_HEIGHTS: readonly number[] = [8, 11, 14, 17, 21, 26]

export const AUDIO_METER_STRIP = {
  horizontal: { width: 8, height: 16 },
  vertical: { width: 24, height: 7 },
  compactWidth: 4,
} as const

export function meterSegmentSize(
  orientation: AudioMeterOrientation,
  logicalIndex: number,
): { readonly width: number; readonly height: number } {
  if (orientation === 'vertical') return AUDIO_METER_STRIP.vertical
  if (orientation === 'horizontal') return AUDIO_METER_STRIP.horizontal
  const height = AUDIO_METER_COMPACT_HEIGHTS[logicalIndex] ?? AUDIO_METER_COMPACT_HEIGHTS[0]!
  return { width: AUDIO_METER_STRIP.compactWidth, height }
}

export function meterRenderOrder(orientation: AudioMeterOrientation): readonly number[] {
  const forward = Array.from({ length: AUDIO_LEVEL_STEPS }, (_, i) => i)
  return orientation === 'vertical' ? [...forward].reverse() : forward
}

// ── Motion regions ───────────────────────────────────────────────────────────

/** One moving area, NORMALISED 0..1 (the wire carries analysis-frame PIXELS). */
export interface TileMotionRegion {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** Changed pixels — drives the fill opacity ramp. */
  readonly pixelCount: number
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * Narrow a `detection.motion-analysis` payload into normalised regions.
 *
 * The analysis event, NOT `motion.on-motion-changed`: the latter fires only on
 * transitions, so an overlay fed from it freezes on the geometry of the instant
 * motion began. This one fires per analysed frame and carries the frame
 * dimensions the pixel bboxes need — without them there is nothing to divide by
 * and every region lands in the top-left corner.
 */
export function parseMotionRegions(payload: unknown): readonly TileMotionRegion[] {
  if (!isRecord(payload)) return []
  if (payload.detected !== true) return []
  const frameW = typeof payload.frameWidth === 'number' ? payload.frameWidth : 0
  const frameH = typeof payload.frameHeight === 'number' ? payload.frameHeight : 0
  if (frameW <= 0 || frameH <= 0) return []
  const raw = payload.regions
  if (!Array.isArray(raw)) return []
  const out: TileMotionRegion[] = []
  for (const r of raw) {
    if (!isRecord(r) || !isRecord(r.bbox)) continue
    const { x, y, w, h } = r.bbox
    if (typeof x !== 'number' || typeof y !== 'number') continue
    if (typeof w !== 'number' || typeof h !== 'number' || !(w > 0) || !(h > 0)) continue
    out.push({
      x: x / frameW,
      y: y / frameH,
      w: w / frameW,
      h: h / frameH,
      pixelCount: typeof r.pixelCount === 'number' ? r.pixelCount : 0,
    })
  }
  return out
}

/** Fill opacity for a region, ramped by changed-pixel count and clamped — the
 *  region is context, never the subject. */
export function regionAlpha(pixelCount: number): number {
  if (!Number.isFinite(pixelCount) || pixelCount <= 0) return 0.08
  return Math.min(0.28, 0.08 + (pixelCount / 4000) * 0.28)
}

// ── Occupancy ────────────────────────────────────────────────────────────────

/** One class row of the occupancy strip. */
export interface TileOccupancyCount {
  readonly className: string
  readonly count: number
}

/**
 * Per-class counts from a raw `zoneAnalytics.getCurrentSnapshot` or an
 * `occupancy-changed` event payload (`{ byClass }` at the top level), highest
 * first (ties → class name). Tolerant: an absent cap, a camera the pipeline has
 * not framed yet and a malformed payload all mean "nothing to draw", which is
 * the same empty strip.
 */
export function parseOccupancyCounts(raw: unknown): readonly TileOccupancyCount[] {
  if (!isRecord(raw)) return []
  const nested = isRecord(raw.frame) ? raw.frame.byClass : undefined
  const byClass = isRecord(nested) ? nested : raw.byClass
  if (!isRecord(byClass)) return []
  const out: TileOccupancyCount[] = []
  for (const [className, value] of Object.entries(byClass)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
    out.push({ className, count: Math.round(value) })
  }
  return out.sort((a, b) => b.count - a.count || a.className.localeCompare(b.className))
}

// ── Stats ────────────────────────────────────────────────────────────────────

/** What a tile can report about its stream WITHOUT the peer connection.
 *
 *  The embed's `RTCPeerConnection` lives inside `CameraStreamPlayer` and is not
 *  exposed, exactly as the native WebView player's is not — so this is the
 *  `source: 'playback'` half of the app's stats: what `HTMLVideoElement`
 *  knows. It is the same read-out the single-camera view falls back to on the
 *  WebView player, and it answers the question a wall is scanned for ("is this
 *  tile actually decoding?"). */
export interface TilePlaybackStats {
  readonly resolution: string
  readonly fps: number
  readonly dropped: number
}

/** Frames-per-second between two playback-quality samples. Pure so the ratio
 *  (and its division-by-zero) is tested without a video element. */
export function framesPerSecond(
  previousFrames: number,
  currentFrames: number,
  elapsedMs: number,
): number {
  if (elapsedMs <= 0) return 0
  const delta = currentFrames - previousFrames
  if (delta <= 0) return 0
  return Math.round((delta * 1000) / elapsedMs)
}

/** The one-line form the tile draws: `1920x1080 · 15fps · 3 dropped`. */
export function statsLine(stats: TilePlaybackStats | null): string {
  if (stats === null) return '—'
  const parts = [stats.resolution, `${stats.fps}fps`]
  if (stats.dropped > 0) parts.push(`${stats.dropped} dropped`)
  return parts.join(' · ')
}
