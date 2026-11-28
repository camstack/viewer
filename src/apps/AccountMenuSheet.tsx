/**
 * AccountMenuSheet — what the drawer's avatar row opens: Account, Switch server, the
 * active app's Settings (only when it declares them), Open at launch and Sign out.
 * The same sheet pattern as the server switch.
 */
import React from 'react'
import { StyleSheet, Text } from 'react-native'
import { useTranslation } from 'react-i18next'

import { MenuRow } from '../components/ui/MenuRow.js'
import { PickerSheet, PickerSheetButton } from '../components/ui/PickerSheet.js'
import { LogOut, Server, Settings, User, X } from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import type { DrawerSettings } from './drawer-model.js'

export interface AccountMenuSheetProps {
  readonly settings: DrawerSettings | null
  /** The current "open at launch" choice, as the row's value. */
  readonly launchValue: string
  readonly onAccount: () => void
  readonly onSwitchServer: () => void
  readonly onSettings: (path: string) => void
  readonly onLaunch: () => void
  readonly onSignOut: () => void
  readonly onClose: () => void
}

export function AccountMenuSheet({ settings, launchValue, onAccount, onSwitchServer, onSettings, onLaunch, onSignOut, onClose }: AccountMenuSheetProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <PickerSheet
      title={t('v2.apps.account')}
      onClose={onClose}
      testID="account-menu-sheet"
      headerRight={
        <PickerSheetButton label={t('v2.common.close')} onPress={onClose}>
          <X size={18} color={colors.foreground} />
        </PickerSheetButton>
      }
    >
      <MenuRow testID="drawer-account-link" icon={User} label={t('v2.apps.account')} onPress={onAccount} />
      <MenuRow testID="drawer-switch-server" icon={Server} label={t('v2.userMenu.servers')} onPress={onSwitchServer} />
      {settings !== null ? <MenuRow testID="drawer-settings" icon={Settings} label={settings.label} onPress={() => onSettings(settings.path)} /> : null}
      <MenuRow
        testID="drawer-open-at-launch"
        icon={Settings}
        label={t('v2.apps.openAtLaunch')}
        onPress={onLaunch}
        trailing={<Text style={[styles.value, { color: colors.foregroundMuted }]}>{launchValue}</Text>}
      />
      <MenuRow testID="drawer-sign-out" icon={LogOut} label={t('v2.userMenu.signOut')} destructive onPress={onSignOut} />
    </PickerSheet>
  )
}

const styles = StyleSheet.create({
  value: { fontSize: 13 },
})
