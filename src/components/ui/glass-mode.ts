/**
 * Which surface a glass element is drawn as — decided in ONE place.
 *
 * `glass`  iOS 26 Liquid Glass (`expo-glass-effect`, a native `GlassView`).
 * `blur`   `expo-blur` + a token tint: iOS before 26, a binary that predates the
 *          glass module, and the web (`backdrop-filter`).
 * `solid`  no blur at all: Android (a translucent solid) and anyone who turned
 *          on Reduce Transparency (opaque + a border).
 *
 * ## Why the native module is probed, not imported
 *
 * `expo-glass-effect` reaches the app as a dependency of expo-router, and an
 * OTA bundle can run on a binary built BEFORE it was autolinked. `GlassView`
 * and `isGlassEffectAPIAvailable()` both `requireNativeModule('ExpoGlassEffect')`
 * and THROW when it is absent — an exception at first render, on a screen the
 * operator cannot get past. So the module is asked for with
 * `requireOptionalNativeModule` first, and `expo-glass-effect` itself is loaded
 * only after the answer is yes. Nothing here throws.
 */
import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'
import type { ComponentType } from 'react'
import type { GlassContainerProps, GlassViewProps } from 'expo-glass-effect'

export type GlassMode = 'glass' | 'blur' | 'solid'

export interface GlassModeInput {
  readonly os: string
  /** `AccessibilityInfo` (iOS) / `prefers-reduced-transparency` (web). */
  readonly reduceTransparency: boolean
  /** {@link hasNativeGlass}: module linked AND the OS API present. */
  readonly nativeGlass: boolean
}

/** Pure: the whole decision table. */
export function resolveGlassMode({ os, reduceTransparency, nativeGlass }: GlassModeInput): GlassMode {
  if (reduceTransparency) return 'solid'
  if (os === 'android') return 'solid'
  if (os === 'ios' && nativeGlass) return 'glass'
  return 'blur'
}

interface GlassNativeModule {
  readonly isGlassEffectAPIAvailable?: boolean
}

/**
 * True only on iOS, with the `ExpoGlassEffect` module in THIS binary, on an OS
 * that has the API. Never throws: an absent module is `false`.
 */
export function hasNativeGlass(): boolean {
  if (Platform.OS !== 'ios') return false
  try {
    const mod = requireOptionalNativeModule<GlassNativeModule>('ExpoGlassEffect')
    return mod != null && mod.isGlassEffectAPIAvailable === true
  } catch {
    return false
  }
}

interface GlassLibrary {
  readonly GlassView?: ComponentType<GlassViewProps>
  readonly GlassContainer?: ComponentType<GlassContainerProps>
}

/** A module-level import would evaluate expo-glass-effect on every binary; this
 *  `require` runs it only where the native module exists. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const requireGlassLibrary = (): GlassLibrary => require('expo-glass-effect') as GlassLibrary

/**
 * The native `GlassView`, loaded lazily and only after {@link hasNativeGlass}.
 * `loadLibrary` is the seam a spec uses to stand in for the package.
 */
export function loadGlassView(
  loadLibrary: () => GlassLibrary = requireGlassLibrary,
): ComponentType<GlassViewProps> | null {
  if (!hasNativeGlass()) return null
  try {
    return loadLibrary().GlassView ?? null
  } catch (error) {
    console.warn('[GlassSurface] expo-glass-effect failed to load, using the blur fallback', error)
    return null
  }
}

/**
 * The native `GlassContainer` (iOS 26): glass shapes inside it merge and morph
 * into each other when they come within `spacing`. Same lazy, never-throwing
 * load as {@link loadGlassView}; `null` everywhere the group has no meaning.
 */
export function loadGlassContainer(
  loadLibrary: () => GlassLibrary = requireGlassLibrary,
): ComponentType<GlassContainerProps> | null {
  if (!hasNativeGlass()) return null
  try {
    return loadLibrary().GlassContainer ?? null
  } catch (error) {
    console.warn('[GlassGroup] expo-glass-effect failed to load, grouping glass is off', error)
    return null
  }
}
