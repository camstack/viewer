/**
 * timeline-zoom-step — the `−` / `+` of the floating range control.
 *
 * Steps through the SAME presets the range menu lists (`zoomIndicesByRange`,
 * shortest span first), never a second ladder. `−` moves to the next SHORTER
 * range, `+` to the next LONGER one; both clamp at the ends (null = nothing to
 * step to, so the caller can disable the button instead of ignoring a press).
 */
import { zoomIndicesByRange } from './mock-data.js'

export type ZoomStepDirection = 'shorter' | 'longer'

export function stepZoomIndex(current: number, direction: ZoomStepDirection): number | null {
  const ladder = zoomIndicesByRange()
  const at = ladder.indexOf(current)
  if (at < 0) return null
  const next = ladder[direction === 'shorter' ? at - 1 : at + 1]
  return next ?? null
}
