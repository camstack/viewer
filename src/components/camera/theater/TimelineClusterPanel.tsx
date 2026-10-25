/**
 * TimelineClusterPanel — the cluster detail, as a panel that TAKES OVER the
 * timeline body.
 *
 * It replaces `ClusterDetailModal`, a slide-up `Modal` that presented the same
 * `ClusterDetailBody`. The modal is the same defect as the floats this layout
 * retired, in a different costume: a portrait-shaped presentation negotiating
 * for a space it does not own, so it read wrong the moment the window was short
 * and wide. Owning the body it is simply as tall and as wide as the column is —
 * in the landscape drawer, in portrait, and on the wide rail.
 *
 * Two things the modal needed and this does not:
 *
 *  - a `GestureHandlerRootView`. A RN `<Modal>` is a detached native window with
 *    no gesture root, so the zoomable detail image's `GestureDetector` crashed
 *    on pinch under the New Architecture and the modal had to re-root gestures
 *    itself. In the normal tree the app's root already covers it.
 *  - a safe-area `paddingTop`. The panel sits under the timeline toolbar, which
 *    is already inside the insets.
 *
 * `ClusterDetailBody`'s own close button is left OFF: the host header owns the
 * way back, and two X buttons on one surface is worse than none.
 */
import React, { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { TimelinePanelHost } from './TimelinePanelHost.js'
import { ClusterDetailBody } from './detail/ClusterDetailBody.js'
import type { PositionedCluster } from './event-cluster.js'

export interface TimelineClusterPanelProps {
  readonly deviceId: number
  readonly cluster: PositionedCluster
  readonly onSeek: (epochMs: number) => void
  /** Hide the "go to this moment" action when the caller KNOWS (zero-cost)
   *  there is no recording at the cluster's moment. */
  readonly seekAvailable: boolean
  readonly onClose: () => void
}

export const TimelineClusterPanel = memo(function TimelineClusterPanel({
  deviceId,
  cluster,
  onSeek,
  seekAvailable,
  onClose,
}: TimelineClusterPanelProps) {
  const { t } = useTranslation()

  // The cluster's own title: the moment it represents, and how many subjects it
  // holds — the two things that identify it in a list of otherwise similar
  // panels. `carouselEvents` is one item per distinct subject (tracker
  // fragments already collapsed), which is what the body pages over.
  const clock = new Date(cluster.representative.timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const subjects =
    cluster.carouselEvents.length > 0 ? cluster.carouselEvents.length : cluster.events.length
  const title = subjects > 1 ? `${clock} · ${t('v2.theater.detailSubjects', { count: subjects })}` : clock

  return (
    <TimelinePanelHost title={title} onClose={onClose} scroll={false}>
      <ClusterDetailBody
        deviceId={deviceId}
        cluster={cluster}
        onSeek={onSeek}
        seekAvailable={seekAvailable}
        bottomInset={0}
      />
    </TimelinePanelHost>
  )
})
