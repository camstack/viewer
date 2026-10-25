/**
 * ProgressStrip — the ONE drawing of `lib/progress.ts`'s two arms.
 *
 * `known` fills the track to the fraction. `unknown` does **not** fill it to
 * zero: it sweeps a short segment back and forth, saying "this is running" and
 * declining to say how far. A bar sitting at 0 % on work whose size was never
 * measured claims it has not started, which is false and which lurches the
 * moment a real number lands — the failure D393 names.
 *
 * Two surfaces draw it: the clips list's running row (`ClipRowProgress`) and
 * the clip-export modal. One component so the unknown arm cannot go missing
 * from one of them.
 *
 * The sweep is a UI-thread `translateX`, and only a strip that is
 * actually indeterminate mounts one.
 */

import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { MOTION_EASE } from '../../theme/motion.js'
import type { Progress } from '../../lib/progress.js'

/** The filled part of a KNOWN bar. */
export const PROGRESS_STRIP_FILL_TEST_ID = 'progress-strip-fill'
/** The sweeping segment of an UNKNOWN (indeterminate) bar. */
export const PROGRESS_STRIP_SWEEP_TEST_ID = 'progress-strip-sweep'

/** How wide the indeterminate segment is, as a fraction of the track. */
const SWEEP_FRACTION = 0.3
const SWEEP_MS = 1100

export interface ProgressStripProps {
  readonly progress: Progress
  /** The track's width in px, so the sweep can translate on the native driver. */
  readonly width: number
  readonly color: string
  readonly trackColor: string
  readonly height: number
}

export function ProgressStrip({
  progress,
  width,
  color,
  trackColor,
  height,
}: ProgressStripProps): React.ReactElement {
  return (
    <View
      pointerEvents="none"
      style={[styles.track, { backgroundColor: trackColor, height }]}
    >
      {progress.kind === 'known' ? (
        <View
          testID={PROGRESS_STRIP_FILL_TEST_ID}
          style={[
            styles.fill,
            {
              backgroundColor: color,
              // A percentage, not a measured px: the track's width is already
              // the layout's, and re-measuring it here would be a second
              // authority on the same geometry.
              width: `${progress.fraction * 100}%`,
            },
          ]}
        />
      ) : (
        <IndeterminateSweep width={width} color={color} />
      )}
    </View>
  )
}

function IndeterminateSweep({
  width,
  color,
}: {
  readonly width: number
  readonly color: string
}): React.ReactElement {
  const shift = useSharedValue<number>(0)
  // The travel is the track minus the segment; a zero/unknown width yields a
  // segment that simply does not move, never a NaN transform.
  const segment = Math.max(0, width * SWEEP_FRACTION)
  const travel = Math.max(0, width - segment)
  useEffect(() => {
    shift.set(0)
    shift.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: SWEEP_MS, easing: MOTION_EASE }),
          withTiming(0, { duration: SWEEP_MS, easing: MOTION_EASE }),
        ),
        -1,
        false,
      ),
    )
    return () => cancelAnimation(shift)
  }, [shift, travel])
  const segmentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shift.get() * travel }] }))
  return (
    <Animated.View
      testID={PROGRESS_STRIP_SWEEP_TEST_ID}
      style={[
        styles.fill,
        {
          backgroundColor: color,
          width: segment,
        },
        segmentStyle,
      ]}
    />
  )
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
})
