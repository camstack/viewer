/**
 * DeviceDetailScreen — one device, in a sheet over the screen it was opened
 * from (operator decision 2026-11-12): a bottom sheet on the phone, a centred
 * dialog over the dimmed page on the web — {@link SheetModal} decides, once.
 * The route (`/device/<deviceId>`) is a transparent modal, so the screen
 * underneath stays where it was and closing the sheet goes back to it.
 *
 * ONE box: the header names the device and carries what the hub card's own
 * top line used to — the integration chip and the reachability — and under it
 * is the hub's device card (`/embed/device/<id>?host=viewer`, drawn `bare`:
 * no frame of its own, transparent page) in a WebView / iframe
 * ({@link DeviceCardEmbed}). The viewer keeps no native copy of that card: a
 * copy lagged it, and the same host will carry addon dashboards built for the
 * admin UI.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Badge } from '../components/ui/Badge.js'
import { SheetHeader } from '../components/ui/SheetHeader.js'
import { SHEET_ANIMATION_MS, SheetModal, sheetPresentation } from '../components/ui/SheetModal.js'
import { useDeviceIdentity } from '../data/device-detail-status.js'
import { useDeviceProviderLabel } from '../data/device-provider-label.js'
import { DeviceCardEmbed } from '../device-embed/DeviceCardEmbed.js'
import { useTheme } from '../theme/theme-provider.js'
import { RADIUS, SPACING } from '../theme/tokens.js'
import { deviceSheetHeight } from './device-sheet-size.js'

export interface DeviceDetailScreenProps {
  readonly deviceId: number
  readonly deviceName: string
  readonly deviceType: string
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

export function DeviceDetailScreen({ deviceId, deviceName }: DeviceDetailScreenProps): React.JSX.Element {
  const { t } = useTranslation()
  const router = useRouter()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const presentation = sheetPresentation(Platform.OS)
  const device = useDeviceIdentity(deviceId).data
  const integration = useDeviceProviderLabel(device?.provider ?? null)
  const name = device?.name ?? (deviceName === '' ? `#${deviceId}` : deviceName)
  const [visible, setVisible] = useState(true)
  const closing = useRef(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A screen that unmounts mid-close must not pop whatever replaced it.
  useEffect(
    () => () => {
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current)
    },
    [],
  )

  // The sheet slides out first; the route leaves when it is gone. A dialog
  // fades with the Modal itself, so the route can go at once. Reached cold (a
  // web deep link, a native cold link) there is nothing underneath the
  // transparent modal, so it lands on home instead of a blank screen.
  const close = useCallback(() => {
    if (closing.current) return
    closing.current = true
    setVisible(false)
    leaveTimer.current = setTimeout(
      () => {
        leaveTimer.current = null
        if (router.canGoBack()) router.back()
        else router.replace('/')
      },
      presentation === 'sheet' ? SHEET_ANIMATION_MS : 0,
    )
  }, [router, presentation])

  return (
    <SheetModal
      visible={visible}
      onClose={close}
      testID="device-sheet"
      backdropLabel={t('v2.common.close')}
      sheetStyle={[
        styles.sheet,
        {
          backgroundColor: colors.background,
          height: deviceSheetHeight(presentation, windowHeight),
          paddingBottom: presentation === 'sheet' ? insets.bottom + SPACING.xl : SPACING.xl,
        },
      ]}
    >
      <SheetHeader
        title={name}
        onClose={close}
        testID="device-sheet-header"
        meta={
          <>
            {integration === null ? null : <Badge label={integration} look="tint" size="sm" />}
            <ReachLine online={device == null ? null : device.online} />
          </>
        }
      />
      <View style={styles.card}>
        <DeviceCardEmbed deviceId={deviceId} bottomInset={0} />
      </View>
    </SheetModal>
  )
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingTop: SPACING.xl,
    paddingHorizontal: SPACING.xl,
  },
  card: { flex: 1, marginTop: SPACING.md },
})
