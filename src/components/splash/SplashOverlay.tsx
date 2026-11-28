/**
 * The animated splash. The native splash stays up (static `splash-icon.png`,
 * the same frame as the logo's rest frame) until this full-screen overlay has
 * laid out, then the intro pass plays once and the overlay fades out as soon as
 * the app is ready — never before the pass ends (≤ 1.8 s), never later than
 * `MAX_HOLD_MS`. With reduce-motion on it shows the rest frame and just fades.
 * Native only: the hub-served web build has no native splash to hand over from,
 * and holding the page for an intro would only add delay.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Platform, StyleSheet, useColorScheme } from 'react-native'
import * as SplashScreen from 'expo-splash-screen'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

import { useServer } from '../../app/ServerProvider.js'
import { SPLASH_BACKGROUND, SPLASH_ORBIT } from '../../theme/tokens.js'
import { AnimatedLogo } from './AnimatedLogo.js'
import { FADE_MS, fadeDelayMs } from './splash-timing.js'

/** Matches `imageWidth` of the `expo-splash-screen` plugin in app.config.ts. */
export const SPLASH_LOGO_SIZE = 200

const IS_NATIVE = Platform.OS !== 'web'

// Module scope: must run before the first render, or the native splash
// auto-hides on it and the logo pops in late.
if (IS_NATIVE) void SplashScreen.preventAutoHideAsync().catch(() => undefined)

export function SplashOverlay(): React.JSX.Element | null {
  const { loading } = useServer()
  const scheme = useColorScheme()
  const mode = scheme === 'light' ? 'light' : 'dark'
  const background = SPLASH_BACKGROUND[mode]
  const [gone, setGone] = useState(!IS_NATIVE)
  const [laidOutAt, setLaidOutAt] = useState<number | null>(null)
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null)
  const opacity = useSharedValue(1)
  const fading = useRef(false)

  useEffect(() => {
    if (!IS_NATIVE) return
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduceMotion(v))
      .catch(() => alive && setReduceMotion(false))
    return () => {
      alive = false
    }
  }, [])

  const onLayout = useCallback(() => {
    setLaidOutAt((prev) => prev ?? Date.now())
    void SplashScreen.hideAsync().catch(() => undefined)
  }, [])

  useEffect(() => {
    if (laidOutAt === null || fading.current) return undefined
    const delay = fadeDelayMs({ ready: !loading, reduceMotion, elapsedMs: Date.now() - laidOutAt })
    const timer = setTimeout(() => {
      fading.current = true
      opacity.value = withTiming(0, { duration: FADE_MS }, (finished) => {
        if (finished) runOnJS(setGone)(true)
      })
    }, delay)
    return () => clearTimeout(timer)
  }, [laidOutAt, loading, reduceMotion, opacity])

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }))
  if (gone) return null
  return (
    <Animated.View
      onLayout={onLayout}
      style={[styles.fill, { backgroundColor: background }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <AnimatedLogo size={SPLASH_LOGO_SIZE} ringColor={background} orbitColor={SPLASH_ORBIT[mode]} play={reduceMotion === false} />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', zIndex: 1000, elevation: 1000 },
})
