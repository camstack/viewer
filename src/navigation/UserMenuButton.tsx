/**
 * UserMenuButton — the account avatar of the rail and the phone bar's cluster
 * (`NavAccountCluster`). It opens the one app drawer, whose bottom block holds the
 * account: who is signed in, the server and its switch, "open at launch", sign-out.
 */
import React, { memo } from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useAppStore } from '../apps/app-store.js'
import { useMe } from '../data/use-me.js'
import { hapticTap } from '../lib/haptics.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING } from '../theme/tokens.js'
import { UserAvatar } from './UserAvatar.js'

export const USER_MENU_TEST_ID = 'user-menu-button'

export interface UserMenuButtonProps {
  /** Show the name beside the avatar (a roomy bar); icon-only otherwise. */
  readonly showName?: boolean
}

export const UserMenuButton = memo(function UserMenuButton({ showName = false }: UserMenuButtonProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { data: me } = useMe()
  const open = useAppStore((s) => s.drawerOpen)
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen)
  const name = me?.username ?? null

  return (
    <Pressable
      testID={USER_MENU_TEST_ID}
      onPress={() => {
        hapticTap()
        setDrawerOpen(true)
      }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={t('v2.userMenu.open', { name: name ?? '' })}
      style={styles.hit}
    >
      <UserAvatar name={name} />
      {showName && name !== null ? (
        <Text style={[styles.name, { color: colors.foregroundMuted }]} numberOfLines={1}>
          {name}
        </Text>
      ) : null}
    </Pressable>
  )
})

const styles = StyleSheet.create({
  hit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.md },
  name: { fontSize: 13, fontWeight: '500', maxWidth: 110 },
})
