/**
 * The remote of a media player (an infrared TV) in a sheet: the device's saved
 * remote layout, drawn by {@link RemoteKeyPad}, where a press sends that
 * button's command (`remote.sendCommand`). The header opens the same layout
 * full screen. The admin hero opens the same layout in a modal.
 */
import React from 'react'
import { ScrollView, StyleSheet, Text, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Gamepad2, Maximize2 } from '../../../lib/icons.js'
import { SheetHeader, SheetIconButton } from '../../ui/SheetHeader.js'
import { SheetModal } from '../../ui/SheetModal.js'
import { remoteFailureText, useRemoteCommands, useRemoteLayout, useRemotePress } from '../../../data/use-remote.js'
import { fullScreenBottomPad } from '../../FullScreenFrame.js'
import { remoteRoute } from '../../../remote/remote-route.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../../../theme/tokens.js'
import { RemoteKeyPad, REMOTE_SHEET_MAX_WIDTH } from './RemoteKeyPad.js'

export interface RemoteSheetProps {
  readonly deviceId: number
  readonly deviceName: string
  readonly onClose: () => void
}

/** The tallest the sheet's card may be: the window below the status bar / Dynamic Island. */
export function remoteSheetMaxHeight(windowHeight: number, insetTop: number): number {
  return Math.max(0, windowHeight - insetTop)
}

export function RemoteSheet({ deviceId, deviceName, onClose }: RemoteSheetProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { height: windowHeight } = useWindowDimensions()
  const commands = useRemoteCommands(deviceId, true)
  const templateId = commands.data?.layoutTemplateId ?? null
  const layout = useRemoteLayout(templateId, true)
  const { press, failure, detail } = useRemotePress(deviceId)
  const bound = new Set(commands.data?.roles ?? [])
  const answered = !commands.isLoading && !layout.isLoading
  return (
    <SheetModal
      visible
      onClose={onClose}
      backdropLabel={t('v2.common.close')}
      testID="remote-sheet"
      // A tall remote must stop below the status bar, never run under it.
      sheetStyle={[styles.sheet, { backgroundColor: colors.backgroundElevated, maxHeight: remoteSheetMaxHeight(windowHeight, insets.top) }]}
    >
      <SheetHeader
        title={t('v2.remote.title', { name: deviceName })}
        icon={Gamepad2}
        onClose={onClose}
        actions={
          <SheetIconButton
            icon={Maximize2}
            label={t('v2.remote.fullScreen')}
            testID="remote-open-full"
            onPress={() => {
              onClose()
              router.push(remoteRoute(deviceId, deviceName))
            }}
          />
        }
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: fullScreenBottomPad(insets.bottom) - SPACING.xl }]}
        showsVerticalScrollIndicator={false}
      >
        {layout.data != null ? (
          <RemoteKeyPad
            layout={layout.data}
            bound={bound}
            names={commands.data?.names}
            maxWidth={REMOTE_SHEET_MAX_WIDTH}
            onPress={(role) => void press(role)}
          />
        ) : answered ? (
          <Text style={[styles.note, { color: colors.foregroundMuted }]}>{t('v2.remote.noLayout')}</Text>
        ) : null}
        {failure !== null ? (
          <Text accessibilityRole="alert" style={[styles.note, { color: colors.danger }]}>
            {remoteFailureText(t(`v2.remote.failure.${failure}`), detail)}
          </Text>
        ) : null}
      </ScrollView>
    </SheetModal>
  )
}

const styles = StyleSheet.create({
  sheet: {
    padding: SPACING.xl,
    gap: SPACING.md,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
  },
  scroll: { flexShrink: 1 },
  scrollContent: { alignItems: 'center', gap: SPACING.md },
  note: { fontSize: TYPOGRAPHY.size.sm, textAlign: 'center' },
})
