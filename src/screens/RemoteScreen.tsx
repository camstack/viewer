/**
 * RemoteScreen — a device's TV / IR remote, full screen.
 *
 * A stacked route over the tabs (`/remote/<deviceId>`), opened from the remote
 * sheet. It draws the same saved layout as the sheet ({@link RemoteKeyPad})
 * and sends presses through the same `useRemotePress`. The viewer never edits
 * a layout. Group titles are not drawn: a group is a frame or a gap.
 */
import React from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ScreenHeader } from '../components/ScreenHeader.js'
import { EmptyState } from '../components/ui/EmptyState.js'
import { RemoteKeyPad, REMOTE_SCREEN_MAX_WIDTH } from '../components/camera/remote/RemoteKeyPad.js'
import { useCanActuate } from '../hooks/use-user-scope.js'
import { remoteFailureText, useRemoteCommands, useRemoteLayout, useRemotePress } from '../data/use-remote.js'
import { useMediaPlayerStatus, type MediaPlayerStatus } from '../data/use-accessory-controls-ext.js'
import { Gamepad2 } from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../theme/tokens.js'

export interface RemoteScreenProps {
  readonly deviceId: number
  readonly deviceName: string
}

type Translate = (key: string) => string

function powerSubtitle(
  status: MediaPlayerStatus | null | undefined,
  loading: boolean,
  t: Translate,
): string | undefined {
  if (loading) return undefined
  if (status?.state === undefined) return t('v2.accessories.stateUnknown')
  return t(`v2.accessories.mediaState.${status.state}`)
}

export function RemoteScreen({ deviceId, deviceName }: RemoteScreenProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const canActuate = useCanActuate()
  const commands = useRemoteCommands(deviceId, true, true)
  const templateId = commands.data?.layoutTemplateId ?? null
  const layout = useRemoteLayout(templateId, true, true)
  const status = useMediaPlayerStatus(deviceId, true)
  const { press, failure, detail } = useRemotePress(deviceId)
  const bound = new Set(commands.data?.roles ?? [])
  const waiting =
    commands.isLoading || (templateId !== null && layout.isLoading && layout.data == null)
  const title = deviceName === '' ? t('v2.accessories.remote') : t('v2.remote.title', { name: deviceName })
  const failed = commands.isError ? commands.error : layout.isError ? layout.error : null

  let body: React.JSX.Element
  if (!canActuate) {
    body = <EmptyState icon={Gamepad2} title={t('v2.access.notForYourAccount')} testID="remote-no-access" />
  } else if (waiting) {
    body = <ActivityIndicator color={colors.foregroundMuted} testID="remote-loading" />
  } else if (failed !== null) {
    body = (
      <EmptyState
        tone="danger"
        title={t('v2.remote.unreadable')}
        body={failed instanceof Error ? failed.message : String(failed)}
        action={layout.isError ? { label: t('common.retry'), onPress: () => void layout.refetch() } : undefined}
        testID="remote-error"
      />
    )
  } else if (commands.data == null || commands.data.roles.length === 0) {
    body = <EmptyState icon={Gamepad2} title={t('v2.remote.failure.no-remote')} testID="remote-none" />
  } else if (layout.data == null) {
    body = <EmptyState icon={Gamepad2} title={t('v2.remote.noLayout')} testID="remote-no-layout" />
  } else {
    body = (
      <RemoteKeyPad
        layout={layout.data}
        bound={bound}
        maxWidth={REMOTE_SCREEN_MAX_WIDTH}
        onPress={(role) => void press(role)}
      />
    )
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]} testID="remote-screen">
      <ScreenHeader
        title={title}
        subtitle={powerSubtitle(status.data, status.isLoading && status.data == null, t)}
        onBack={() => router.back()}
        bordered
      />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + SPACING['2xl'] }]}>
        {body}
        {failure !== null ? (
          <Text
            accessibilityRole="alert"
            testID="remote-failure"
            style={[styles.failure, { color: colors.danger, borderColor: colors.danger }]}
          >
            {remoteFailureText(t(`v2.remote.failure.${failure}`), detail)}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { padding: SPACING.xl, alignItems: 'center', gap: SPACING.xl },
  failure: {
    alignSelf: 'stretch',
    maxWidth: REMOTE_SCREEN_MAX_WIDTH,
    padding: SPACING.lg,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    fontSize: TYPOGRAPHY.size.md,
    fontWeight: TYPOGRAPHY.weight.medium,
  },
})
