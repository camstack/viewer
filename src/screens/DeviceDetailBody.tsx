/**
 * DeviceDetailBody — what one device's detail IS: a header that names the
 * device (integration chip and reachability beside it) over the hub's device
 * card (`/embed/device/<id>?host=viewer`, drawn `bare`) in a WebView / iframe.
 *
 * ONE body for every home it has: the `/device/:id` route's sheet
 * ({@link DeviceDetailScreen}) and the Devices panel, where it REPLACES the list
 * (`CameraAccessoryPanel`). A host adds only what is its own: a close button, or
 * a back button before the title.
 */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Badge } from '../components/ui/Badge.js'
import { SheetHeader } from '../components/ui/SheetHeader.js'
import { useDeviceIdentity } from '../data/device-detail-status.js'
import { useDeviceProviderLabel } from '../data/device-provider-label.js'
import { DeviceCardEmbed } from '../device-embed/DeviceCardEmbed.js'
import { SPACING } from '../theme/tokens.js'

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

/** Reachability for the header: unanswered draws nothing (D315). */
function ReachLine({ online }: { readonly online: boolean | null }): React.JSX.Element | null {
  const { t } = useTranslation()
  if (online === null) return null
  return online ? (
    <Badge label={t('v2.deviceDetail.online')} tone="neutral" look="outline" size="sm" />
  ) : (
    <Badge label={t('v2.deviceDetail.offline')} tone="danger" look="tint" size="sm" />
  )
}

export function DeviceDetailBody({
  deviceId,
  deviceName,
  onClose,
  leading,
  cardHeight,
}: DeviceDetailBodyProps): React.JSX.Element {
  const device = useDeviceIdentity(deviceId).data
  const integration = useDeviceProviderLabel(device?.provider ?? null)
  const name = device?.name ?? (deviceName === '' ? `#${deviceId}` : deviceName)
  return (
    <>
      <View style={styles.headerRow}>
        {leading}
        <View style={styles.headerTitle}>
          <SheetHeader
            title={name}
            onClose={onClose}
            testID="device-sheet-header"
            meta={
              <>
                {integration === null ? null : <Badge label={integration} look="tint" size="sm" />}
                <ReachLine online={device == null ? null : device.online} />
              </>
            }
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
