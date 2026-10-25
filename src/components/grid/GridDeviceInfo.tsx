/**
 * GridDeviceInfo — the device-information pill for a WHOLE grid wall, whichever
 * renderer draws the wall. It reads the global setting itself so the three
 * wall hosts (`GridWall` on Android, `GridLiveEmbed` on iOS and `.web` on the
 * PWA) mount one identical element and cannot disagree.
 *
 * The 1.0.596 pill was mounted only inside `GridWall`. iOS and web draw the
 * grid in ONE WebView/iframe (`GridLiveEmbed`), which never mounted it — so on
 * those platforms the setting did nothing on the grid.
 */
import React from 'react'
import { DeviceInfoOverlay } from '../camera/DeviceInfoOverlay.js'
import { OverlayFrame } from '../camera/overlay/OverlayFrame.js'
import { useSettingsStore } from '../../store/settings-store.js'

/** A wall is far wider than any one picture is read at; the pill grows with the
 *  overlay size but not past this multiplier. */
const WALL_MAX_SCALE = 1.4

export function GridDeviceInfo(): React.JSX.Element | null {
  const position = useSettingsStore((s) => s.settings.deviceInfo)
  if (position === 'off') return null
  return (
    <OverlayFrame fit="cover" maxScale={WALL_MAX_SCALE}>
      <DeviceInfoOverlay position={position} />
    </OverlayFrame>
  )
}
