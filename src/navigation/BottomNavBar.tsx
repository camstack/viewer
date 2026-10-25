/**
 * BottomNavBar — the phone bottom navigation, wherever it is drawn.
 *
 * ## Why this is not inside `TabsNavigator` any more
 *
 * The exact story `SideNavRail.tsx` tells, one layout down. The bar used to be
 * private to the tab navigator, so it existed only on the tab screens; the
 * camera detail is a STACK route pushed OVER the tabs and paints opaque, so
 * opening a camera on a phone hid the navigation entirely. The rail was given
 * its escape hatch on 2026-08-20 and the bar was not, because a wide window
 * shows the rail and nobody was looking at the narrow one.
 *
 * A detail route has no `<Tabs>` context, so it cannot drive `TabTrigger`. The
 * bar therefore takes its item wrapper from the caller — same contract as the
 * rail: inside `<Tabs>` the navigator wraps each item in a `TabTrigger` (which
 * preserves per-tab state); outside it, the bar navigates with the router.
 * Same list, same highlight rule (`nav-items.ts`), so the two can never drift
 * into disagreeing about where you are.
 *
 * ## Its height is a declared number, not whatever the content comes to
 *
 * `bottom-nav-metrics.ts` owns it, and the camera detail SUBTRACTS it before
 * sizing the column under the picture. A bar that grew to its content would
 * make that subtraction a guess — see the metrics module for the rule this
 * repo already learned once with the rail width.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, type LayoutChangeEvent } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'

import { hapticTap } from '../lib/haptics.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING, type ColorTokens } from '../theme/tokens.js'
import { GlassGroup, GlassSurface } from '../components/ui/GlassSurface.js'
import { activeNavSegment, navItems, navPressAction, type NavItem } from './nav-items.js'
import { MOTION, timingTo, useReducedMotion } from '../theme/motion.js'
import { SlidingGlassPill } from '../components/ui/SlidingGlassPill.js'
import { tabPillTarget } from './tab-pill.js'
import type { LucideIcon } from '../lib/icons.js'
import { CAMERAS_TAB_HREF } from './back-to-cameras.js'
import { resolveCamerasPress } from './cameras-press.js'
import { useLastCameraStore } from '../store/last-camera-store.js'
import {
  BOTTOM_NAV_ROW_HEIGHT,
  BOTTOM_NAV_SIDE_MARGIN,
  bottomNavFootprint,
  bottomNavPaddingBottom,
} from './bottom-nav-metrics.js'
import { NavAccountCluster } from './NavAccountCluster.js'

/** Marker for the bar's root. `testID` reaches the web as `data-testid` and is
 *  inert on a device — the same idiom the shelf uses for its own guarantee. */
export const BOTTOM_NAV_TEST_ID = 'bottom-nav'

export interface NavItemWrapperProps {
  readonly item: NavItem
  readonly children: React.ReactElement
}

/** Wraps one bar entry. `TabsNavigator` supplies a `TabTrigger`; the default
 *  (used off the tab tree) adds nothing and lets the bar route itself. */
export type NavItemWrapper = (props: NavItemWrapperProps) => React.JSX.Element

function PlainWrapper({ children }: NavItemWrapperProps): React.JSX.Element {
  return children
}

export interface BottomNavBarProps {
  /** Current route path (`usePathname()`), for the active highlight. */
  readonly pathname: string
  /** `useSafeAreaInsets().bottom` — the home indicator the bar pads around. */
  readonly insetBottom: number
  /**
   * Wrap each entry — `TabTrigger asChild` inside `<Tabs>`. When omitted the
   * bar navigates itself, which is what a stacked detail route needs.
   */
  readonly wrapItem?: NavItemWrapper
  /**
   * True when the wrapper already performs the navigation (`TabTrigger` does),
   * so the bar must not also push. Defaults to false.
   */
  readonly wrapperNavigates?: boolean
}

/**
 * Press feedback for a top-level destination — the SECOND documented exception
 * to the "navigation is silent" rule (see `lib/haptics-policy.ts`). Only when
 * the destination actually CHANGES: buzzing for a no-op promises something that
 * did not happen.
 */
function pressFeedback(isActive: boolean): void {
  if (isActive) return
  hapticTap()
}

export function BottomNavBar({
  pathname,
  insetBottom,
  wrapItem,
  wrapperNavigates = false,
}: BottomNavBarProps): React.JSX.Element {
  const { colors } = useTheme()
  const styles = useMemo(() => createStyles(colors), [colors])
  const { t } = useTranslation()
  const router = useRouter()
  const Wrapper = wrapItem ?? PlainWrapper
  const active = activeNavSegment(pathname)
  const rememberedCamera = useLastCameraStore((st) => st.current)
  const forgetLastCamera = useLastCameraStore((st) => st.forget)
  const [rowWidth, setRowWidth] = useState(0)
  const pill = tabPillTarget(active, navItems, rowWidth)
  const onRowLayout = (e: LayoutChangeEvent): void => setRowWidth(e.nativeEvent.layout.width)

  return (
    <View
      testID={BOTTOM_NAV_TEST_ID}
      // The box is transparent and only the capsule takes touches: content
      // behind the side margins and the gap below must stay reachable.
      pointerEvents="box-none"
      style={[
        styles.bottomNav,
        {
          // Declared, not derived: this IS the number the camera detail
          // subtracts from the window (`bottom-nav-metrics.ts`).
          height: bottomNavFootprint({ visible: true, insetBottom }),
          paddingBottom: bottomNavPaddingBottom(insetBottom),
        },
      ]}
    >
      <GlassGroup>
      <GlassSurface variant="bar" style={styles.capsule} contentStyle={styles.capsuleRow}>
      <View style={styles.itemsRow} onLayout={onRowLayout}>
      {rowWidth > 0 ? <SlidingGlassPill target={pill} testID="bottom-nav-pill" /> : null}
      {navItems.map((item) => {
        const { key, segment, icon: Icon } = item
        const isActive = active === segment
        return (
          <Wrapper key={key} item={item}>
            <TouchableOpacity
              onPress={() => {
                // NOT `isActive`. A camera detail lights the Cameras entry,
                // so `isActive` was true there and the press was swallowed —
                // pressing Cameras while looking at a camera did nothing at
                // all. The question is whether we are ON the entry's route,
                // which is what `navPressAction` answers. The haptic follows
                // the same answer: leaving a camera for the list IS a change
                // of destination, and the rule is to buzz only for one.
                // Cameras is the one entry with somewhere ELSE to go: back to
                // the camera the operator never closed. See
                // `resolveCamerasPress` for the three cases.
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
                const willNavigate = navPressAction(pathname, item.segment) === 'navigate'
                pressFeedback(!willNavigate)
                if (wrapperNavigates || !willNavigate) return
                // Off the tab tree this bar sits on a stacked
                // `containedTransparentModal`. `navigate` PUSHES a second tab
                // navigator on top of that modal; `dismissTo` pops back to the
                // already-mounted `(tabs)` route. Same reasoning, and the same
                // call, as `SideNavRail`.
                router.dismissTo(item.href)
              }}
              style={styles.bottomNavItem}
              activeOpacity={0.7}
            >
              {/* The lit entry's pill is the ONE sliding `SlidingGlassPill` behind the
                  row; here only the glyph and label cross-fade between the
                  muted face and `primaryFill`, the token that holds >= 4.5:1
                  on the glass (`primary` itself does not). */}
              <TabFace icon={Icon} label={t(`nav.${key}`)} active={isActive} />
            </TouchableOpacity>
          </Wrapper>
        )
      })}
      </View>
      {/* The two fixed items at the right: the account menu and the Activity
          centre. They are not destinations — no highlight, no TabTrigger. */}
      <NavAccountCluster orientation="row" wrapSettings={wrapperNavigates ? Wrapper : undefined} />
      </GlassSurface>
      </GlassGroup>
    </View>
  )
}

const createStyles = (_colors: ColorTokens) =>
  StyleSheet.create({
    bottomNav: {
      paddingHorizontal: BOTTOM_NAV_SIDE_MARGIN,
      justifyContent: 'flex-end',
    },
    capsule: { height: BOTTOM_NAV_ROW_HEIGHT },
    itemsRow: { flex: 1, flexDirection: 'row', alignSelf: 'stretch' },
    capsuleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      height: BOTTOM_NAV_ROW_HEIGHT,
      padding: SPACING.sm,
    },
    bottomNavItem: {
      flex: 1,
      alignSelf: 'stretch',
    },
  })

/** Glyph + label drawn twice, muted under lit, and the lit one's opacity is the cross-fade. */
function TabFace({
  icon: Icon,
  label,
  active,
}: {
  readonly icon: LucideIcon
  readonly label: string
  readonly active: boolean
}): React.JSX.Element {
  const { colors } = useTheme()
  const lit = useSharedValue<number>(active ? 1 : 0)
  const reduced = useReducedMotion()
  const litStyle = useAnimatedStyle(() => ({ opacity: lit.get() }))
  useEffect(() => {
    lit.set(timingTo(active ? 1 : 0, MOTION.crossFade.ms, reduced))
  }, [active, lit, reduced])
  // Same weight in both layers: they are stacked, so any width difference would double the text.
  const layer = (color: string): React.JSX.Element => (
    <>
      <Icon size={22} color={color} />
      <Text style={[pillStyles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </>
  )
  return (
    <View style={pillStyles.face}>
      {layer(colors.foregroundMuted)}
      <Animated.View style={[StyleSheet.absoluteFill, pillStyles.face, litStyle]} pointerEvents="none">
        {layer(colors.primaryFill)}
      </Animated.View>
    </View>
  )
}

const pillStyles = StyleSheet.create({
  face: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { fontSize: 10 },
})
