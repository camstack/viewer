/**
 * ActivityButton — the Activity centre's entry in the navigation.
 *
 * A circle with the Activity glyph. Idle it is quiet (a hairline ring: still
 * tappable, because the history is behind it). While exports run the ring
 * fills / turns and a count badge says how many; when something finished and
 * was not opened yet, a "ready" dot sits on the corner.
 */
import React, { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useTranslation } from 'react-i18next'

import { hapticTap } from '../lib/haptics.js'
import { Activity } from '../lib/icons.js'
import { useReducedMotion } from '../theme/motion.js'
import { useTheme } from '../theme/theme-provider.js'
import { TABULAR } from '../theme/tokens.js'
import { useActivityStore } from './activity-instance.js'
import { hasUndismissedItems, overallProgress, unseenFinishedCount } from './activity-model.js'
import { START_PULSE_MS, useActivityStartPulse } from './activity-start-pulse.js'
import { ActivityRing } from './ActivityRing.js'
import { ActivityPopover } from './ActivityPopover.js'
import type { AnchorRect } from '../components/ui/dropdown-placement.js'

export const ACTIVITY_BUTTON_TEST_ID = 'activity-button'
/** Present only while the start-of-operation pulse plays. */
export const ACTIVITY_START_PULSE_TEST_ID = 'activity-start-pulse'

const SIZE = 38
const RING_WIDTH = 3
const BADGE = 16
const DOT = 9

export interface ActivityButtonProps {
  readonly menuAlign?: 'start' | 'end'
  /** The block both popovers hang from; the button itself when absent. */
  readonly anchorRef?: RefObject<View | null>
}

export const ActivityButton = memo(function ActivityButton({ menuAlign = 'end', anchorRef: blockRef }: ActivityButtonProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const items = useActivityStore((s) => s.items)
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<View>(null)
  const [anchor, setAnchor] = useState<AnchorRect | null>(null)

  const progress = useMemo(() => overallProgress(items), [items])
  const unseen = useMemo(() => unseenFinishedCount(items), [items])
  const running = progress.kind === 'idle' ? 0 : progress.running
  // In the bar only while there is something to look at; kept while its own
  // popover is open so clearing the last row does not pull the anchor away.
  const present = useMemo(() => hasUndismissedItems(items), [items])
  // A new running activity is the acknowledgement of a download: the button
  // bounces and a ring spreads from it.
  const pulsing = useActivityStartPulse(items)
  const reduced = useReducedMotion()
  const beat = useSharedValue(0)
  useEffect(() => {
    if (!pulsing || reduced) return
    cancelAnimation(beat)
    beat.set(0)
    beat.set(withTiming(1, { duration: START_PULSE_MS, easing: Easing.out(Easing.quad) }))
  }, [pulsing, reduced, beat])
  const bounce = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + 0.22 * Math.sin(Math.PI * Math.min(beat.get() * 2, 1)) }],
  }))
  const ripple = useAnimatedStyle(() => ({
    opacity: 0.6 * (1 - beat.get()),
    transform: [{ scale: 1 + 0.9 * beat.get() }],
  }))
  if (!present && !open) return <></>

  const label =
    running > 0
      ? t('v2.activity.openRunning', { count: running })
      : unseen > 0
        ? t('v2.activity.openReady', { count: unseen })
        : t('v2.activity.open')

  return (
    <>
      <View ref={anchorRef} collapsable={false}>
      <Pressable
        testID={ACTIVITY_BUTTON_TEST_ID}
        onPress={() => {
          hapticTap()
          const target = blockRef ?? anchorRef
    target.current?.measureInWindow((x, y, width, height) => {
            setAnchor({ x, y, width, height })
            setOpen(true)
          })
        }}
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={6}
        style={styles.hit}
      >
        {pulsing ? (
          <Animated.View
            testID={ACTIVITY_START_PULSE_TEST_ID}
            pointerEvents="none"
            style={[styles.ripple, { borderColor: colors.primary }, ripple]}
          />
        ) : null}
        <Animated.View style={[styles.circle, { backgroundColor: running > 0 ? colors.surfaceHover : 'transparent' }, bounce]}>
          <ActivityRing
            size={SIZE}
            strokeWidth={RING_WIDTH}
            progress={progress}
            color={colors.primary}
            trackColor={running > 0 ? colors.border : colors.borderSubtle}
          />
          <Activity size={18} color={running > 0 ? colors.foreground : colors.foregroundMuted} />
          {running > 0 ? (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.badgeText, TABULAR, { color: colors.primaryForeground }]}>
                {running > 9 ? '9+' : running}
              </Text>
            </View>
          ) : unseen > 0 ? (
            <View style={[styles.dot, { backgroundColor: colors.success, borderColor: colors.backgroundElevated }]} />
          ) : null}
        </Animated.View>
      </Pressable>
      </View>
      <ActivityPopover visible={open} onClose={() => setOpen(false)} anchor={anchor} menuAlign={menuAlign} />
    </>
  )
})

const styles = StyleSheet.create({
  hit: { alignItems: 'center', justifyContent: 'center' },
  ripple: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 2 },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '700' },
  dot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 1.5,
  },
})
