/**
 * HomeBar — the top bar of the list pages (Cameras, Library, Grids,
 * Notifications, Settings root). Agreed with the operator 2026-11-24 (#691).
 *
 *   - `phone` (48 px): the user's avatar (opens the drawer) at the left, the tab's title centred, bell · Activity at
 *     the right (#707: this bar IS the tab's header, no second one). The bottom tabs stay.
 *   - `wide` (56 px, h-14 like the admin), beside the rail: the avatar at the left, then the section title, the shared search, bell, Activity; the avatar (the apps drawer) leads the bar.
 *
 * It spends the top safe-area inset once; the screens below read
 * `useScreenTopInset()` and spend none (`TopInsetSpentContext`).
 */
import React, { memo, useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAppStore } from '../apps/app-store.js'
import { ActivityButton } from '../activity/ActivityButton.js'
import { hapticTap } from '../lib/haptics.js'
import { Bell, Menu, Search } from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY, type ColorTokens } from '../theme/tokens.js'
import { homeBarHeight, type HomeBarVariant } from './bar-kind.js'
import { isItemActive, registeredTabs } from './nav-items.js'
import { DrawerMenuButton } from './DrawerMenuButton.js'

export const HOME_BAR_TEST_ID = 'home-bar'
export const HOME_BAR_BELL_TEST_ID = 'home-bar-bell'
export const HOME_BAR_SEARCH_TEST_ID = 'home-bar-search'

const HIT = 40
const BELL_ICON_SIZE = 22
const SEARCH_HEIGHT = 36
const SEARCH_MAX_WIDTH = 420

export interface HomeBarProps {
  readonly variant: HomeBarVariant
  /** Current route path, for the wide bar's section title and the bell's no-op. */
  readonly pathname: string
  /**
   * Wraps the bell. Inside `<Tabs>` the navigator supplies a `TabTrigger` (that
   * preserves per-tab state and does the navigating); without it the bell does
   * nothing — it is only mounted inside the tab tree.
   */
  readonly wrapBell: (children: React.ReactElement) => React.JSX.Element
}

export const HomeBar = memo(function HomeBar({ variant, pathname, wrapBell }: HomeBarProps): React.JSX.Element {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => createStyles(colors), [colors])
  const wide = variant === 'wide'
  // `/` is the app's index and lands on the Cameras tab; it has no segment of its own.
  const section = registeredTabs.find((tab) => isItemActive(pathname === '/' ? '/cameras' : pathname, tab.segment))

  const title = section === undefined ? '' : t(`nav.${section.key}`)

  const bell = wrapBell(
    <Pressable
      testID={HOME_BAR_BELL_TEST_ID}
      onPress={() => hapticTap()}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={t('nav.notifications')}
      style={styles.hit}
    >
      <Bell size={BELL_ICON_SIZE} color={colors.foregroundMuted} />
    </Pressable>,
  )

  return (
    <View
      testID={HOME_BAR_TEST_ID}
      style={[
        styles.bar,
        {
          height: homeBarHeight(variant) + insets.top,
          paddingTop: insets.top,
          // A notch in landscape sits at the side: keep the avatar clear of it.
          paddingLeft: SPACING.lg + insets.left,
          paddingRight: SPACING.lg + insets.right,
        },
      ]}
    >
      {wide ? (
        <>
          <DrawerMenuButton orientation="column" />
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <SearchField />
          <View style={styles.spacer} />
          {bell}
          <ActivityButton menuAlign="end" />
        </>
      ) : (
        <>
          <DrawerMenuButton orientation="column" />
          <View style={[styles.centre, { top: insets.top }]} pointerEvents="none">
            <Text style={styles.centreTitle} numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
          </View>
          <View style={styles.spacer} />
          {bell}
          <ActivityButton menuAlign="end" />
        </>
      )}
    </View>
  )
})

/**
 * The wide bar's search: the shell's ONE shared search (the drawer's), so this
 * is a field that opens it with the cursor in it rather than a second search.
 */
function SearchField(): React.JSX.Element {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const styles = useMemo(() => createStyles(colors), [colors])
  const openDrawerSearch = useAppStore((s) => s.openDrawerSearch)
  return (
    <Pressable
      testID={HOME_BAR_SEARCH_TEST_ID}
      onPress={() => {
        hapticTap()
        openDrawerSearch()
      }}
      accessibilityRole="search"
      accessibilityLabel={t('v2.apps.searchPlaceholder')}
      style={styles.search}
    >
      <Search size={14} color={colors.foregroundMuted} />
      <Text style={styles.searchText} numberOfLines={1}>
        {t('v2.apps.searchPlaceholder')}
      </Text>
    </Pressable>
  )
}

const createStyles = (colors: ColorTokens) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.md,
      paddingHorizontal: SPACING.lg,
      backgroundColor: colors.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    hit: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
    spacer: { flex: 1 },
    // The tab's title, centred on the BAR, not on the room left between the buttons.
    centre: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
    centreTitle: { maxWidth: '50%', color: colors.foreground, fontSize: TYPOGRAPHY.size.lg, fontWeight: TYPOGRAPHY.weight.bold },
    title: { color: colors.foreground, fontSize: TYPOGRAPHY.size.lg, fontWeight: TYPOGRAPHY.weight.bold, marginRight: SPACING.lg },
    search: {
      flex: 1,
      maxWidth: SEARCH_MAX_WIDTH,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.md,
      height: SEARCH_HEIGHT,
      paddingHorizontal: SPACING.lg,
      borderRadius: RADIUS.xl,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    searchText: { flex: 1, color: colors.foregroundSubtle, fontSize: TYPOGRAPHY.size.md },
  })
