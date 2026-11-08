/**
 * The Overview's primary control, LARGE: it is what the screen is for, so it
 * takes the room the remote does. A switch is one big power button; a media
 * player is the remote's key pad itself (the same layout and presses as the
 * remote screen); every other primary control sits, as the row draws it,
 * centred on a stage. The stage never invents controls: what it shows still
 * comes from {@link PrimaryControl}.
 */
import React from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Power } from '../../lib/icons.js'
import { fireControlHaptic } from '../camera/accessory-controls/control-atoms.js'
import { PrimaryControl } from '../camera/accessory-controls/AccessoryControl.js'
import type { AccessoryControlPick } from '../camera/accessory-controls/control-registry.js'
import { RemoteKeyPad, REMOTE_SCREEN_MAX_WIDTH } from '../camera/remote/RemoteKeyPad.js'
import { useCapMutator, useSwitchStatus } from '../../data/use-accessory-controls.js'
import { remoteFailureText, useRemoteCommands, useRemoteLayout, useRemotePress } from '../../data/use-remote.js'
import type { AccessoryDevice } from '../../data/use-accessories.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../../theme/tokens.js'

const POWER_BUTTON = 160
const POWER_ICON = 64

function PowerButton({ deviceId, online }: { readonly deviceId: number; readonly online: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const status = useSwitchStatus(deviceId, online)
  const mutator = useCapMutator(deviceId)
  if (status.isLoading && !status.data) return <ActivityIndicator color={colors.foregroundMuted} />
  const on = status.data?.on ?? false
  const label = on ? t('v2.accessories.on') : t('v2.accessories.off')
  const disabled = !online || mutator.pending
  return (
    <View style={styles.powerWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: on, disabled }}
        testID="device-power-button"
        disabled={disabled}
        onPress={() => {
          fireControlHaptic('action')
          void mutator.run('switch', 'setState', { on: !on }).then(() => status.refetch())
        }}
        style={[
          styles.power,
          { backgroundColor: on ? colors.primary : colors.backgroundElevated, borderColor: colors.border, opacity: disabled ? 0.45 : 1 },
        ]}
      >
        <Power size={POWER_ICON} color={on ? colors.primaryForeground : colors.foreground} />
      </Pressable>
      <Text style={[styles.powerLabel, { color: colors.foregroundMuted }]}>{label}</Text>
    </View>
  )
}

function RemoteStage({ device, pick }: { readonly device: AccessoryDevice; readonly pick: AccessoryControlPick }): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const commands = useRemoteCommands(device.id, true, true)
  const templateId = commands.data?.layoutTemplateId ?? null
  const layout = useRemoteLayout(templateId, true, true)
  const { press, failure, detail } = useRemotePress(device.id)
  if (commands.isLoading || (templateId !== null && layout.isLoading && layout.data == null)) {
    return <ActivityIndicator color={colors.foregroundMuted} testID="device-remote-loading" />
  }
  const roles = commands.data?.roles ?? []
  // No remote bound (or no layout): the row's own media control, as it was.
  if (roles.length === 0 || layout.data == null) return <PrimaryControl device={device} pick={pick} />
  return (
    <View style={styles.remote} testID="device-remote">
      <RemoteKeyPad layout={layout.data} bound={new Set(roles)} names={commands.data?.names} maxWidth={REMOTE_SCREEN_MAX_WIDTH} onPress={press} />
      {failure !== null ? (
        <Text accessibilityRole="alert" testID="device-remote-failure" style={[styles.failure, { color: colors.danger, borderColor: colors.danger }]}>
          {remoteFailureText(t(`v2.remote.failure.${failure}`), detail)}
        </Text>
      ) : null}
    </View>
  )
}

export function PrimaryStage({ device, pick }: { readonly device: AccessoryDevice; readonly pick: AccessoryControlPick }): React.JSX.Element {
  switch (pick.kind) {
    case 'switch':
      return <PowerButton deviceId={device.id} online={device.online} />
    case 'media-player':
      return <RemoteStage device={device} pick={pick} />
    default:
      return (
        <View style={styles.stage}>
          <PrimaryControl device={device} pick={pick} />
        </View>
      )
  }
}

const styles = StyleSheet.create({
  powerWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: SPACING.xl, paddingVertical: SPACING['3xl'] },
  power: {
    width: POWER_BUTTON,
    height: POWER_BUTTON,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  powerLabel: { fontSize: TYPOGRAPHY.size.lg, fontWeight: TYPOGRAPHY.weight.medium },
  stage: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: SPACING['3xl'] },
  remote: { alignItems: 'center', gap: SPACING.xl },
  failure: {
    alignSelf: 'stretch',
    maxWidth: REMOTE_SCREEN_MAX_WIDTH,
    padding: SPACING.lg,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    fontSize: TYPOGRAPHY.size.md,
  },
})
