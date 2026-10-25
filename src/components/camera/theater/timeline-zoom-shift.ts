/**
 * timeline-zoom-shift — the MOTION when the timeline's visible RANGE changes.
 *
 * Auto (and a manual menu pick) change `zoomIndex`, which changes `pxPerHour`
 * and therefore every card/tick Y. Layout commits to the new geometry in one
 * frame — same philosophy as `timeline-cursor-shift.ts`. A `scaleY` transform
 * then eases from `oldPxPerHour / newPxPerHour` → `1`, origin at the playhead,
 * so the column visibly grows (zoom in) or shrinks (zoom out) instead of
 * jumping.
 *
 * Pure: no React / no react-native. The host owns the shared value.
 */

/** Same duration family as the cursor shift — readable, not sluggish. */
export const ZOOM_SHIFT_MS = 220

/** Cubic ease-out — same curve the cursor shift proved. */
export function zoomShiftEase(progress: number): number {
  'worklet'
  if (!Number.isFinite(progress)) return 1
  const t = Math.min(1, Math.max(0, progress))
  return 1 - (1 - t) ** 3
}

/**
 * Starting scaleY so the OLD geometry's apparent height matches what the eye
 * just saw, before easing to 1 on the NEW layout.
 *
 * Zoom IN (tighter): newPxPerHour > old → start < 1 → grow.
 * Zoom OUT (wider): newPxPerHour < old → start > 1 → shrink.
 */
export function zoomShiftScaleStart(fromPxPerHour: number, toPxPerHour: number): number {
  if (!(fromPxPerHour > 0) || !(toPxPerHour > 0)) return 1
  const ratio = fromPxPerHour / toPxPerHour
  if (!Number.isFinite(ratio) || ratio <= 0) return 1
  // Clamp runaway ratios (e.g. 12h ↔ 15m ≈ 48×) so one frame cannot explode.
  return Math.min(4, Math.max(0.25, ratio))
}

/** Skip the animation when the scale would be invisible. */
export function shouldAnimateZoomShift(fromPxPerHour: number, toPxPerHour: number): boolean {
  if (!(fromPxPerHour > 0) || !(toPxPerHour > 0)) return false
  if (fromPxPerHour === toPxPerHour) return false
  const start = zoomShiftScaleStart(fromPxPerHour, toPxPerHour)
  return Math.abs(start - 1) >= 0.04
}
