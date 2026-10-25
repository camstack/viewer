/**
 * DeviceInfoOverlay — the device RUNNING the viewer, pinned to a corner of the
 * player (or the whole grid wall): local time, battery (level + charging) and
 * internet link (wifi / cellular / offline, strength where the platform exposes
 * it). Same placement vocabulary as the audio meter (`OverlayPosition` +
 * `ANCHOR_PLACEMENT`). A field the platform cannot answer (no battery on a
 * desktop browser) is left out; the pill never claims a value it does not have.
 */
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import {
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  Clock,
  SignalHigh,
  Wifi,
  WifiOff,
} from '../../lib/icons.js'
import { useHostBattery } from '../../data/use-host-battery.js'
import { useHostClock } from '../../data/use-host-clock.js'
import { useHostNetwork } from '../../data/use-host-network.js'
import { networkLabel, type HostNetworkStatus } from '../../data/host-network.js'
import { useTheme } from '../../theme/theme-provider.js'
import { TABULAR, SPACING, RADIUS } from '../../theme/tokens.js'
import { ANCHOR_PLACEMENT, type OverlayPosition } from './overlay/overlay-position.js'
import { LOW_BATTERY_PCT } from './BatteryBadge.js'
import { useScaledPx, useStyleScaler } from './overlay/OverlayFrame.js'

/** Below this wifi quality the link reads as weak (warning colour). */
const WEAK_WIFI_PCT = 35

export interface DeviceInfoOverlayProps {
  readonly position: OverlayPosition
}

/** The glyph size every row of the pill is drawn at, before the overlay size. */
const GLYPH_PX = 14

interface NetworkGlyphProps {
  readonly status: HostNetworkStatus
  readonly color: string
  readonly size: number
}

function NetworkGlyph({ status, color, size }: NetworkGlyphProps): React.JSX.Element {
  if (status.kind === 'offline') return <WifiOff size={size} color={color} />
  if (status.kind === 'cellular') return <SignalHigh size={size} color={color} />
  return <Wifi size={size} color={color} />
}

export function DeviceInfoOverlay({ position }: DeviceInfoOverlayProps): React.JSX.Element | null {
  const battery = useHostBattery()
  const network = useHostNetwork()
  const clock = useHostClock()
  const { colors } = useTheme()
  const sx = useStyleScaler()
  const px = useScaledPx()
  if (position === 'off') return null
  const glyph = px(GLYPH_PX)

  const muted = colors.foregroundMuted
  const batteryLow = battery !== null && battery.percentage <= LOW_BATTERY_PCT
  const batteryColor = battery?.charging === true ? colors.info : batteryLow ? colors.danger : muted
  const BatteryIcon = battery?.charging === true ? BatteryCharging : batteryLow ? BatteryLow : BatteryFull

  const netColor =
    network === null
      ? muted
      : network.kind === 'offline'
        ? colors.danger
        : network.strengthPct !== null && network.strengthPct < WEAK_WIFI_PCT
          ? colors.warning
          : muted
  const netText = network === null ? null : networkLabel(network)

  return (
    <View
      pointerEvents="none"
      style={[styles.layer, ANCHOR_PLACEMENT[position] as object]}
      testID="device-info-overlay"
    >
      <View style={[sx(styles.pill), { backgroundColor: colors.surface }]}>
        <View style={sx(styles.item)} testID="device-info-clock">
          <Clock size={glyph} color={muted} />
          <Text style={[sx(styles.text), { color: muted }, TABULAR]}>{clock}</Text>
        </View>
        {battery !== null ? (
          <View style={sx(styles.item)} testID="device-info-battery">
            <BatteryIcon size={glyph} color={batteryColor} />
            <Text style={[sx(styles.text), { color: batteryColor }, TABULAR]}>
              {`${String(battery.percentage)}%`}
            </Text>
          </View>
        ) : null}
        {network !== null ? (
          <View style={sx(styles.item)} testID="device-info-network">
            <NetworkGlyph status={network} color={netColor} size={glyph} />
            {netText !== null ? (
              <Text style={[sx(styles.text), { color: netColor }, TABULAR]}>{netText}</Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    zIndex: 20,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
})
