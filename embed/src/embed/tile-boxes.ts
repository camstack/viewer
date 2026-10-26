/**
 * tile-boxes — pure helpers for the per-tile live bounding-box overlay.
 *
 * The overlay is fed by `detection.result` live events (the SAME
 * `EventCategory.DetectionResult` stream `use-active-devices` / the tile
 * highlight already consume): each event carries a `FrameResult` with the
 * source frame's `width`/`height` and `detections[].bbox` in ABSOLUTE PIXEL
 * coordinates. `normalizeFrameBoxes` converts them to 0..1 edges so the
 * overlay can position boxes with percentage offsets, independent of the
 * rendered tile size.
 *
 * Pure + unit-tested; the React glue lives in `components/TileBoxesOverlay`.
 */
import type { FrameResult } from '@camstack/types'
import { getPaletteView, paintKind, type PaletteView } from '../../../shared/palette'

/** One detection box, normalized 0..1 to the source frame (x1<=x2, y1<=y2). */
export interface TileBox {
  readonly label: string
  /** Confidence 0..1. */
  readonly score: number
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

/** Clear the overlay after this idle gap so boxes fade once detection stops
 *  (mirrors the viewer's camera-detail overlay). */
export const TILE_BOXES_FADE_MS = 2_500

/** Box/label color for a detection class, from the hub palette. */
export function tileBoxColor(label: string, view: PaletteView = getPaletteView()): string {
  return paintKind(view, label)
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * Normalize a frame's pixel-space detections to 0..1 boxes. Degenerate frames
 * (zero dimensions) and degenerate boxes (non-positive area after clamping)
 * are dropped — the overlay never renders an invisible or off-frame rect.
 */
export function normalizeFrameBoxes(frame: FrameResult): readonly TileBox[] {
  if (frame.width <= 0 || frame.height <= 0) return []
  const boxes: TileBox[] = []
  for (const det of frame.detections) {
    const { bbox } = det
    const x1 = clamp01(bbox.x / frame.width)
    const y1 = clamp01(bbox.y / frame.height)
    const x2 = clamp01((bbox.x + bbox.width) / frame.width)
    const y2 = clamp01((bbox.y + bbox.height) / frame.height)
    if (x2 <= x1 || y2 <= y1) continue
    boxes.push({ label: det.macroClass, score: det.score, x1, y1, x2, y2 })
  }
  return boxes
}
