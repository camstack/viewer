/**
 * OfflineBadge — the "Offline" chip a device row / detail wears when the hub
 * answered `online: false`. Renders nothing for an online or UNKNOWN device,
 * so the caller can drop it in unconditionally.
 */
import React from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Badge } from '../ui/Badge.js'
import { isDeviceOffline } from './device-reachability.js'

export interface OfflineBadgeProps {
  /** The hub's online flag; `undefined` / `null` = not known, draws nothing. */
  readonly online: boolean | null | undefined
  readonly testID?: string
}

export function OfflineBadge({ online, testID }: OfflineBadgeProps): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!isDeviceOffline(online)) return null
  return (
    <View testID={testID}>
      <Badge label={t('v2.common.offline')} tone="danger" look="fill" size="sm" />
    </View>
  )
}
