/**
 * DeviceDetailScreen — one device, full screen.
 *
 * A stacked route over the tabs (`/device/<deviceId>`), opened from a detail
 * button on an accessory row, with the same chrome as the remote
 * ({@link FullScreenFrame}, `ScreenHeader`). Below the header the screen is
 * the hub's device card — the admin's `/embed/device/<id>` page, the one
 * shareable block for a device (hero, history, power supply, timed runs,
 * consumables) — in a WebView ({@link DeviceCardEmbed}). The viewer keeps no
 * native copy of that card: a copy lagged it.
 */
import React from 'react'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ScreenHeader } from '../components/ScreenHeader.js'
import { FullScreenFrame, fullScreenBottomPad } from '../components/FullScreenFrame.js'
import { useDeviceIdentity } from '../data/device-detail-status.js'
import { DeviceCardEmbed } from '../device-embed/DeviceCardEmbed.js'

export interface DeviceDetailScreenProps {
  readonly deviceId: number
  readonly deviceName: string
  readonly deviceType: string
}

export function DeviceDetailScreen({ deviceId, deviceName }: DeviceDetailScreenProps): React.JSX.Element {
  const { t } = useTranslation()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const device = useDeviceIdentity(deviceId).data
  const name = device?.name ?? (deviceName === '' ? `#${deviceId}` : deviceName)
  // Unanswered identity is not "online": no subtitle until it answers (D315).
  const subtitle =
    device == null ? undefined : device.online === true ? t('v2.deviceDetail.online') : t('v2.deviceDetail.offline')

  return (
    <FullScreenFrame testID="device-screen">
      <ScreenHeader title={name} subtitle={subtitle} onBack={() => router.back()} bordered />
      <DeviceCardEmbed deviceId={deviceId} bottomInset={fullScreenBottomPad(insets.bottom)} />
    </FullScreenFrame>
  )
}
