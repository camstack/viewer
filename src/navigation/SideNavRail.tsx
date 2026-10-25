/**
 * SideNavRail — the glass side navigation, wherever a wide window shows it.
 *
 * ## Why this is not inside `TabsNavigator` any more
 *
 * The rail used to be private to the tab navigator, which meant it existed only
 * on the tab screens. The camera detail is a STACK route pushed OVER the tabs
 * (`app/(app)/_layout.tsx`), so opening a camera on a tablet or a wide browser
 * window made the navigation vanish — on the surface an operator sits in
 * longest, on the screens with the most room to keep it. That was the report of
 * 2026-08-20.
 *
 * A detail route has no `<Tabs>` context, so it cannot drive `TabTrigger`. The
 * rail therefore takes its item wrapper from the caller: inside `<Tabs>` the
 * navigator wraps each item in a `TabTrigger` (which preserves per-tab state);
 * outside it, the rail navigates with the router. Same list, same geometry, same
 * highlight rule — `nav-items.ts` — so the two can never drift into disagreeing
 * about where you are.
 */
import React, { useMemo } from 'react'
import { View, StyleSheet, TouchableOpacity } from 'react-native'
import { BlurView } from 'expo-blur'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { hapticTap } from '../lib/haptics.js'
import { useTheme } from '../theme/theme-provider.js'
import type { ColorTokens } from '../theme/tokens.js'
import { activeNavSegment, navItems, navPressAction, type NavItem } from './nav-items.js'
import { CAMERAS_TAB_HREF } from './back-to-cameras.js'
import { resolveCamerasPress } from './cameras-press.js'
import { useLastCameraStore } from '../store/last-camera-store.js'
import { SIDE_NAV_WIDTH } from './side-nav-metrics.js'
import { NavAccountCluster } from './NavAccountCluster.js'

export interface NavItemWrapperProps {
  readonly item: NavItem
  readonly children: React.ReactElement
}

/** Wraps one rail entry. `TabsNavigator` supplies a `TabTrigger`; the default
 *  (used off the tab tree) adds nothing and lets the rail route itself. */
export type NavItemWrapper = (props: NavItemWrapperProps) => React.JSX.Element

function PlainWrapper({ children }: NavItemWrapperProps): React.JSX.Element {
  return children
}

export interface SideNavRailProps {
  /** Current route path (`usePathname()`), for the active highlight. */
  readonly pathname: string
  /** Icon-only rail (phone landscape) vs full labelled rail (tablet / wide web). */
  readonly compact: boolean
  /**
   * Wrap each entry — `TabTrigger asChild` inside `<Tabs>`. When omitted the
   * rail navigates itself, which is what a stacked detail route needs.
   */
  readonly wrapItem?: NavItemWrapper
  /**
   * True when the wrapper already performs the navigation (`TabTrigger` does),
   * so the rail must not also push. Defaults to false.
   */
  readonly wrapperNavigates?: boolean
}

/**
 * Press feedback for a top-level destination — the SECOND documented exception
 * to the "navigation is silent" rule (see `lib/haptics-policy.ts`). The rail is
 * a control an operator hits by position without looking, and a tick on switch
 * is the platform convention. Only when the destination actually CHANGES:
 * buzzing for a no-op promises something that did not happen.
 */
function pressFeedback(isActive: boolean): void {
  if (isActive) return
  hapticTap()
}

export function SideNavRail({
  pathname,
  compact,
  wrapItem,
  wrapperNavigates = false,
}: SideNavRailProps): React.JSX.Element {
  const { colors, mode } = useTheme()
  const styles = useMemo(() => createStyles(colors), [colors])
  // Kept for its subscription: the rail re-renders on a language change.
  useTranslation()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const Wrapper = wrapItem ?? PlainWrapper

  // The left safe area (a Dynamic Island on the LEFT in landscape) is ADDED to
  // the width and consumed by the padding, so the icons clear the island without
  // being cut off. Zero in portrait and when the island is on the right.
  // The two literals live in `side-nav-metrics.ts`: the camera-detail column
  // subtracts this same footprint to size itself, and two copies of a rail
  // width is how one surface ends up laying out against the other's idea of it.
  const railWidth = SIDE_NAV_WIDTH
  const active = activeNavSegment(pathname)
  const rememberedCamera = useLastCameraStore((st) => st.current)
  const forgetLastCamera = useLastCameraStore((st) => st.forget)

  return (
    <BlurView
      tint={mode}
      intensity={85}
      style={[
        styles.sidebar,
        {
          width: railWidth + insets.left,
          paddingTop: insets.top || 16,
          paddingBottom: insets.bottom || 16,
          paddingLeft: insets.left,
          borderRightColor: colors.border,
          backgroundColor: colors.surface,
        },
      ]}
    >
      <View style={styles.sidebarInner}>
        {navItems.map((item) => {
          const { key, segment, icon: Icon } = item
          const isActive = active === segment
          return (
            <Wrapper key={key} item={item}>
              <TouchableOpacity
                onPress={() => {
                  // Cameras has a third destination — the camera the operator
                  // never closed. Same rule as `BottomNavBar`, same module.
                  if (item.segment === CAMERAS_TAB_HREF) {
                    const press = resolveCamerasPress(pathname, rememberedCamera)
                    pressFeedback(press.kind === 'noop')
                    if (wrapperNavigates || press.kind === 'noop') return
                    if (press.kind === 'camera') {
                      router.push(press.href as typeof item.href)
                      return
                    }
                    if (press.forget) forgetLastCamera()
                    router.dismissTo(item.href)
                    return
                  }
                  pressFeedback(isActive)
                  // Same rule and same reason as `BottomNavBar`: a detail
                  // route lights its parent entry, so `isActive` cannot decide
                  // whether the press has somewhere to go.
                  if (wrapperNavigates || navPressAction(pathname, item.segment) === 'noop') return
                  // Off the tab tree (camera / grid wall) this rail sits on a
                  // stacked `containedTransparentModal`. `navigate` PUSHES a
                  // second tab navigator on top of that modal — overlay on
                  // overlay, then the destination (a grid wall) is a third.
                  // `dismissTo` pops back to the already-mounted `(tabs)` route.
                  router.dismissTo(item.href)
                }}
                style={StyleSheet.flatten([
                  styles.sidebarItem,
                  { width: railWidth - 12 },
                  isActive && {
                    backgroundColor: `${colors.primary}26`,
                    borderColor: colors.border,
                  },
                ])}
                activeOpacity={0.7}
              >
                <Icon size={22} color={isActive ? colors.primary : colors.foregroundMuted} />
              </TouchableOpacity>
            </Wrapper>
          )
        })}
      </View>
      <NavAccountCluster orientation="column" wrapSettings={wrapperNavigates ? Wrapper : undefined} />
    </BlurView>
  )
}

const createStyles = (_colors: ColorTokens) =>
  StyleSheet.create({
    sidebar: {
      borderRightWidth: 1,
    },
    sidebarInner: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 4,
    },
    sidebarItem: {
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      paddingHorizontal: 4,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: 'transparent',
      gap: 3,
    },
    navLabel: {
      fontSize: 10,
      fontWeight: '400',
    },
    navLabelActive: {
      fontWeight: '600',
    },
  })
