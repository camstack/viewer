/**
 * GlassPanel — the MENU material on a box of its own: a card whose background
 * is the same `GlassSurface` (`bar` wash, no drop shadow) the anchored menus
 * draw. Every floating panel that is not a sheet — a menu, a popover, a
 * tooltip — is this one material, so a status popover never reads as a
 * different kind of object from the menu beside it (operator, 2026-10-21).
 *
 * `style` is LAYOUT (position, size, padding, gap); the look is the glass's.
 * The fallbacks are the surface's own: blur before iOS 26 and on the web, a
 * translucent solid on Android, opaque under Reduce Transparency.
 */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native'
import { RADIUS } from '../../theme/tokens.js'
import { GlassSurface } from './GlassSurface.js'

export interface GlassPanelProps
  extends Pick<
    ViewProps,
    'testID' | 'pointerEvents' | 'onLayout' | 'accessibilityRole' | 'accessibilityLiveRegion' | 'accessibilityLabel'
  > {
  readonly children?: React.ReactNode
  /** Layout only: position, size, padding, gap. */
  readonly style?: StyleProp<ViewStyle>
  /** Corner radius; defaults to the menus' `RADIUS.lg`. */
  readonly radius?: number
}

/** The glass layer itself, for a container that is not a plain View (an animated menu card). */
export function MenuGlassFill({ radius = RADIUS.lg }: { readonly radius?: number }): React.JSX.Element {
  return <GlassSurface fill radius={radius} variant="bar" shadow={false} dense pointerEvents="none" />
}

export function GlassPanel({ children, style, radius = RADIUS.lg, ...rest }: GlassPanelProps): React.JSX.Element {
  return (
    <View {...rest} style={[styles.panel, { borderRadius: radius }, style]}>
      <MenuGlassFill radius={radius} />
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  panel: { overflow: 'hidden' },
})
