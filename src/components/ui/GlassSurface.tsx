/**
 * GlassSurface — the one glass element of the viewer.
 *
 * A capsule (or any radius) that floats over content: the tab bar, the pills
 * over a stream, the playback bar docked over video. Every glass use goes
 * through here so the fallbacks and the Reduce Transparency rule live once —
 * see `glass-mode.ts` for the decision table and why the native module is
 * probed instead of imported.
 *
 * `style` is LAYOUT (size, position, margin) and lands on the outer box; the
 * look comes from the tokens (`GLASS`, `RADIUS.pill`, `withAlpha`). Children
 * are drawn inside the clipped surface — put text/icons in `foreground` (or
 * the `*Fill` family on a `tint`), which holds >= 4.5:1 on the light wash.
 */
import React, { useMemo } from 'react'
import { Platform, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native'
import { BlurView } from 'expo-blur'

import { useTheme } from '../../theme/theme-provider.js'
import { GLASS, RADIUS, withAlpha } from '../../theme/tokens.js'
import { hasNativeGlass, loadGlassContainer, loadGlassView, resolveGlassMode, type GlassMode } from './glass-mode.js'

/** Resolved once at import: the native view never changes for the life of the binary, and a
 *  component looked up inside render would remount its children on every pass. */
const NATIVE_GLASS_VIEW = loadGlassView()
const NATIVE_GLASS_CONTAINER = loadGlassContainer()
import { useReduceTransparency } from './use-reduce-transparency.js'

export interface GlassSurfaceProps extends Pick<ViewProps, 'testID' | 'pointerEvents' | 'onLayout'> {
  readonly children?: React.ReactNode
  /** Layout only: size, position, margins. */
  readonly style?: StyleProp<ViewStyle>
  /** Corner radius; defaults to the full pill. */
  readonly radius?: number
  /** A palette colour that washes the glass (an active state). */
  readonly tint?: string
  /** Fill the parent's box as a background layer behind sibling content. */
  readonly fill?: boolean
  /** Press feedback on iOS glass. */
  readonly interactive?: boolean
  /** `bar` = the darker, more opaque wash of the tab bar (see `GLASS.bar`). */
  readonly variant?: 'floating' | 'bar'
  /** Padding inside the surface (kept off `style` so it never reaches the shadow box). */
  readonly contentStyle?: StyleProp<ViewStyle>
  /**
   * The soft drop shadow under blur / solid glass. Off for a small chip that
   * sits ON a picture and is repeated dozens of times in a list: a blurred
   * 18 px shadow per chip is pure overdraw there, and over an image it reads as
   * a smudge rather than lift.
   */
  readonly shadow?: boolean
  /**
   * Lay the `bar` wash UNDER the native iOS glass too (it is already the fill
   * of the blur and solid fallbacks). A MENU needs it: the system glass is
   * nearly clear over a busy picture grid, and inside a parent that fades in
   * from opacity 0 (every anchored menu) it may not be drawn at all — the
   * People `⋯` menu read as bare text over the faces (operator, 2026-10-22).
   *
   * A `floating` surface gets the blur fallback's own wash (`backgroundElevated`
   * at `GLASS.tintAlpha`) and its `tint` on top, so a disc that mounts under a
   * fade still reads as a disc, active or not: the on-video mute and PiP discs
   * were drawn as bare glyphs over the picture (operator, 2026-10-23).
   */
  readonly dense?: boolean
}

export function GlassSurface({
  children,
  style,
  radius = RADIUS.pill,
  tint,
  interactive = false,
  variant = 'floating',
  fill = false,
  contentStyle,
  shadow = true,
  dense = false,
  testID,
  pointerEvents,
  onLayout,
}: GlassSurfaceProps): React.JSX.Element {
  const { colors, mode: theme } = useTheme()
  const reduced = useReduceTransparency()
  const glassMode = resolveGlassMode({
    os: Platform.OS,
    reduceTransparency: reduced,
    nativeGlass: hasNativeGlass(),
  })
  const NativeGlass = glassMode === 'glass' ? NATIVE_GLASS_VIEW : null
  const effective: GlassMode = glassMode === 'glass' && NativeGlass == null ? 'blur' : glassMode

  const look = useMemo(() => {
    const shadowColor = theme === 'dark' ? colors.background : colors.foreground
    const dropShadow: ViewStyle =
      effective === 'solid' && Platform.OS === 'android'
        ? { elevation: 4 }
        : { boxShadow: `0 6px 18px ${withAlpha(shadowColor, theme === 'dark' ? 0.5 : 0.18)}` }
    const hairline = withAlpha(colors.foreground, GLASS.hairlineAlpha[theme])
    const bar = variant === 'bar' ? withAlpha(colors[GLASS.bar.tone[theme]], GLASS.bar.alpha[theme]) : null
    const fill = bar ?? withAlpha(colors.backgroundElevated, GLASS.tintAlpha[theme])
    const solid = reduced
      ? variant === 'bar'
        ? colors[GLASS.bar.tone[theme]]
        : colors.backgroundElevated
      : (bar ?? withAlpha(colors.backgroundElevated, GLASS.solidAlpha))
    return { dropShadow, hairline, fill, solid, bar }
  }, [colors, theme, effective, reduced, variant])

  // `flexGrow` lets a surface given a definite box (absoluteFill behind a row of
  // controls) fill it; an auto-sized pill is unaffected.
  const clip: ViewStyle = { borderRadius: radius, overflow: 'hidden', flexGrow: 1 }
  const wash = tint ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tint }]} /> : null

  let surface: React.JSX.Element
  if (effective === 'glass' && NativeGlass) {
    surface = (
      <NativeGlass
        glassEffectStyle="regular"
        colorScheme={theme}
        tintColor={tint ?? look.bar ?? undefined}
        isInteractive={interactive}
        style={clip}
      >
        {dense ? (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: denseWash(look) }]} />
        ) : null}
        {dense ? wash : null}
        <View style={contentStyle}>{children}</View>
      </NativeGlass>
    )
  } else if (effective === 'blur') {
    surface = (
      <BlurView
        tint={theme}
        intensity={GLASS.blurIntensity}
        style={[clip, styles.edge, { borderColor: look.hairline, backgroundColor: look.fill }]}
      >
        {wash}
        <View style={contentStyle}>{children}</View>
      </BlurView>
    )
  } else {
    surface = (
      <View
        style={[
          clip,
          styles.edge,
          { borderColor: reduced ? colors.border : look.hairline, backgroundColor: look.solid },
        ]}
      >
        {wash}
        <View style={contentStyle}>{children}</View>
      </View>
    )
  }

  return (
    <View
      testID={testID}
      pointerEvents={pointerEvents}
      onLayout={onLayout}
      style={[{ borderRadius: radius }, fill ? StyleSheet.absoluteFill : null, effective === 'glass' || !shadow ? null : look.dropShadow, style]}
    >
      {surface}
    </View>
  )
}

/** The wash a `dense` surface lays under the native glass: the bar's for a bar, the blur fallback's otherwise. */
export function denseWash(look: { readonly bar: string | null; readonly fill: string }): string {
  return look.bar ?? look.fill
}

/** Distance (points) within which grouped glass shapes merge on iOS 26. */
export const GLASS_GROUP_SPACING = 12

export interface GlassGroupProps extends Pick<ViewProps, 'testID' | 'pointerEvents'> {
  readonly children?: React.ReactNode
  readonly style?: StyleProp<ViewStyle>
  /** Merge distance; defaults to {@link GLASS_GROUP_SPACING}. */
  readonly spacing?: number
}

/** Which element a group renders as: the pure half of {@link GlassGroup}. */
export function resolveGroupMode(input: Parameters<typeof resolveGlassMode>[0], hasContainer: boolean): 'native' | 'plain' {
  return resolveGlassMode(input) === 'glass' && hasContainer ? 'native' : 'plain'
}

/**
 * Related glass shapes (a segmented capsule, a cluster of discs) drawn as ONE
 * glass body: on iOS 26 the system morphs and merges them as they approach.
 * Everywhere else — iOS before 26, Android, the web, Reduce Transparency — it is
 * the plain `View` the cluster already was, so layout never depends on it.
 */
export function GlassGroup({ children, style, spacing = GLASS_GROUP_SPACING, testID, pointerEvents }: GlassGroupProps): React.JSX.Element {
  const reduced = useReduceTransparency()
  const mode = resolveGroupMode(
    { os: Platform.OS, reduceTransparency: reduced, nativeGlass: hasNativeGlass() },
    NATIVE_GLASS_CONTAINER != null,
  )
  if (mode === 'native' && NATIVE_GLASS_CONTAINER) {
    const Container = NATIVE_GLASS_CONTAINER
    return (
      <Container spacing={spacing} style={style} testID={testID} pointerEvents={pointerEvents}>
        {children}
      </Container>
    )
  }
  return (
    <View style={style} testID={testID} pointerEvents={pointerEvents}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  edge: { borderWidth: StyleSheet.hairlineWidth * 2 },
})
