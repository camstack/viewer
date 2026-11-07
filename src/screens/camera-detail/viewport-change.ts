/**
 * When a change of the window is a real change of the picture's box.
 *
 * The zoom was dropped instantly on ANY change of `[winWidth, winHeight]`, and
 * those numbers come from the safe-area frame: a system bar, the home
 * indicator or a status-bar toggle moves them by tens of points without the
 * picture's box meaning anything different. Each such jitter threw away the
 * operator's zoom ("snaps back by itself").
 *
 * A change counts when the window flipped orientation, or when either side
 * moved by at least `VIEWPORT_CHANGE_MIN_PT` after rounding. Below that the
 * clamp, which reads the live box on every gesture, absorbs the difference.
 */
export const VIEWPORT_CHANGE_MIN_PT = 64

export interface WindowSize {
  readonly width: number
  readonly height: number
}

export type ViewportChange = 'none' | 'orientation' | 'resize'

export function classifyViewportChange(prev: WindowSize, next: WindowSize): ViewportChange {
  const pw = Math.round(prev.width)
  const ph = Math.round(prev.height)
  const nw = Math.round(next.width)
  const nh = Math.round(next.height)
  if (pw > ph !== nw > nh) return 'orientation'
  if (Math.max(Math.abs(nw - pw), Math.abs(nh - ph)) >= VIEWPORT_CHANGE_MIN_PT) return 'resize'
  return 'none'
}
