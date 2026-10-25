/**
 * The camera's CONTROLS, as a panel of the TIMELINE BODY: the PTZ pad where
 * the camera has a gimbal, the drive pad where it has `navigation` (a robot
 * camera) — two separate capabilities in one panel behind one icon, never one
 * projected as the other (operator, 2026-09-06).
 *
 * Same shape and same reason as {@link TimelineLinkedDevicesPanel}: the pads
 * themselves are shared with the controls sheet, the host is per-surface.
 */
import React from 'react'
import { TimelinePanelHost } from './TimelinePanelHost.js'
import { NavigationControls } from '../NavigationControls.js'
import { PtzControls } from '../PtzControls.js'

interface TimelinePtzPanelProps {
  readonly deviceId: number
  readonly cameraName: string
  readonly hasPtz: boolean
  readonly hasNavigation: boolean
  readonly onClose: () => void
}

export function TimelinePtzPanel({
  deviceId,
  cameraName,
  hasPtz,
  hasNavigation,
  onClose,
}: TimelinePtzPanelProps): React.JSX.Element {
  return (
    <TimelinePanelHost title={cameraName} onClose={onClose}>
      {hasPtz ? <PtzControls deviceId={deviceId} hasFeature /> : null}
      {hasNavigation ? <NavigationControls deviceId={deviceId} hasCap /> : null}
    </TimelinePanelHost>
  )
}
