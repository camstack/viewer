/**
 * DeviceDetailBody — what one device's detail IS: a header that names the
 * device by its name alone (no provider chip; reachability is the card's own
 * Offline chip). An info button at the top-right opens those facts. Under the
 * header is the hub's device card (`/embed/device/<id>?host=viewer`, drawn
 * `bare`) in a WebView / iframe.
 *
 * ONE body for every home it has: the `/device/:id` route's sheet
 * ({@link DeviceDetailScreen}) and the Devices panel, where it REPLACES the list
 * (`CameraAccessoryPanel`). A host adds only what is its own: a close button, or
 * a back button before the title.
 */
import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { SheetHeader } from '../components/ui/SheetHeader.js'
import { useDeviceIdentity } from '../data/device-detail-status.js'
import { DeviceCardEmbed } from '../device-embed/DeviceCardEmbed.js'
import { noteDeviceEmbedTap, resetDeviceEmbedClock } from '../device-embed/device-embed-timing.js'
import { SPACING } from '../theme/tokens.js'
import { DeviceInfoButton } from './DeviceInfoButton.js'

export interface DeviceDetailBodyProps {
  readonly deviceId: number
  /** The name the opener already had; the hub's identity wins once it answers. */
  readonly deviceName: string
  /** Present ⇒ a close button in the header. */
  readonly onClose?: () => void
  /** Present ⇒ a back button before the header (the host's own navigation). */
  readonly leading?: React.ReactNode
  /** A fixed card height. Absent ⇒ the card fills the space left by its host. */
  readonly cardHeight?: number
}

export function DeviceDetailBody({
  deviceId,
  deviceName,
  onClose,
  leading,
  cardHeight,
}: DeviceDetailBodyProps): React.JSX.Element {
  const device = useDeviceIdentity(deviceId).data
  const name = device?.name ?? (deviceName === '' ? `#${deviceId}` : deviceName)
  // A row press notes the tap first; a cold route (deep link) starts the clock here.
  useEffect(() => {
    noteDeviceEmbedTap(deviceId)
    return () => resetDeviceEmbedClock()
  }, [deviceId])
  return (
    <>
      <View style={styles.headerRow}>
        {leading}
        <View style={styles.headerTitle}>
          <SheetHeader
            title={name}
            actions={<DeviceInfoButton deviceId={deviceId} />}
            onClose={onClose}
            testID="device-sheet-header"
          />
        </View>
      </View>
      <View style={cardHeight === undefined ? styles.cardFill : { height: cardHeight, marginTop: SPACING.md }}>
        <DeviceCardEmbed deviceId={deviceId} bottomInset={0} />
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  headerTitle: { flex: 1 },
  cardFill: { flex: 1, marginTop: SPACING.md },
})
