/**
 * DriveJoystick — the robot camera's stick. A ring with a thumb the finger
 * drags; while the thumb is off-centre the parent receives the cap vector,
 * on release it receives the stop.
 *
 * ONE component for both surfaces (operator, 2026-09-06: joystick + four
 * buttons in landscape overlay): the portrait controls panel mounts it in
 * place of its four hold buttons, the landscape `DriveOverlay` mounts it
 * over the picture. The math is `drive-joystick-math.ts`, shared with
 * nothing else — a second derivation is a second drive vocabulary.
 *
 * ## Why the pan activates on contact
 *
 * The stick lives over the picture in landscape and inside a ScrollView in
 * portrait. A pan that waits for its `minDistance` loses the first points
 * to the video's own pan/pinch or to the page scroll; `manualActivation`
 * plus `activate()` in `onTouchesDown` claims the touch the moment it
 * lands, so neither can steal it and neither moves under the finger.
 *
 * ## Cadence
 *
 * The thumb moves every frame on the UI thread; the parent is told only
 * when the rounded vector CHANGES, and the hook behind it sends at most one
 * `move` per second with the latest value (`createDriveCadence`). Haptic on
 * the first nudge of a gesture, once.
 *
 * Shared values are read and written through `get()` / `set()`, never
 * `.value`: the React Compiler's lint treats a value listed in a hook's deps
 * as frozen and rejects the assignment (`react-hooks/immutability`, 44 of
 * them in `use-stream-zoom.ts`). The accessor API is Reanimated's answer to
 * exactly that.
 */
import React, { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { guardWorklet } from '../../../lib/worklet-guard.js'
import { useTranslation } from 'react-i18next'
import { hapticTap } from '../../../lib/haptics.js'
import { joystickThumbPosition, joystickVector } from './drive-joystick-math.js'

export const DRIVE_JOYSTICK_TEST_ID = 'drive-joystick'
/** Ring diameter, points — the operator's ~120 pt. */
export const DRIVE_JOYSTICK_SIZE = 120
const THUMB_SIZE = 48
/** Vector precision reported to the parent — a change below this is noise. */
const VECTOR_STEP = 100

const RING_BG = 'rgba(0,0,0,0.45)'
const RING_BORDER = 'rgba(250,250,249,0.35)'
const THUMB_BG = 'rgba(250,250,249,0.92)'
const THUMB_BG_ENGAGED = 'rgba(59,130,246,0.95)'

export interface DriveJoystickProps {
  /** The cap vector while the thumb is off-centre; `(0, 0)` when it returns to the dead zone. */
  readonly onVector: (pan: number, tilt: number) => void
  /** The finger lifted (or the gesture was cancelled): the robot must stop. */
  readonly onRelease: () => void
  /** The finger landed — the host may hold its chrome open while this is true. */
  readonly onEngage?: () => void
  readonly size?: number
}

function quantize(value: number): number {
  'worklet'
  return Math.round(value * VECTOR_STEP) / VECTOR_STEP + 0
}

export function DriveJoystick({ onVector, onRelease, onEngage, size = DRIVE_JOYSTICK_SIZE }: DriveJoystickProps) {
  const { t } = useTranslation()
  const travel = (size - THUMB_SIZE) / 2
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const engaged = useSharedValue(false)
  /** The gesture already produced a nudge — the haptic fired for it. */
  const nudged = useSharedValue(false)
  const lastPan = useSharedValue(0)
  const lastTilt = useSharedValue(0)

  // Every callback below runs SYNCHRONOUSLY on the UI runtime, where an
  // uncaught throw is `abort()` and not an error (D428). `guardWorklet` turns
  // the worst case into a dropped gesture plus one `app:error` line naming the
  // message — which is exactly what three TestFlight crash reports could not.
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .manualActivation(true)
        .onTouchesDown(
          guardWorklet('joystick.touchesDown', (_event, manager) => {
            'worklet'
            manager.activate()
          }),
        )
        .onBegin(
          guardWorklet('joystick.begin', () => {
            'worklet'
            engaged.set(true)
            if (onEngage) runOnJS(onEngage)()
          }),
        )
        .onUpdate(
          guardWorklet('joystick.update', (event) => {
            'worklet'
            const offset = { dx: event.translationX, dy: event.translationY, radius: travel }
            const thumb = joystickThumbPosition(offset)
            x.set(thumb.x)
            y.set(thumb.y)
            const vector = joystickVector(offset)
            const pan = quantize(vector.pan)
            const tilt = quantize(vector.tilt)
            if (pan === lastPan.get() && tilt === lastTilt.get()) return
            lastPan.set(pan)
            lastTilt.set(tilt)
            if (!nudged.get() && vector.magnitude > 0) {
              nudged.set(true)
              runOnJS(hapticTap)()
            }
            runOnJS(onVector)(pan, tilt)
          }),
        )
        .onFinalize(
          guardWorklet('joystick.finalize', () => {
            'worklet'
            engaged.set(false)
            nudged.set(false)
            lastPan.set(0)
            lastTilt.set(0)
            x.set(withSpring(0))
            y.set(withSpring(0))
            runOnJS(onRelease)()
          }),
        ),
    [engaged, lastPan, lastTilt, nudged, onEngage, onRelease, onVector, travel, x, y],
  )

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() }],
    backgroundColor: engaged.get() ? THUMB_BG_ENGAGED : THUMB_BG,
  }))

  return (
    <GestureDetector gesture={gesture}>
      <View
        testID={DRIVE_JOYSTICK_TEST_ID}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t('v2.navigation.joystick')}
        accessibilityHint={t('v2.navigation.joystickHint')}
        style={[styles.ring, { width: size, height: size, borderRadius: size / 2 }]}
      >
        <View style={[styles.centreDot]} />
        <Animated.View style={[styles.thumb, thumbStyle]} />
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: RING_BG,
    borderWidth: 1.5,
    borderColor: RING_BORDER,
  },
  centreDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: RING_BORDER,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
  },
})
