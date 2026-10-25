/**
 * TimelineViewOptionsPanel — the "view options" menu (the toolbar's ≡ button)
 * as a panel that TAKES OVER the timeline body.
 *
 * Formerly `CameraMenuPanel`, a `FloatingPanel`. It is the float that made the
 * strongest case for retiring the shape: the menu kept GROWING — overlay
 * toggles, an audio-meter placement select, timeline density, the highlight
 * trigger editor, two management entries — while the card it lived in was
 * bounded by `windowHeight − topOffset − insets.bottom`, an arithmetic ceiling
 * derived from the animated video-box height. On a short window the menu was a
 * 160pt scroller (the panel's own floor) floating over the timeline. Owning the
 * body it is as tall as the column is, everywhere.
 *
 * ## All that is left here is the HOST
 *
 * The menu's content moved to `CameraViewOptionsSurface` on 2026-08-13, when a
 * grid cell became its second host. This file is now the theater's frame around
 * that surface, and the grid's card is the other — one menu, two hosts, so a
 * section added to the surface appears in both without a second edit.
 *
 * Presentational: every toggle's state + handler is owned by the screen and
 * arrives through the timeline's view-options binding.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'

import { TimelinePanelHost } from './TimelinePanelHost.js'
import { CameraViewOptionsSurface } from '../CameraViewOptionsSurface.js'
import type { CameraOverlayConfig } from '../overlay/overlay-config.js'
import type { GridHighlightSettings } from '../../../store/grid-store.js'

export interface TimelineViewOptionsPanelProps {
  /** The camera this panel is configuring — the switch group's target. */
  readonly deviceId: number
  /** The per-camera overlay document + its writer. */
  readonly overlayConfig: CameraOverlayConfig
  readonly onChangeOverlay: (next: CameraOverlayConfig) => void
  /** Per-camera highlight settings + patcher. */
  readonly highlight: GridHighlightSettings
  readonly onSetHighlight: (patch: Partial<GridHighlightSettings>) => void
  /** Hand the body to the recordings-storage panel. */
  readonly onOpenStorage: () => void
  /** Hand the body to the event-store panel. */
  readonly onOpenEventStore: () => void
  /** Hand the body to the timeline legend panel. */
  readonly onOpenLegend: () => void
  readonly onClose: () => void
}

export function TimelineViewOptionsPanel({
  deviceId,
  overlayConfig,
  onChangeOverlay,
  highlight,
  onSetHighlight,
  onOpenStorage,
  onOpenEventStore,
  onOpenLegend,
  onClose,
}: TimelineViewOptionsPanelProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <TimelinePanelHost title={t('v2.cameraMenu.title')} onClose={onClose}>
      <CameraViewOptionsSurface
        deviceId={deviceId}
        // The single-camera player: this menu is the ONLY one, so it is complete.
        context="single"
        overlayConfig={overlayConfig}
        onChangeOverlay={onChangeOverlay}
        highlight={highlight}
        onSetHighlight={onSetHighlight}
        // The theater HAS sibling panels for these, so it routes them.
        onOpenStorage={onOpenStorage}
        onOpenEventStore={onOpenEventStore}
        onOpenLegend={onOpenLegend}
      />
    </TimelinePanelHost>
  )
}
