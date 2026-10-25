import React, { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../../theme/tokens.js'
import { timingTo, useReducedMotion } from '../../theme/motion.js'
import { GlassSurface } from './GlassSurface.js'
import { nextPhase, type PresencePhase } from './presence.js'

/** Don't flash the indicator for blips shorter than this. */
const DELAY_IN_MS = 300
/** Entry fade/slide duration. */
const ENTER_MS = 220
/** Exit fade duration (also the unmount delay). */
const EXIT_MS = 180
/** One half of the dot's breathe cycle. */
const PULSE_HALF_MS = 600
const DOT_SIZE = 8
/** How far above its resting place the overlay starts / ends its slide. */
const SLIDE_PX = 16

interface ConnectingIndicatorProps {
  /** Drive from connection state; the component handles delay-in/animate-out. */
  visible: boolean
  /** Localized label ("Connecting…" / "Offline"). Doubles as accessibilityLabel. */
  label: string
  /** Accent for the status dot (e.g. `colors.primary` progress, `colors.danger` offline). */
  dotColor: string
  /** Animate the dot (breathe). Turn off for terminal states like offline. */
  pulse?: boolean
  /** One text action at the pill's end (e.g. Retry while offline). The pill is
   *  the only part of the overlay that takes touches, so this is reachable
   *  without blocking the screen under it. */
  action?: ConnectingIndicatorAction
}

/** The pill's one optional action. */
export interface ConnectingIndicatorAction {
  readonly label: string
  readonly onPress: () => void
  readonly testID?: string
}

/** Presence phase driven by the pure `nextPhase` machine: activation waits out
 *  `DELAY_IN_MS` (a shorter blip never shows anything), deactivation plays the
 *  exit animation before unmount. */
function usePresencePhase(active: boolean): PresencePhase {
  // Seed from `active` so an already-connecting mount starts in `waiting`
  // (the initial socket dial happens before this component first renders).
  const [phase, setPhase] = useState<PresencePhase>(active ? 'waiting' : 'hidden')
  // Adjust-state-during-render (React docs pattern): apply the activate /
  // deactivate transition the moment the prop flips, without an effect.
  const [prevActive, setPrevActive] = useState(active)
  if (active !== prevActive) {
    setPrevActive(active)
    setPhase(nextPhase(phase, active ? 'activate' : 'deactivate'))
  }
  useEffect(() => {
    if (phase !== 'waiting' && phase !== 'leaving') return undefined
    const event = phase === 'waiting' ? 'delayElapsed' : 'exitDone'
    const timer = setTimeout(() => setPhase((p) => nextPhase(p, event)), phase === 'waiting' ? DELAY_IN_MS : EXIT_MS)
    return () => clearTimeout(timer)
  }, [phase])
  return phase
}

/** Connection-status OVERLAY: a small breathing dot next to a label on the
 *  menus' glass, floating over the content just under the top safe area. It is
 *  absolutely positioned — it never changes the layout under it and only its
 *  own pill takes touches. Fades and slides in only after a short delay (brief
 *  reconnect blips show nothing) and out when the connection is back; honours
 *  reduce-motion. iOS/Android/web. */
export function ConnectingIndicator({ visible, label, dotColor, pulse = true, action }: ConnectingIndicatorProps) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const phase = usePresencePhase(visible)
  const shown = phase === 'shown'
  const mounted = shown || phase === 'leaving'

  const appear = useSharedValue(0)
  useEffect(() => {
    appear.value = timingTo(shown ? 1 : 0, shown ? ENTER_MS : EXIT_MS, reduced)
  }, [appear, shown, reduced])

  const breathe = useSharedValue(1)
  useEffect(() => {
    if (!pulse) {
      breathe.value = withTiming(1, { duration: ENTER_MS })
      return undefined
    }
    breathe.value = withRepeat(
      withSequence(
        withTiming(0.35, { duration: PULSE_HALF_MS, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: PULSE_HALF_MS, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    )
    return () => cancelAnimation(breathe)
  }, [breathe, pulse])

  const containerStyle = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [{ translateY: (1 - appear.value) * -SLIDE_PX }],
  }))
  const dotStyle = useAnimatedStyle(() => ({
    opacity: breathe.value,
    transform: [{ scale: 0.7 + 0.3 * breathe.value }],
  }))

  if (!mounted) return null
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.overlay, { top: insets.top + SPACING.sm }, containerStyle]}
    >
      <GlassSurface variant="bar" dense radius={RADIUS.pill} contentStyle={styles.pill}>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={label}
          accessibilityLiveRegion="polite"
          style={styles.content}
        >
          <View style={styles.dotBox}>
            <Animated.View style={[styles.dot, { backgroundColor: dotColor }, dotStyle]} />
          </View>
          <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
        </View>
        {action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            hitSlop={SPACING.md}
            testID={action.testID}
          >
            <Text style={[styles.action, { color: colors.primary }]}>{action.label}</Text>
          </Pressable>
        ) : null}
      </GlassSurface>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: SPACING.lg, paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg },
  content: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  dotBox: { width: DOT_SIZE, height: DOT_SIZE, alignItems: 'center', justifyContent: 'center' },
  dot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2 },
  label: { fontSize: TYPOGRAPHY.size.sm },
  action: { fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.bold },
})
