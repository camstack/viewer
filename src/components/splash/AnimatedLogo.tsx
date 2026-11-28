/**
 * The Dominevo logo, animated: orbit back half, seed (squash anchored at its
 * base), lens with a six-blade iris shutter and a glint, orbit front half, and
 * two nodes that swap between the back and front layer as they circle.
 * One shared value (`progress`, 0..1 linear) drives every piece on the UI thread
 * through animated SVG props; `progress = 0` is the rest frame, identical to the
 * static `splash-icon.png`. Geometry and timing live in `splash-math.ts`.
 */
import React, { useEffect, useMemo } from 'react'
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import Svg, { ClipPath, Circle, Defs, Ellipse, G, Line, Path, Rect } from 'react-native-svg'

import { LOGO_ART } from '../../theme/tokens.js'
import {
  BLADE_COUNT,
  LENS,
  ORBIT_CX,
  ORBIT_CY,
  ORBIT_RX,
  ORBIT_RY,
  SEED_ANCHOR,
  bladeSegment,
  bladesOpacity,
  glint,
  irisRing,
  orbitAngle,
  placeNode,
  pupilRadius,
  shutter,
  squash,
  type NodeLayer,
} from './splash-math.js'
import { INTRO_MS } from './splash-timing.js'

const AnimatedCircle = Animated.createAnimatedComponent(Circle)
const AnimatedG = Animated.createAnimatedComponent(G)
const AnimatedLine = Animated.createAnimatedComponent(Line)

const ORBIT_STROKE = 4.2
const TILT_DEG = -14
const SEED_PATH = 'M32 5 C44 19 53 29 53 40 a21 21 0 0 1 -42 0 C11 29 20 19 32 5 Z'
const BLADE_INDEXES = Array.from({ length: BLADE_COUNT }, (_, i) => i)

interface NodeSpec {
  readonly baseR: number
  /** Added to the orbit angle (the two nodes sit opposite each other). */
  readonly phase: number
  readonly fill: string
  readonly stroke: string
  readonly strokeWidth: number
}

function NodeCircle({
  progress,
  spec,
  layer,
}: {
  progress: SharedValue<number>
  spec: NodeSpec
  layer: NodeLayer
}): React.JSX.Element {
  const animatedProps = useAnimatedProps(() => {
    const n = placeNode(orbitAngle(progress.value) + spec.phase, spec.baseR)
    return { cx: n.cx, cy: n.cy, r: n.r, opacity: n.layer === layer ? n.opacity : 0 }
  })
  return (
    <AnimatedCircle
      animatedProps={animatedProps}
      fill={spec.fill}
      stroke={spec.stroke}
      strokeWidth={spec.strokeWidth}
    />
  )
}

function BladeLine({ progress, index }: { progress: SharedValue<number>; index: number }): React.JSX.Element {
  const animatedProps = useAnimatedProps(() => {
    const s = bladeSegment(index, shutter(progress.value))
    return { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 }
  })
  return <AnimatedLine animatedProps={animatedProps} stroke={LOGO_ART.blade} strokeWidth={0.45} />
}

export interface AnimatedLogoProps {
  /** Width and height in points. */
  readonly size: number
  /** The node ring colour: the surface behind the logo. */
  readonly ringColor: string
  /** The orbit band colour (differs by colour scheme). */
  readonly orbitColor: string
  /** Plays the intro pass once on mount; `false` shows the rest frame only. */
  readonly play: boolean
}

export function AnimatedLogo({ size, ringColor, orbitColor, play }: AnimatedLogoProps): React.JSX.Element {
  const progress = useSharedValue(0)
  useEffect(() => {
    if (!play) return undefined
    progress.value = withTiming(1, { duration: INTRO_MS, easing: Easing.linear })
    return undefined
  }, [play, progress])

  const big = useMemo<NodeSpec>(
    () => ({ baseR: 5, phase: 0, fill: LOGO_ART.seed, stroke: ringColor, strokeWidth: 2 }),
    [ringColor],
  )
  const small = useMemo<NodeSpec>(
    () => ({ baseR: 3.8, phase: Math.PI, fill: LOGO_ART.nodeSmallFill, stroke: LOGO_ART.seed, strokeWidth: 1.8 }),
    [],
  )

  const seedProps = useAnimatedProps(() => {
    const s = squash(progress.value)
    return {
      transform: [
        { translateX: SEED_ANCHOR.x },
        { translateY: SEED_ANCHOR.y },
        { scaleX: s.sx },
        { scaleY: s.sy },
        { translateX: -SEED_ANCHOR.x },
        { translateY: -SEED_ANCHOR.y },
      ],
    }
  })
  const pupilProps = useAnimatedProps(() => ({ r: pupilRadius(squash(progress.value).sy) }))
  const irisProps = useAnimatedProps(() => {
    const ring = irisRing(shutter(progress.value))
    return { r: ring.r, strokeWidth: ring.strokeWidth }
  })
  const bladesProps = useAnimatedProps(() => ({ opacity: bladesOpacity(shutter(progress.value)) }))
  const glintProps = useAnimatedProps(() => ({ opacity: 0.9 * glint(progress.value) }))

  const tilt = `rotate(${TILT_DEG} ${ORBIT_CX} ${ORBIT_CY})`
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" style={{ overflow: 'visible' }}>
      <Defs>
        <ClipPath id="splash-front">
          <Rect x={0} y={41} width={64} height={30} />
        </ClipPath>
        <ClipPath id="splash-lens">
          <Circle cx={LENS.cx} cy={LENS.cy} r={LENS.r} />
        </ClipPath>
      </Defs>
      <G transform="translate(32 33) scale(0.74) translate(-32 -34)">
        <Ellipse
          cx={ORBIT_CX}
          cy={ORBIT_CY}
          rx={ORBIT_RX}
          ry={ORBIT_RY}
          fill="none"
          stroke={orbitColor}
          strokeWidth={ORBIT_STROKE}
          strokeLinecap="round"
          transform={tilt}
        />
        <NodeCircle progress={progress} spec={big} layer="back" />
        <NodeCircle progress={progress} spec={small} layer="back" />
        <AnimatedG animatedProps={seedProps}>
          <Path d={SEED_PATH} fill={LOGO_ART.seed} />
          <Circle cx={LENS.cx} cy={LENS.cy} r={10.5} fill={LOGO_ART.lensOuter} />
          <Circle
            cx={LENS.cx}
            cy={LENS.cy}
            r={10.5}
            fill="none"
            stroke={LOGO_ART.lensEdge}
            strokeOpacity={0.35}
            strokeWidth={1.2}
          />
          <Circle cx={LENS.cx} cy={LENS.cy} r={LENS.r} fill={LOGO_ART.lensInner} />
          <AnimatedCircle animatedProps={pupilProps} cx={LENS.cx} cy={LENS.cy} fill={LOGO_ART.pupil} />
          <G clipPath="url(#splash-lens)">
            <AnimatedCircle
              animatedProps={irisProps}
              cx={LENS.cx}
              cy={LENS.cy}
              fill="none"
              stroke={LOGO_ART.pupil}
            />
            <AnimatedG animatedProps={bladesProps}>
              {BLADE_INDEXES.map((i) => (
                <BladeLine key={i} progress={progress} index={i} />
              ))}
            </AnimatedG>
          </G>
          <AnimatedCircle animatedProps={glintProps} cx={29.4} cy={39.4} r={1.7} fill={LOGO_ART.glint} />
        </AnimatedG>
        <G transform={tilt}>
          <Ellipse
            cx={ORBIT_CX}
            cy={ORBIT_CY}
            rx={ORBIT_RX}
            ry={ORBIT_RY}
            fill="none"
            stroke={orbitColor}
            strokeWidth={ORBIT_STROKE}
            strokeLinecap="round"
            clipPath="url(#splash-front)"
          />
        </G>
        <NodeCircle progress={progress} spec={big} layer="front" />
        <NodeCircle progress={progress} spec={small} layer="front" />
      </G>
    </Svg>
  )
}
