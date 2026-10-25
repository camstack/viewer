/**
 * TransportSpinnerRing — the seek indicator, drawn AROUND the play/pause button
 * rather than beside it or inside it.
 *
 * Two earlier attempts are the reason this exists as its own component:
 *
 *   1. an `ActivityIndicator` absolutely positioned with a symmetric negative
 *      inset — which centres it on the SAME box as the button, so an indicator
 *      smaller than the disc renders behind the glyph and is invisible;
 *   2. the same indicator moved to `left: '100%'`, visible but detached, a
 *      second object competing with the control it describes.
 *
 * A ring is the shape that says "this button is busy" without being a separate
 * thing. It is an SVG circle whose dash pattern leaves a gap, rotated
 * continuously — so the arc sweeps around the button's rim.
 *
 * `pointerEvents="none"` throughout: the button stays fully tappable while it
 * spins, which matters precisely then. A slow seek is exactly when someone
 * reaches for pause.
 */
import React, { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle } from 'react-native-svg'

/** How long one full sweep takes. */
const SPIN_MS = 900
/** Ring thickness. Thin enough to read as a rim, thick enough to see in motion. */
const STROKE = 2
/** Gap between the button's edge and the ring, in px. */
const GAP = 3

export interface TransportSpinnerRingProps {
  /** Diameter of the button this ring surrounds. */
  readonly size: number
  readonly color: string
}

export function TransportSpinnerRing({
  size,
  color,
}: TransportSpinnerRingProps): React.JSX.Element {
  const spin = useSharedValue<number>(0)

  useEffect(() => {
    spin.set(0)
    spin.set(withRepeat(withTiming(1, { duration: SPIN_MS, easing: Easing.linear }), -1, false))
    return () => cancelAnimation(spin)
  }, [spin])
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.get() * 360}deg` }] }))

  const outer = size + GAP * 2 + STROKE * 2
  const r = (outer - STROKE) / 2
  const circumference = 2 * Math.PI * r

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          width: outer,
          height: outer,
          // Centre the ring on the button: half the overshoot in each direction.
          marginLeft: -(outer - size) / 2,
          marginTop: -(outer - size) / 2,
        },
        spinStyle,
      ]}
    >
      <Svg width={outer} height={outer}>
        <Circle
          cx={outer / 2}
          cy={outer / 2}
          r={r}
          stroke={color}
          strokeWidth={STROKE}
          fill="none"
          // A quarter-circle arc with the rest left open — the gap is what
          // makes the rotation legible. A full circle would look static.
          strokeDasharray={`${circumference * 0.25} ${circumference}`}
          strokeLinecap="round"
        />
      </Svg>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  ring: { position: 'absolute', left: 0, top: 0 },
})
