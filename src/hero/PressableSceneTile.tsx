/**
 * PressableSceneTile — the row's scene tile as a button, for a device whose
 * state a tap can flip (`resolveTileAction`). A tile with no action is drawn by
 * `HeroSceneTile` alone: not pressable, no affordance.
 *
 * What the operator sees, all Reanimated and all honouring Reduce Motion:
 *  - the press: a small scale bounce under the finger;
 *  - the wait, from the send until the device REPORTS the new state (never
 *    optimistic): a ring spinner around the icon;
 *  - the report: the icon and tone cross-fade to the new look;
 *  - a failure or the timeout: the tile reverts and shakes once;
 *  - armed (a confirmed action's first tap): the tone turns warning.
 */
import React, { useEffect, useRef } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { MOTION, springTo, timingTo, useReducedMotion } from '../theme/motion.js'
import { useTheme } from '../theme/theme-provider.js'
import { toneColor } from './hero-view.js'
import { HeroSceneTile, SCENE_TILE_MINI, type HeroSceneTileProps } from './HeroSceneTile.js'
import type { TileCommand } from './use-tile-command.js'

/** One turn of the wait ring. */
const RING_TURN_MS = 900
const RING_WIDTH = 2
/** The ring's diameter: a circle inside the tile, around the icon. */
const RING_SIZE = 36
/** How far the failure shake travels (pt) and how long each leg lasts. */
const SHAKE_PX = 5
const SHAKE_LEG_MS = 60

export interface PressableSceneTileProps extends Omit<HeroSceneTileProps, 'size' | 'level'> {
  readonly command: TileCommand
  readonly accessibilityLabel: string
}

export function PressableSceneTile({ command, accessibilityLabel, icon, tone, muted = false, testID }: PressableSceneTileProps): React.JSX.Element {
  const { colors } = useTheme()
  const reduced = useReducedMotion()
  const scale = useSharedValue(1)
  const shakeX = useSharedValue(0)
  const face = useSharedValue(1)
  const ring = useSharedValue(0)

  const shown = command.armed ? 'warning' : tone
  const look = `${icon}|${shown}|${muted ? 'm' : ''}`
  const lastLook = useRef(look)
  const pending = command.phase === 'pending'

  // The report: dip the face and bring it back, so the new icon and tone fade in.
  useEffect(() => {
    if (lastLook.current === look) return
    lastLook.current = look
    face.set(0.35)
    face.set(timingTo(1, MOTION.crossFade.ms, reduced))
  }, [look, face, reduced])

  // The wait: a ring that turns until the device reports.
  useEffect(() => {
    if (!pending) {
      cancelAnimation(ring)
      ring.set(0)
      return undefined
    }
    ring.set(reduced ? 0 : withRepeat(withTiming(360, { duration: RING_TURN_MS, easing: Easing.linear }), -1, false))
    return () => cancelAnimation(ring)
  }, [pending, ring, reduced])

  // The failure: one shake per counted failure.
  const lastShake = useRef(command.shake)
  useEffect(() => {
    if (lastShake.current === command.shake) return
    lastShake.current = command.shake
    if (reduced) return
    shakeX.set(
      withSequence(
        withTiming(-SHAKE_PX, { duration: SHAKE_LEG_MS }),
        withTiming(SHAKE_PX, { duration: SHAKE_LEG_MS * 2 }),
        withTiming(-SHAKE_PX / 2, { duration: SHAKE_LEG_MS * 2 }),
        withTiming(0, { duration: SHAKE_LEG_MS }),
      ),
    )
  }, [command.shake, shakeX, reduced])

  const bodyStyle = useAnimatedStyle(() => ({
    opacity: face.get(),
    transform: [{ scale: scale.get() }, { translateX: shakeX.get() }],
  }))
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${ring.get()}deg` }] }))
  const ringColor = toneColor(shown, colors)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: pending }}
      testID={testID === undefined ? undefined : `${testID}-press`}
      disabled={pending}
      hitSlop={4}
      onPressIn={() => scale.set(springTo(MOTION.press.pressed.scale, reduced))}
      onPressOut={() => scale.set(springTo(MOTION.press.rest.scale, reduced))}
      onPress={command.press}
      style={styles.slot}
    >
      <Animated.View style={bodyStyle}>
        <HeroSceneTile icon={icon} tone={shown} muted={muted && !command.armed} testID={testID} />
      </Animated.View>
      {pending ? (
        <Animated.View
          pointerEvents="none"
          testID={testID === undefined ? undefined : `${testID}-ring`}
          style={[styles.ring, { borderTopColor: ringColor }, ringStyle]}
        />
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  slot: { width: SCENE_TILE_MINI, height: SCENE_TILE_MINI },
  ring: {
    position: 'absolute',
    top: (SCENE_TILE_MINI - RING_SIZE) / 2,
    left: (SCENE_TILE_MINI - RING_SIZE) / 2,
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: RING_WIDTH,
    borderColor: 'transparent',
  },
})
