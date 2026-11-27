/**
 * ConfiguredZonesOverlay — the camera's configured zones (outline + name) over
 * the picture, when the Zones overlay is switched on (planning#749).
 *
 * Reads `zones.listZones({ deviceId })` through `useCameraZoneOutlines` and
 * draws each zone with the shared `ZoneShapeView`, in the same un-transformed
 * video box `ZoneActiveOverlay` uses. Info-coloured so it reads apart from the
 * amber timeline filter. Non-interactive; draws nothing until the list answers.
 */
import React, { memo, useCallback, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'

import { useTheme } from '../../theme/theme-provider.js'
import { useCameraZoneOutlines } from '../../data/use-zones.js'
import { ZoneShapeView } from './ZoneShapeView.js'

export interface ConfiguredZonesOverlayProps {
  readonly deviceId: number
}

export const ConfiguredZonesOverlay = memo(function ConfiguredZonesOverlay({
  deviceId,
}: ConfiguredZonesOverlayProps) {
  const { colors } = useTheme()
  const { data } = useCameraZoneOutlines(deviceId, true)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setBox({ width, height })
  }, [])
  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {(data ?? []).map((zone) => (
        <ZoneShapeView
          key={zone.id}
          shape={{ kind: 'polygon', points: zone.points }}
          box={box}
          color={colors.info}
          label={zone.name}
        />
      ))}
    </View>
  )
})
