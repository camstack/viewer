/**
 * use-timeline-panels — which panel owns the timeline body, and how each one is
 * opened.
 *
 * ## Why this is a hook and not twelve lines in `TheaterTimeline`
 *
 * The union grew from five members to twelve on 2026-08-01, when PTZ, the
 * linked devices, the camera switcher, the quality picker, the view-options
 * menu and the two management surfaces stopped floating over the camera screen
 * and became panels of this body. Each arrival brought an opener, and the
 * openers are the part that must stay boring: `setPanel` written inline twelve
 * times is twelve chances to open one panel while a stale flag says another is
 * showing — the exact failure mode the single union exists to make impossible.
 *
 * So every write to the state lives here, and the timeline reads back named
 * intentions. The one payload-carrying member (`clusterDetail`) gets its own
 * opener because the payload is the reason it exists: a detail panel cannot be
 * opened without a cluster.
 *
 * The union lost four members on 2026-09-02 — see `timeline-layout.ts`. With
 * them went `openExport`/`exportAnchorMs`, whose whole job was freezing an
 * export range against the ticking live edge.
 */
import { useCallback, useMemo, useState } from 'react'

import type { PositionedCluster } from './event-cluster.js'
import {
  resolveTimelineBody,
  type TimelineBody,
  type TimelinePanel,
  type TimelinePanelKind,
} from './timeline-layout.js'

/** The panels a button can toggle: everything that needs no payload to open. */
export type TogglablePanelKind = Exclude<TimelinePanelKind, 'clusterDetail' | 'export'>

export interface TimelinePanelController {
  /** The open panel, or null when the timeline itself owns the body. */
  readonly panel: TimelinePanel | null
  /** What the box under the toolbar renders — the timeline, or that panel. */
  readonly body: TimelineBody
  /** Hand the body back to the timeline. */
  readonly close: () => void
  /** Flip a payload-free panel: tapping its own chip again closes it. */
  readonly toggle: (kind: TogglablePanelKind) => void
  /** Replace whatever is open with a payload-free panel (no toggle-back). */
  readonly open: (kind: TogglablePanelKind) => void
  /** Open the cluster detail ON a cluster — the payload IS the panel. */
  readonly openCluster: (cluster: PositionedCluster) => void
}

export function useTimelinePanels(): TimelinePanelController {
  const [panel, setPanel] = useState<TimelinePanel | null>(null)

  const close = useCallback(() => setPanel(null), [])

  const toggle = useCallback(
    (kind: TogglablePanelKind) => setPanel((open) => (open?.kind === kind ? null : { kind })),
    [],
  )

  // Not a toggle: the management panels are reached FROM the view-options
  // panel, so they replace it. Toggling would mean tapping "Storage" inside the
  // menu and getting the menu back.
  const open = useCallback((kind: TogglablePanelKind) => setPanel({ kind }), [])

  const openCluster = useCallback(
    (cluster: PositionedCluster) => setPanel({ kind: 'clusterDetail', cluster }),
    [],
  )

  const body = resolveTimelineBody(panel)

  return useMemo(
    () => ({ panel, body, close, toggle, open, openCluster }),
    [panel, body, close, toggle, open, openCluster],
  )
}
