/**
 * GridWallBackButton — the wall's back button: a glass chevron at the top-left
 * that fades out after a few seconds and returns on touch.
 *
 * The screen reports touches through `touches` (notified from `onTouchStart` on
 * the wall's root, which only observes and never claims the gesture). A touch inside a hosted WebView never
 * reaches React Native, so while hidden a small transparent corner zone takes
 * the touch and brings the button back instead of exiting.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'

import { ChevronLeft } from '../../lib/icons.js'
import { createWallBackTimer, type WallTouchRelay } from '../../grid/wall-back-visibility.js'
import { MOTION, timingTo, useReducedMotion } from '../../theme/motion.js'
import { GlassButton } from '../ui/GlassButton.js'
import {
  HEADER_BUTTON_SIZE,
  HEADER_PADDING_TOP,
  HEADER_PADDING_X,
} from '../screen-header-metrics.js'
import { HeaderBackButton } from '../ScreenHeader.js'

export interface GridWallBackButtonProps {
  /** Exits the wall — the same action as the control bar's back. */
  readonly onBack: () => void
  /** Fires on every touch of the wall. */
  readonly touches: WallTouchRelay
}

export function GridWallBackButton({ onBack, touches }: GridWallBackButtonProps): React.JSX.Element {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const opacity = useSharedValue(1)
  const [visible, setVisible] = useState(true)

  const timer = useMemo(
    () =>
      createWallBackTimer(setVisible, {
        set: (fn, ms) => setTimeout(fn, ms),
        clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      }),
    [],
  )
  useEffect(() => {
    timer.touch()
    return touches.subscribe(timer.touch)
  }, [timer, touches])
  useEffect(() => timer.dispose, [timer])
  useEffect(() => {
    opacity.set(timingTo(visible ? 1 : 0, visible ? MOTION.controls.fadeInMs : MOTION.controls.fadeOutMs, reduced))
  }, [visible, opacity, reduced])

  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }))
  const box = {
    top: insets.top + HEADER_PADDING_TOP,
    left: insets.left + HEADER_PADDING_X,
    width: HEADER_BUTTON_SIZE,
    height: HEADER_BUTTON_SIZE,
  }

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.abs, box, style]}
      testID="grid-wall-back"
    >
      {visible ? (
        <HeaderBackButton onPress={onBack} />
      ) : (
        <Pressable
          accessibilityLabel={t('v2.gridView.showBack')}
          onPress={timer.touch}
          hitSlop={16}
          style={StyleSheet.absoluteFill}
          testID="grid-wall-back-wake"
        />
      )}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  abs: { position: 'absolute' },
})
