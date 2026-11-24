/**
 * DrawerMenuButton — the hamburger at the LEFT of the viewer's bar (bottom bar on
 * a phone, rail on a wide window). It opens the one app drawer
 * (`src/apps/AppDrawer.tsx`); the avatar at the other end opens the account sheet.
 */
import React, { memo } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'

import { useAppStore } from '../apps/app-store.js'
import { hapticTap } from '../lib/haptics.js'
import { Menu } from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING } from '../theme/tokens.js'

export const DRAWER_MENU_TEST_ID = 'drawer-menu-button'

const HIT = 34

export interface DrawerMenuButtonProps {
  /** `row` in the bottom bar (margin to the nav items), `column` on the rail (centred). */
  readonly orientation: 'row' | 'column'
}

export const DrawerMenuButton = memo(function DrawerMenuButton({ orientation }: DrawerMenuButtonProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const open = useAppStore((s) => s.drawerOpen)
  const setDrawerOpen = useAppStore((s) => s.setDrawerOpen)
  return (
    <Pressable
      testID={DRAWER_MENU_TEST_ID}
      onPress={() => {
        hapticTap()
        setDrawerOpen(true)
      }}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={t('v2.apps.openMenu')}
      style={orientation === 'row' ? styles.hitRow : styles.hitColumn}
    >
      <Menu size={22} color={colors.foregroundMuted} />
    </Pressable>
  )
})

const styles = StyleSheet.create({
  hitRow: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center', marginLeft: SPACING.sm, marginRight: SPACING.xs },
  hitColumn: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
})
