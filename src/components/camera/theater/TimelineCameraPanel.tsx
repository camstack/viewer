/**
 * TimelineCameraPanel — the camera switcher, as a panel that TAKES OVER the
 * timeline body.
 *
 * Hosted with `scroll={false}`: the switcher scrolls its OWN list so the
 * "Open grid" action can stay docked at the bottom of the panel while the
 * camera rows scroll under it. As a `FloatingPanel` that structure was
 * impossible — the card scrolled as a whole, so the list carried a hard
 * `maxHeight: 360` to stop a long fleet from pushing the action out of reach.
 * A constant is a guess about a space you do not own; owning the body, the list
 * is simply what is left after the action.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'

import { TimelinePanelHost } from './TimelinePanelHost.js'
import { CameraSwitcherPanel } from '../CameraSwitcherPanel.js'
import type { CameraSelectionMode } from '../../../screens/camera-detail/camera-selection.js'

export interface TimelineCameraPanelProps {
  /** The camera currently open in the detail view (highlighted row). */
  readonly currentId: number
  /** Single tap on a row → switch the detail view to that camera. */
  readonly onSwitch: (deviceId: number) => void
  /** The confirmed selection, in list order — the screen decides what it means. */
  readonly onOpenGrid: (deviceIds: readonly number[]) => void
  /** What confirming means on this surface (`camera-selection.ts`). */
  readonly selectionMode?: CameraSelectionMode
  /** Grid timeline: checkboxes are the data scope (pre-selected, user can drop). */
  readonly onClose: () => void
}

export function TimelineCameraPanel({
  currentId,
  onSwitch,
  onOpenGrid,
  selectionMode,
  onClose,
}: TimelineCameraPanelProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <TimelinePanelHost title={t('v2.cameraSwitcher.title')} onClose={onClose} scroll={false}>
      <CameraSwitcherPanel
        currentId={currentId}
        onSwitch={onSwitch}
        onOpenGrid={onOpenGrid}
        selectionMode={selectionMode}
      />
    </TimelinePanelHost>
  )
}
