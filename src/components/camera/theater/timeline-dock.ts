/**
 * timeline-dock — where the single-camera timeline sits when the stream is FULL
 * SCREEN in landscape. Three states, one button that cycles them:
 *
 *   off      no timeline
 *   overlay  the timeline drawn OVER the stream, on its right edge (the drawer)
 *   side     the stream SHRINKS and the timeline sits BESIDE it, covering nothing
 *
 * Pure, so the cycle and the geometry are asserted by value. The last state is
 * remembered per device (`stream.landscapeTimeline`, a device-level setting).
 */
import { drawerWidth } from './landscape-drawer-geometry.js'

export type TimelineDock = 'off' | 'overlay' | 'side'

export const TIMELINE_DOCKS: readonly TimelineDock[] = ['off', 'overlay', 'side']

export const DEFAULT_TIMELINE_DOCK: TimelineDock = 'off'

export function isTimelineDock(raw: unknown): raw is TimelineDock {
  return typeof raw === 'string' && (TIMELINE_DOCKS as readonly string[]).includes(raw)
}

/** off → overlay → side → off. */
export function nextTimelineDock(dock: TimelineDock): TimelineDock {
  switch (dock) {
    case 'off':
      return 'overlay'
    case 'overlay':
      return 'side'
    case 'side':
      return 'off'
  }
}

/** Is a timeline on screen at all. */
export function timelineShown(dock: TimelineDock): boolean {
  return dock !== 'off'
}

/**
 * The width the timeline column takes in `side` — the drawer's own width
 * (34% of the window, 240–340 pt), so the two placements show the same panel.
 */
export function sideTimelineWidth(windowWidth: number): number {
  return drawerWidth(windowWidth)
}

/** The width the stream box gets: the window, less the column in `side`. */
export function streamWidthFor(windowWidth: number, dock: TimelineDock): number {
  return dock === 'side' ? windowWidth - sideTimelineWidth(windowWidth) : windowWidth
}

/**
 * The i18n key naming the state AND what a press does next — the accessible
 * label of the button, one per state.
 */
export function timelineDockLabelKey(dock: TimelineDock): string {
  return `v2.timeline.dock.${dock}`
}
