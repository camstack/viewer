/**
 * The camera's accessory panel — linked devices, the local edit mode and the
 * function switches (D62) — as a panel of the TIMELINE BODY.
 *
 * A thin host around the shared `CameraAccessoryPanel`, which is also mounted
 * by the cameras-list sheet and the wall's cell overlay — the body is one
 * composition, the host is per-surface. It exists as its own component
 * because every routed panel wears the shared host itself, which is what
 * keeps a panel from quietly becoming a window.
 */
import React from 'react'
import { TimelinePanelHost } from './TimelinePanelHost.js'
import { CameraAccessoryPanel } from '../accessory-panel/CameraAccessoryPanel.js'

interface TimelineLinkedDevicesPanelProps {
  readonly deviceId: number
  readonly cameraName: string
  readonly onClose: () => void
}

export function TimelineLinkedDevicesPanel({
  deviceId,
  cameraName,
  onClose,
}: TimelineLinkedDevicesPanelProps): React.JSX.Element {
  return (
    <TimelinePanelHost title={cameraName} onClose={onClose}>
      <CameraAccessoryPanel deviceId={deviceId} cameraName={cameraName} />
    </TimelinePanelHost>
  )
}
