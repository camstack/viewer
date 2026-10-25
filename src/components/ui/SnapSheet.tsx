/**
 * SnapSheet — an IN-SCREEN bottom sheet with snap points (collapsed / half /
 * full). Not a dialog: it lives inside its screen, over the content, and the
 * content behind it stays touchable. `SheetModal` is the dialog; this is the
 * drawer a canvas screen keeps open while the operator works on the canvas.
 *
 * Only the handle strip drags the sheet, so the content inside scrolls freely.
 * A release snaps to the nearest point of where the sheet WOULD have come to
 * rest (position plus a fling), and a tap on the handle steps to the next one.
 *
 * Pure snap arithmetic in `snap-sheet-math.ts`; this file is the wiring. The
 * gesture runs on the JS thread (`runOnJS`) and writes one shared value, so the
 * sheet's movement itself is a UI-thread transform.
 */
import React, { useCallback, useEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import {
  nextSnap,
  restingSnap,
  snapOffset,
  type SheetSnap,
  type SnapHeights,
} from './snap-sheet-math.js'

export interface SnapSheetProps {
  readonly snap: SheetSnap
  readonly onSnapChange: (next: SheetSnap) => void
  /** Visible height of each snap, in points. */
  readonly heights: SnapHeights
  /** Fixed header content next to the handle (summary strip, title). */
  readonly header?: React.ReactNode
  /** Height of the header row, so the content starts below it. */
  readonly headerHeight: number
  readonly children: React.ReactNode
  readonly handleLabel?: string
  readonly testID?: string
}

const ANIMATION_MS = 220

export function SnapSheet({
  snap,
  onSnapChange,
  heights,
  header,
  headerHeight,
  children,
  handleLabel,
  testID,
}: SnapSheetProps): React.JSX.Element {
  const { colors } = useTheme()
  const offset = useSharedValue(snapOffset(heights, snap))
  const start = useSharedValue(snapOffset(heights, snap))

  useEffect(() => {
    offset.value = withTiming(snapOffset(heights, snap), { duration: ANIMATION_MS })
  }, [heights, snap, offset])

  const drag = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onStart(() => {
          start.value = offset.value
        })
        .onUpdate((e) => {
          const lowest = snapOffset(heights, 'collapsed')
          offset.value = Math.min(lowest, Math.max(0, start.value + e.translationY))
        })
        .onEnd((e) => {
          const next = restingSnap(heights, start.value + e.translationY, e.velocityY)
          offset.value = withTiming(snapOffset(heights, next), { duration: ANIMATION_MS })
          if (next !== snap) onSnapChange(next)
        }),
    [heights, offset, start, snap, onSnapChange],
  )

  const step = useCallback(() => onSnapChange(nextSnap(snap)), [onSnapChange, snap])
  const tap = useMemo(() => Gesture.Tap().runOnJS(true).onEnd(step), [step])
  const handleGesture = useMemo(() => Gesture.Exclusive(drag, tap), [drag, tap])

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }))

  return (
    <Animated.View
      testID={testID}
      style={[
        styles.sheet,
        {
          height: heights.full,
          backgroundColor: colors.backgroundElevated,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      <GestureDetector gesture={handleGesture}>
        <View
          style={styles.dragZone}
          accessibilityRole="adjustable"
          accessibilityLabel={handleLabel}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
          <View style={{ minHeight: headerHeight }}>{header}</View>
        </View>
      </GestureDetector>
      <View style={styles.content}>{children}</View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  dragZone: { paddingTop: SPACING.md },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: SPACING.sm,
    minHeight: 4,
  },
  content: { flex: 1 },
})
