/**
 * AnchoredMenu — the chrome of {@link AnchoredDropdown} with arbitrary
 * children. Cameras / classes on Events open through this so they are a
 * compact card on the chip, not a full-page sheet.
 *
 * Transparent scrim: a dimmed overlay reads as a page-level modal, which
 * is the thing this exists to replace.
 *
 * The card is GLASS (2026-10-21, operator): the same `GlassSurface` as the tab
 * bar — its `bar` wash, dense enough to read a list over a busy grid — so
 * every menu in the app (the `⋯` menus, the Library filter / sort menus, the
 * select dropdowns, the account and activity popovers) is one material. Its
 * fallbacks are the surface's own: blur before iOS 26 and on the web, a
 * translucent solid on Android, opaque under Reduce Transparency.
 */
import React, { useEffect, useMemo } from 'react'
// ui-check-ok: the kit anchored menu owns its Modal, like SheetModal (pre-existing)
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { MOTION, menuOrigin, springTo, useReducedMotion } from '../../theme/motion.js'
import { useViewportSize } from '../../hooks/use-viewport-size.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { MenuGlassFill } from './GlassPanel.js'
import {
  DROPDOWN_GUTTER,
  placeAnchoredDropdown,
  type AnchorRect,
  type DropdownAlign,
  type DropdownPlacement,
} from './dropdown-placement.js'
import { KeyboardAwareScrollView } from './KeyboardInset.js'

export interface AnchoredMenuProps {
  readonly visible: boolean
  readonly onRequestClose: () => void
  readonly anchor: AnchorRect | null
  readonly children: React.ReactNode
  readonly align?: DropdownAlign
  readonly minWidth?: number
  /**
   * The exact width of the card. Absent ⟺ at least `minWidth` and at least the
   * anchor's own width; present, the card is that wide whatever the anchor is
   * (a menu sized to its content).
   */
  readonly width?: number
  readonly estimatedHeight?: number
  /** Force above/below when the caller already knows (footer chip → above). */
  readonly preferredPlacement?: DropdownPlacement
  /**
   * Dim everything behind the menu (the default stays transparent). Used by a
   * menu that belongs to ONE thing on the page, which `highlight` then draws
   * again above the dim, at the anchor's place.
   */
  readonly scrim?: boolean
  /** Drawn above the scrim exactly over the anchor; never takes a touch. */
  readonly highlight?: React.ReactNode
}

/** Tallest a menu is assumed to be (px) when placing it; also the cap of a sheet-height body. */
export const MENU_MAX_ESTIMATE = 480

export function AnchoredMenu({
  visible,
  onRequestClose,
  anchor,
  children,
  align = 'start',
  minWidth = 240,
  width,
  estimatedHeight = MENU_MAX_ESTIMATE,
  preferredPlacement,
  scrim = false,
  highlight,
}: AnchoredMenuProps): React.JSX.Element | null {
  const window = useViewportSize()
  const { colors } = useTheme()

  // Never wider than the viewport inside its gutters: a card wider than that
  // is clamped to the left gutter and cut at the right one.
  const menuWidth = Math.min(
    width !== undefined ? width : Math.max(minWidth, anchor?.width ?? 0),
    window.width - 2 * DROPDOWN_GUTTER,
  )
  const height = Math.min(MENU_MAX_ESTIMATE, estimatedHeight)

  const placed = useMemo(() => {
    if (anchor === null) return null
    return placeAnchoredDropdown({
      trigger: anchor,
      menuSize: { width: menuWidth, height },
      windowSize: { width: window.width, height: window.height },
      align,
      ...(preferredPlacement !== undefined ? { preferredPlacement } : {}),
    })
  }, [anchor, align, height, menuWidth, preferredPlacement, window.height, window.width])

  // Opens FROM the anchor: the scale grows out of the point of the menu nearest
  // the trigger, with a fade. The Modal itself does not animate.
  const reduced = useReducedMotion()
  const open = useSharedValue<number>(reduced ? 1 : 0)
  useEffect(() => {
    if (visible) open.set(springTo(1, reduced, MOTION.menu.spring))
    else open.set(0)
  }, [visible, open, reduced])
  const scrimStyle = useAnimatedStyle(() => ({ opacity: open.get() }))
  const openStyle = useAnimatedStyle(() => ({
    opacity: open.get(),
    transform: [{ scale: MOTION.menu.fromScale + (1 - MOTION.menu.fromScale) * open.get() }],
  }))

  if (!visible || placed === null) return null

  const origin = menuOrigin(anchor ?? { x: 0, width: 0 }, { left: placed.left, width: menuWidth }, placed.placement)

  const menuStyle: ViewStyle = {
    top: placed.top,
    left: placed.left,
    width: menuWidth,
    maxHeight: placed.maxHeight,
  }

  return (
    <Modal
      visible
      transparent
      animationType="none"
      // Without this iOS forces the app to portrait while the menu is open.
      supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      onRequestClose={onRequestClose}
    >
      <Pressable style={styles.scrim} onPress={onRequestClose}>
        {scrim ? (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.background + 'CC' }, scrimStyle]}
          />
        ) : null}
        {scrim && highlight !== undefined && anchor !== null ? (
          <View
            pointerEvents="none"
            style={[styles.highlight, { left: anchor.x, top: anchor.y, width: anchor.width, height: anchor.height }]}
          >
            {highlight}
          </View>
        ) : null}
        <Animated.View style={[styles.menu, menuStyle, { transformOrigin: [origin.x, origin.y, 0] }, openStyle]}>
        <MenuGlassFill />
        <Pressable
          onPress={(e) => {
            e.stopPropagation()
          }}
          style={styles.menuBody}
        >
          <KeyboardAwareScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            {children}
          </KeyboardAwareScrollView>
        </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
  },
  menuBody: { flexShrink: 1 },
  highlight: { position: 'absolute' },
  menu: {
    position: 'absolute',
    borderRadius: RADIUS.lg,
    paddingVertical: SPACING.xs,
    overflow: 'hidden',
    elevation: 12,
    zIndex: 40,
    // ui-check-ok: shadow colour is theme-independent (pre-existing)
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },
})
