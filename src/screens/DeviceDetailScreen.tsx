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
import { SHEET_ANIMATION_MS, SheetModal, sheetPresentation } from '../components/ui/SheetModal.js'
import { DeviceDetailBody } from './DeviceDetailBody.js'
import { useTheme } from '../theme/theme-provider.js'
import { RADIUS, SPACING } from '../theme/tokens.js'
import { deviceSheetHeight } from './device-sheet-size.js'

export interface DeviceDetailScreenProps {
  readonly deviceId: number
  readonly deviceName: string
  readonly deviceType: string
  /**
   * Keep the sheet mounted after it closes. The route host uses this so the
   * card document survives the route being popped. Absent: the sheet unmounts
   * with the route, which is what a screen mounted on its own does.
   */
  readonly retain?: boolean
  /** Controlled visibility, for the retained host. Absent: the screen owns it. */
  readonly shown?: boolean
  /** The host parks the document and pops the route. */
  readonly onRequestClose?: () => void
}

export function DeviceDetailScreen({
  deviceId,
  deviceName,
  retain = false,
  shown,
  onRequestClose,
}: DeviceDetailScreenProps): React.JSX.Element {
  const { t } = useTranslation()
  const router = useRouter()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const presentation = sheetPresentation(Platform.OS)
  const [ownedVisible, setOwnedVisible] = useState(true)
  const visible = shown ?? ownedVisible
  const closing = useRef(false)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A screen that unmounts mid-close must not pop whatever replaced it.
  useEffect(
    () => () => {
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current)
    },
    [],
  )

  // A retained sheet is shown again; the close latch is per open.
  useEffect(() => {
    if (shown === true) closing.current = false
  }, [shown])

  // The sheet slides out first; the route leaves when it is gone. A dialog
  // fades with the Modal itself, so the route can go at once. Reached cold (a
  // web deep link, a native cold link) there is nothing underneath the
  // transparent modal, so it lands on home instead of a blank screen.
  const close = useCallback(() => {
    if (closing.current) return
    closing.current = true
    if (onRequestClose !== undefined) {
      onRequestClose()
      return
    }
    setOwnedVisible(false)
    leaveTimer.current = setTimeout(
      () => {
        leaveTimer.current = null
        if (router.canGoBack()) router.back()
        else router.replace('/')
      },
      presentation === 'sheet' ? SHEET_ANIMATION_MS : 0,
    )
  }, [onRequestClose, presentation, router])

  return (
    <SheetModal
      visible={visible}
      retain={retain}
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
      <DeviceDetailBody deviceId={deviceId} deviceName={deviceName} onClose={close} active={visible} />
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
})
