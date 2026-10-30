/**
 * ClusterPill — one member thumbnail of a cluster card: a tap seeks, a HOLD
 * opens the event's action menu ({@link EventActionMenu}).
 *
 * While the finger is down the pill grows and fills (the hold's progress,
 * {@link HOLD_MS} long) so the press visibly leads somewhere; releasing early
 * or scrolling away takes it back and nothing happens. When the hold completes
 * the page dims behind a copy of the pill and the menu opens on it.
 *
 * `children` is what the pill shows; it is drawn twice (in the pill and in the
 * highlight over the dim), so it must be a pure picture of the event.
 */
import React, { memo, useCallback, useRef, useState } from 'react'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, cancelAnimation, Easing, withTiming } from 'react-native-reanimated'

import { EventActionMenu } from '../../events/EventActionMenu.js'
import type { AnchorRect } from '../../ui/dropdown-placement.js'
import { targetFromEvent } from '../../../recording/event-download.js'
import { MOTION, springTo, useReducedMotion } from '../../../theme/motion.js'
import { useTheme } from '../../../theme/theme-provider.js'
import type { ObjectEvent } from './event-cluster.js'

/** How long the finger stays down before the menu opens. */
export const HOLD_MS = 450
/** The pill's size at the end of the hold, relative to rest. */
export const HOLD_SCALE = 1.06
/** The fill's strongest opacity, reached at the end of the hold. */
const HOLD_FILL_OPACITY = 0.28
/** The highlighted copy over the dim, relative to rest. */
const HIGHLIGHT_SCALE = 1.04

export interface ClusterPillProps {
  readonly event: ObjectEvent
  readonly cameraName: string
  readonly width: number
  readonly height: number
  /** The pill's own look (border, size). */
  readonly pillStyle: StyleProp<ViewStyle>
  /** The pill's tilt, e.g. `'-2deg'`. */
  readonly rotate: string
  /** Its size at rest relative to the row (a deselected pill is slightly smaller). */
  readonly restScale: number
  /** Centre the pill in its row (a card that holds one). */
  readonly centred?: boolean
  /** Normal mode holds for the menu; a clips card has nothing to offer. */
  readonly holdEnabled: boolean
  readonly onPress: () => void
  readonly accessibilityLabel: string
  readonly selected: boolean
  readonly children: React.ReactNode
}

export const ClusterPill = memo(function ClusterPill({
  event,
  cameraName,
  width,
  height,
  pillStyle,
  rotate,
  restScale,
  centred = false,
  holdEnabled,
  onPress,
  accessibilityLabel,
  selected,
  children,
}: ClusterPillProps): React.JSX.Element {
  const { colors } = useTheme()
  const reduced = useReducedMotion()
  const ref = useRef<View>(null)
  const hold = useSharedValue(0)
  const [anchor, setAnchor] = useState<AnchorRect | null>(null)
  const [open, setOpen] = useState(false)

  const grow = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (HOLD_SCALE - 1) * hold.get() }],
  }))
  const fill = useAnimatedStyle(() => ({ opacity: HOLD_FILL_OPACITY * hold.get() }))

  const release = useCallback((): void => {
    cancelAnimation(hold)
    hold.set(springTo(0, reduced, MOTION.press.spring))
  }, [hold, reduced])

  const onPressIn = useCallback((): void => {
    if (!holdEnabled || reduced) return
    hold.set(withTiming(1, { duration: HOLD_MS, easing: Easing.linear }))
  }, [hold, holdEnabled, reduced])

  const onLongPress = useCallback((): void => {
    ref.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ x, y, width: w, height: h })
      setOpen(true)
    })
  }, [])

  const close = useCallback((): void => {
    setOpen(false)
    release()
  }, [release])

  return (
    <>
      <Animated.View style={[{ width, height }, centred ? styles.centred : null, grow]}>
        <Pressable
          ref={ref}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ selected }}
          onPress={onPress}
          onPressIn={onPressIn}
          onPressOut={release}
          onLongPress={holdEnabled ? onLongPress : undefined}
          delayLongPress={HOLD_MS}
          style={[pillStyle, { transform: [{ rotate }, { scale: restScale }] }]}
        >
          {children}
          {holdEnabled ? (
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { backgroundColor: colors.primary }, fill]}
            />
          ) : null}
        </Pressable>
      </Animated.View>
      {holdEnabled ? (
        <EventActionMenu
          visible={open}
          target={targetFromEvent(event, cameraName)}
          anchor={anchor}
          onClose={close}
          highlight={
            <View style={[pillStyle, styles.highlight, { transform: [{ rotate }, { scale: HIGHLIGHT_SCALE }] }]}>
              {children}
            </View>
          }
        />
      ) : null}
    </>
  )
})

const styles = StyleSheet.create({
  centred: { alignSelf: 'center' },
  highlight: { width: '100%', height: '100%' },
})
