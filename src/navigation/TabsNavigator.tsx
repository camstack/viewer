// Responsive custom tab bar ported from v1's app/(tabs)/_layout.tsx (now mounted from app/(app)/(tabs)/_layout.tsx). Uses
// expo-router/ui's headless Tabs primitives: a hidden <TabList> registers the
// routes (required for discovery + navigation), then we render our own nav UI
// driving <TabTrigger asChild> by route name. Tablet → glass sidebar; phone →
// elevated bottom bar. Theme/icons adapted to srcV2 (useTheme + lucide).
//
// TODO: re-add fullscreen hide-nav + OTA modal when those land in srcV2.
import React, { useMemo } from 'react'
import { View, StyleSheet } from 'react-native'
import { Tabs, TabList, TabTrigger, TabSlot } from 'expo-router/ui'
import { usePathname } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/theme-provider.js'
import type { ColorTokens } from '../theme/tokens.js'
import { useSidebarLayout } from '../hooks/use-responsive.js'
import { registeredTabs } from './nav-items.js'
import { SideNavRail, type NavItemWrapperProps } from './SideNavRail.js'
import { BottomNavBar } from './BottomNavBar.js'
import { BottomNavInsetProvider } from './bottom-nav-inset.js'
import { bottomNavFootprint } from './bottom-nav-metrics.js'

export function TabsNavigator() {
  const { colors } = useTheme()
  const styles = useMemo(() => createStyles(colors), [colors])
  const insets = useSafeAreaInsets()
  const pathname = usePathname()
  const { showSidebar: showSideNav, compact } = useSidebarLayout()

  // No hide-nav logic yet (fullscreen/grid/webview not ported) — see TODO above.
  // Side nav for tablets (full, labelled), phone-landscape (compact, icon-only),
  // AND wide web windows. Bottom bar only for phone-portrait / narrow web.
  const showBottomNav = !showSideNav

  return (
    <Tabs style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Hidden TabList — expo-router needs it to discover + register routes. */}
      <TabList style={styles.hiddenTabList}>
        {registeredTabs.map(({ name, href, key }) => (
          <TabTrigger key={key} name={name} href={href} />
        ))}
      </TabList>

      <View style={styles.mainRow}>
        {/* ── Side rail (tablet / phone-landscape / wide web) ──
            The same component the camera detail mounts, so a wide window keeps
            ONE navigation everywhere. Inside <Tabs> the entries must be
            TabTriggers — that is what preserves per-tab state — so the rail is
            given that wrapper and told not to route itself. */}
        {showSideNav && (
          <SideNavRail
            pathname={pathname}
            compact={compact}
            wrapperNavigates
            wrapItem={({ item, children }: NavItemWrapperProps) => (
              <TabTrigger name={item.name} asChild>
                {children}
              </TabTrigger>
            )}
          />
        )}

        <BottomNavInsetProvider
          inset={bottomNavFootprint({ visible: showBottomNav, insetBottom: insets.bottom })}
        >
          <TabSlot style={styles.content} />
        </BottomNavInsetProvider>
      </View>

      {/* ── Phone bottom bar ──
          Extracted for the same reason the rail was: the camera detail is a
          stacked route with no `<Tabs>` context, and an operator who asked for
          the navigation to stay visible there has to get THIS bar, not a copy
          of it. Inside `<Tabs>` the entries must be TabTriggers — that is what
          preserves per-tab state — so the bar is given that wrapper and told
          not to route itself. */}
      {showBottomNav && (
        // A glass capsule FLOATING over the screens (they scroll under it and
        // pad themselves with `useBottomNavInset`), so it leaves the flow.
        <View style={styles.floatingBar} pointerEvents="box-none">
          <BottomNavBar
            pathname={pathname}
            insetBottom={insets.bottom}
            wrapperNavigates
            wrapItem={({ item, children }: NavItemWrapperProps) => (
              <TabTrigger name={item.name} asChild>
                {children}
              </TabTrigger>
            )}
          />
        </View>
      )}
    </Tabs>
  )
}

const createStyles = (_colors: ColorTokens) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    hiddenTabList: {
      height: 0,
      overflow: 'hidden',
    },
    mainRow: {
      flex: 1,
      flexDirection: 'row',
      minHeight: 0,
    },
    floatingBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
    },
    content: {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
    },
  })
