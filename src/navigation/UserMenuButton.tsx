/**
 * UserMenuButton — the account avatar at the right of the navigation. It opens
 * the account sheet (`src/apps/AccountSheet.tsx`): who is signed in, the saved
 * servers, "open at launch" and sign-out. The apps live in the drawer, opened by
 * the hamburger at the other end (`DrawerMenuButton`).
 */
import React, { memo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useAppStore } from '../apps/app-store.js'
import { useMe } from '../data/use-me.js'
import { hapticTap } from '../lib/haptics.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING } from '../theme/tokens.js'
import { userInitial } from './user-menu.js'

export const USER_MENU_TEST_ID = 'user-menu-button'

const AVATAR = 34

export interface UserMenuButtonProps {
  /** Show the name beside the avatar (a roomy bar); icon-only otherwise. */
  readonly showName?: boolean
}

export const UserMenuButton = memo(function UserMenuButton({ showName = false }: UserMenuButtonProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { data: me } = useMe()
  const open = useAppStore((s) => s.accountOpen)
  const setAccountOpen = useAppStore((s) => s.setAccountOpen)
  const name = me?.username ?? null

  return (
    <Pressable
      testID={USER_MENU_TEST_ID}
      onPress={() => {
        hapticTap()
        setAccountOpen(true)
      }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={t('v2.userMenu.open', { name: name ?? '' })}
      style={styles.hit}
    >
      <View style={[styles.avatar, { backgroundColor: colors.surfaceHover, borderColor: colors.border }]}>
        <Text style={[styles.initial, { color: colors.foreground }]}>{userInitial(name)}</Text>
      </View>
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
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontSize: 14, fontWeight: '700' },
  name: { fontSize: 13, fontWeight: '500', maxWidth: 110 },
})
