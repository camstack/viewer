/**
 * DeviceCardSheetHost — the device sheet, kept after its route is gone.
 *
 * The card is a WebView. Unmounting it parses the admin shell again on the
 * next open (measured at about two seconds). The route (`/device/:id`) only
 * presents and parks this host; the sheet draws here, beside the navigator,
 * the same way the on-demand player outlives a route. Closing parks the sheet
 * off-screen (`retain` on `SheetModal`) so the document stays and the next
 * device is a message. Five minutes hidden, or a memory warning, drops it.
 *
 * What the operator sees does not change: the sheet is the same sheet, in the
 * same place, with the same open and close travel.
 */
import React, { useCallback, useSyncExternalStore } from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { DeviceDetailScreen } from '../screens/DeviceDetailScreen.js'
import { markDeviceEmbed, resetDeviceEmbedClock } from './device-embed-timing.js'
import {
  deviceCardSession,
  dropDeviceCard,
  parkDeviceCard,
  subscribeDeviceCardSession,
} from './device-card-session.js'
import { useDropHiddenDocument } from './use-hidden-device-document.js'

export function DeviceCardSheetHost(): React.JSX.Element | null {
  const session = useSyncExternalStore(subscribeDeviceCardSession, deviceCardSession, deviceCardSession)
  const router = useRouter()
  useDropHiddenDocument(session?.phase === 'parked', () => {
    const current = deviceCardSession()
    if (current !== null) {
      markDeviceEmbed('document-dropped', current.deviceId)
      resetDeviceEmbedClock()
    }
    dropDeviceCard()
  })
  const onRequestClose = useCallback(() => {
    parkDeviceCard()
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }, [router])
  if (session === null) return null
  return (
    <View pointerEvents="box-none" style={styles.host}>
      <DeviceDetailScreen
        deviceId={session.deviceId}
        deviceName={session.deviceName}
        deviceType={session.deviceType}
        retain
        shown={session.phase === 'open'}
        onRequestClose={onRequestClose}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  host: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
})
