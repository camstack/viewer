/**
 * Header badges of the device detail: battery, network link and power draw.
 * Each reads its own cap and draws nothing until the hub answered with a
 * usable value; a measurement that failed is never drawn as 0.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Battery, BatteryCharging, BatteryLow, Wifi, Zap } from '../../lib/icons.js'
import { useBattery } from '../../data/use-battery.js'
import { useNetworkLink } from '../../data/use-network-link.js'
import { usePowerMeter } from '../../data/device-detail-status.js'
import { Badge } from '../ui/Badge.js'

/** At or below this the battery badge turns to a warning. */
const BATTERY_WARN_LEVEL = 20

export interface DeviceBadgeProps {
  readonly deviceId: number
  readonly enabled: boolean
}

export function BatteryBadge({ deviceId, enabled }: DeviceBadgeProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const status = useBattery(deviceId, enabled)
  const battery = status.data
  if (battery == null) return null
  const Icon = battery.charging === 'dc' || battery.charging === 'solar' ? BatteryCharging : battery.level <= BATTERY_WARN_LEVEL ? BatteryLow : Battery
  return (
    <Badge
      label={t('v2.deviceDetail.battery', { level: Math.round(battery.level) })}
      tone={battery.level <= BATTERY_WARN_LEVEL ? 'warning' : 'neutral'}
      look="tint"
      renderIcon={(color, size) => <Icon size={size} color={color} />}
    />
  )
}

export function LinkBadge({ deviceId, enabled }: DeviceBadgeProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const status = useNetworkLink(deviceId, enabled)
  const link = status.data
  if (link == null || link.type === 'unknown') return null
  const label = link.signal === null ? t('v2.deviceDetail.linkWired') : t('v2.deviceDetail.link', { signal: Math.round(link.signal) })
  return <Badge label={label} look="tint" renderIcon={(color, size) => <Wifi size={size} color={color} />} />
}

export function PowerBadge({ deviceId, enabled }: DeviceBadgeProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const status = usePowerMeter(deviceId, enabled)
  if (status.data == null) return null
  const watts = status.data.watts
  const text = watts >= 1000 ? `${(watts / 1000).toFixed(1)} kW` : t('v2.deviceDetail.power', { watts: Math.round(watts) })
  return <Badge label={text} look="tint" renderIcon={(color, size) => <Zap size={size} color={color} />} />
}
