/**
 * The remote of a media player (an infrared TV) in a sheet: the device's saved
 * remote layout, drawn by {@link RemoteKeyPad}, where a press sends that
 * button's command (`remote.sendCommand`). The header opens the same layout
 * full screen. The admin hero opens the same layout in a modal.
 */
import React from 'react'
import { StyleSheet, Text } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Gamepad2, Maximize2 } from '../../../lib/icons.js'
import { SheetHeader, SheetIconButton } from '../../ui/SheetHeader.js'
import { SheetModal } from '../../ui/SheetModal.js'
import { remoteFailureText, useRemoteCommands, useRemoteLayout, useRemotePress } from '../../../data/use-remote.js'
import { remoteRoute } from '../../../remote/remote-route.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../../../theme/tokens.js'
import { RemoteKeyPad, REMOTE_SHEET_MAX_WIDTH } from './RemoteKeyPad.js'

export interface RemoteSheetProps {
  readonly deviceId: number
  readonly deviceName: string
  readonly onClose: () => void
}

export function RemoteSheet({ deviceId, deviceName, onClose }: RemoteSheetProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
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
      sheetStyle={[styles.sheet, { backgroundColor: colors.backgroundElevated }]}
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
      {layout.data != null ? (
        <RemoteKeyPad
          layout={layout.data}
          bound={bound}
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
  note: { fontSize: TYPOGRAPHY.size.sm, textAlign: 'center' },
})
